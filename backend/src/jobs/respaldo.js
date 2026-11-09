// Job: respaldo diario de la base (ver services/respaldo.js).
//
// Un respaldo que falla en silencio es peor que no tener ninguno: uno cree que
// está cubierto. Por eso, si falla, además de quedar en el registro se le avisa
// por correo al taller: al correo cargado en Configuración y, si está vacío (así
// viene de fábrica), a los administradores. Antes, sin correo cargado, el aviso no
// le llegaba a nadie (pasó el 22-oct-2026).

const { pool } = require('../db/pool');
const { configRespaldo, respaldar } = require('../services/respaldo');
const { enviarAvisoRespaldoFallido } = require('../services/mailer');

const megas = (bytes) => (bytes / 1024 / 1024).toFixed(1);

// Deja constancia del respaldo en respaldos_registro (lo lee Configuración →
// Respaldos). Si no se puede anotar, el respaldo igual vale: solo se avisa.
async function anotar(datos) {
  try {
    await pool.query(
      `INSERT INTO respaldos_registro (origen, ok, clave, bytes, tablas, filas, segundos, cifrado, error, usuario_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [datos.origen, datos.ok ? 1 : 0, datos.clave || null, datos.bytes ?? null, datos.tablas ?? null, datos.filas ?? null,
        datos.segundos ?? null, datos.cifrado == null ? null : (datos.cifrado ? 1 : 0),
        datos.error ? String(datos.error).slice(0, 500) : null, datos.usuarioId || null]
    );
    await pool.query(
      `DELETE FROM respaldos_registro WHERE id <= (
         SELECT id FROM (SELECT id FROM respaldos_registro ORDER BY id DESC LIMIT 1 OFFSET 200) AS viejo)`
    );
  } catch (e) {
    console.error('No se pudo anotar el respaldo en el registro:', e.message);
  }
}

// Un respaldo, con su anotación. El automático además avisa por correo si falla;
// el del panel no, porque quien lo pidió ve el error en la pantalla.
async function hacerRespaldo({ origen = 'automatico', usuarioId = null } = {}) {
  const config = configRespaldo();
  if (!config.activo) return null; // sin configurar: ya se avisó al arrancar
  try {
    const r = await respaldar({ pool, config });
    console.log(`💾 Respaldo subido: ${r.clave} · ${megas(r.bytes)} MB · ${r.tablas} tablas, ${r.filas} filas · ${r.segundos} s`
      + `${r.cifrado ? ' · cifrado' : ''}${r.borrados ? ` · ${r.borrados} viejos borrados` : ''}`);
    await anotar({ ...r, origen, ok: true, usuarioId });
    return r;
  } catch (err) {
    // "Ya hay uno en curso" no es un respaldo fallido: el otro sigue.
    if (err.message !== 'Ya hay un respaldo en curso') await anotar({ origen, ok: false, error: err.message, usuarioId });
    if (origen === 'panel') throw err;
    try {
      // Solo a quienes administran Motiq. Antes salía a los admins de todos los talleres,
      // con el texto del error interno incluido.
      const [admins] = await pool.query('SELECT email FROM plataforma_admins WHERE activo = 1');
      const destinos = admins.map((a) => a.email);
      for (const destino of destinos) {
        await enviarAvisoRespaldoFallido(destino, { taller: 'Motiq', error: err.message });
      }
    } catch (e) {
      console.error('No se pudo avisar por correo del respaldo fallido:', e.message);
    }
    throw err; // el programador lo deja en el registro
  }
}

const respaldoDiario = () => hacerRespaldo({ origen: 'automatico' });

// Una línea al arrancar, para que en el registro se vea si los respaldos están
// andando o si falta configurarlos.
function describirRespaldo() {
  const c = configRespaldo();
  if (!c.activo) return `💾 Respaldo automático SIN CONFIGURAR (faltan ${c.faltan.join(', ')}): la base no se está respaldando sola`;
  return `💾 Respaldo automático: todos los días a las 08:30 UTC (02:30 en CR), se conservan ${c.conservar}${c.frase ? ', cifrados' : ', SIN cifrar (falta RESPALDO_CLAVE)'}`;
}

module.exports = { respaldoDiario, hacerRespaldo, describirRespaldo };
