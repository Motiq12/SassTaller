// Respaldo automático de la base: la vuelca a SQL, la comprime, opcionalmente
// la cifra y la sube a un almacenamiento compatible con S3. Después borra los
// respaldos más viejos, dejando los últimos N.
//
// Va por la red privada, con la misma conexión que usa la app: no necesita que
// la base tenga una puerta pública. Lo corre una tarea programada (jobs/) y se
// puede lanzar a mano con scripts/respaldos.js.
//
// Se configura con variables de entorno (ver .env.example). Si falta alguna de
// las obligatorias, el respaldo queda apagado y se avisa al arrancar.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { once } = require('node:events');
const { pipeline } = require('node:stream/promises');
const { crearS3 } = require('../utils/s3');
const { volcarBase } = require('../utils/volcado');
const { cifrador } = require('../utils/cifrado-archivo');

const OBLIGATORIAS = ['RESPALDO_S3_ENDPOINT', 'RESPALDO_S3_BUCKET', 'RESPALDO_S3_ACCESS_KEY_ID', 'RESPALDO_S3_SECRET_ACCESS_KEY'];

function configRespaldo(env = process.env) {
  const faltan = OBLIGATORIAS.filter((k) => !String(env[k] || '').trim());
  const conservar = Math.round(Number(env.RESPALDO_CONSERVAR));
  let prefijo = String(env.RESPALDO_PREFIJO || 'respaldos/').replace(/^\/+/, '');
  if (prefijo && !prefijo.endsWith('/')) prefijo += '/';
  return {
    activo: faltan.length === 0,
    faltan,
    endpoint: String(env.RESPALDO_S3_ENDPOINT || '').trim(),
    bucket: String(env.RESPALDO_S3_BUCKET || '').trim(),
    accessKeyId: String(env.RESPALDO_S3_ACCESS_KEY_ID || '').trim(),
    secretAccessKey: String(env.RESPALDO_S3_SECRET_ACCESS_KEY || '').trim(),
    region: String(env.RESPALDO_S3_REGION || '').trim() || 'auto',
    estilo: String(env.RESPALDO_S3_ESTILO || '').trim() === 'path' ? 'path' : 'virtual',
    prefijo,
    // Cuántos respaldos se guardan. Con uno por día, 14 son dos semanas.
    conservar: Number.isFinite(conservar) && conservar >= 1 ? Math.min(conservar, 365) : 14,
    // Frase para cifrar (opcional). Vacía = el respaldo se sube sin cifrar.
    frase: String(env.RESPALDO_CLAVE || ''),
  };
}

// base_2026-10-08T08-30-00Z.sql.gz (y .enc si va cifrado). La fecha en el nombre
// hace que ordenar por nombre sea ordenar por antigüedad.
const PATRON = /^[A-Za-z0-9_-]+_\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z\.sql\.gz(\.enc)?$/;
function nombreRespaldo(base, ahora, cifrado) {
  const sello = ahora.toISOString().slice(0, 19).replace(/:/g, '-') + 'Z';
  const limpia = String(base || 'base').replace(/[^A-Za-z0-9_-]/g, '_');
  return `${limpia}_${sello}.sql.gz${cifrado ? '.enc' : ''}`;
}

// De todo lo que hay bajo el prefijo, qué se borra para quedarse con los
// `conservar` más nuevos. Solo se tocan archivos con el nombre de un respaldo:
// cualquier otra cosa que alguien haya dejado ahí no se borra nunca.
function sobrantes(claves, prefijo, conservar) {
  const nuestros = claves
    .filter((c) => c.startsWith(prefijo) && PATRON.test(c.slice(prefijo.length)))
    .sort((a, b) => fechaDe(a).localeCompare(fechaDe(b)));
  return nuestros.slice(0, Math.max(0, nuestros.length - conservar));
}
const fechaDe = (clave) => (clave.match(/_(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z)\.sql\.gz/) || [])[1] || '';

let enCurso = false;

// Hace un respaldo completo. Devuelve { clave, bytes, tablas, filas, segundos, borrados, cifrado }.
async function respaldar({ pool, config = configRespaldo(), ahora = new Date(), s3 } = {}) {
  if (!config.activo) throw new Error(`El respaldo no está configurado: faltan ${config.faltan.join(', ')}`);
  if (enCurso) throw new Error('Ya hay un respaldo en curso');
  enCurso = true;
  const inicio = Date.now();
  const almacen = s3 || crearS3(config);
  const temporal = path.join(os.tmpdir(), `respaldo-${process.pid}-${inicio}.tmp`);
  try {
    // 1. Volcado → gzip → (cifrado) → archivo temporal.
    const gzip = zlib.createGzip({ level: 6 });
    const etapas = [gzip, ...(config.frase ? [cifrador(config.frase)] : []), fs.createWriteStream(temporal)];
    const escrito = pipeline(etapas);
    escrito.catch(() => {}); // el error se recoge abajo, con el await
    const escribir = async (texto) => {
      if (!gzip.write(texto)) await once(gzip, 'drain');
    };

    const conexion = await pool.getConnection();
    let resumen;
    try {
      resumen = await volcarBase(conexion, escribir, { ahora });
    } catch (err) {
      gzip.destroy(); // suelta el archivo temporal: el volcado quedó a medias
      throw err;
    } finally {
      // No vuelve al pool: quedó con otra zona horaria y una transacción propia.
      conexion.destroy();
    }
    gzip.end();
    await escrito;

    // Un respaldo sin tablas es señal de que algo anda mal (otro usuario, otra
    // base): no se sube ni se rota, para no ir borrando los buenos.
    if (!resumen.tablas) throw new Error('La base no devolvió ninguna tabla: no se sube un respaldo vacío');
    const bytes = fs.statSync(temporal).size;

    // 2. Subida, y comprobación de que quedó con el mismo tamaño.
    const clave = config.prefijo + nombreRespaldo(resumen.base, ahora, !!config.frase);
    await almacen.subir(clave, temporal);
    const objetos = await almacen.listar(config.prefijo);
    const subido = objetos.find((o) => o.clave === clave);
    if (!subido || subido.bytes !== bytes) {
      throw new Error(`El respaldo se subió pero no quedó bien guardado (${subido ? subido.bytes : 'no aparece'} de ${bytes} bytes)`);
    }

    // 3. Rotación: recién ahora, con el nuevo ya a salvo.
    const viejos = sobrantes(objetos.map((o) => o.clave), config.prefijo, config.conservar);
    for (const v of viejos) await almacen.borrar(v);

    return {
      clave, bytes, tablas: resumen.tablas, filas: resumen.filas,
      segundos: Math.round((Date.now() - inicio) / 1000), borrados: viejos.length, cifrado: !!config.frase,
    };
  } finally {
    enCurso = false;
    fs.rm(temporal, { force: true }, () => {});
  }
}

// Los respaldos que hay en el almacenamiento, del más nuevo al más viejo. La fecha
// sale del nombre (es la del volcado), no de cuándo terminó de subir.
function respaldosGuardados(objetos, prefijo) {
  return objetos
    .filter((o) => o.clave.startsWith(prefijo) && PATRON.test(o.clave.slice(prefijo.length)))
    .map((o) => {
      const f = fechaDe(o.clave);
      return {
        nombre: o.clave.slice(prefijo.length),
        fecha: `${f.slice(0, 10)}T${f.slice(11, 19).replace(/-/g, ':')}Z`,
        bytes: o.bytes,
        cifrado: o.clave.endsWith('.enc'),
      };
    })
    .sort((a, b) => b.fecha.localeCompare(a.fecha));
}

// Corre todos los días: si el último bueno tiene más de 30 horas, algo se saltó.
const HORAS_ATRASADO = 30;

// Un estado para el panel: sin_configurar | fallo | atrasado | al_dia | sin_datos.
// `registro` va del más nuevo al más viejo; `guardados` es lo de respaldosGuardados
// (o null si no se pudo listar el almacenamiento).
function resumirRespaldos({ activo, registro = [], guardados = null, ahora = new Date() }) {
  if (!activo) return { estado: 'sin_configurar', ultimo_ok: null };
  const okRegistro = registro.find((r) => r.ok);
  const fechas = [
    okRegistro && new Date(okRegistro.created_at).toISOString(),
    guardados && guardados[0] && guardados[0].fecha,
  ].filter(Boolean).sort();
  const ultimoOk = fechas.length ? fechas[fechas.length - 1] : null;
  if (registro[0] && !registro[0].ok) return { estado: 'fallo', ultimo_ok: ultimoOk };
  if (!ultimoOk) return { estado: 'sin_datos', ultimo_ok: null };
  const horas = (ahora - new Date(ultimoOk)) / 36e5;
  return { estado: horas > HORAS_ATRASADO ? 'atrasado' : 'al_dia', ultimo_ok: ultimoOk };
}

module.exports = { configRespaldo, respaldar, nombreRespaldo, sobrantes, respaldosGuardados, resumirRespaldos };
