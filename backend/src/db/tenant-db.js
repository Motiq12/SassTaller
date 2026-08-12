// Acceso a MySQL scopeado por tenant (taller suscriptor del SaaS).
//
// El problema que resuelve: con base compartida, una consulta a la que se le olvida
// el filtro por tenant NO falla — devuelve datos de otros talleres. Es una fuga
// silenciosa. Este módulo convierte ese olvido en una excepción.
//
// Uso desde una ruta (req.db lo pone middleware/tenant.js):
//
//   const [filas] = await req.db.query(
//     'SELECT * FROM clientes WHERE tenant_id = @tenant AND activo = 1'
//   );
//
// El marcador `@tenant` se reemplaza por un placeholder `?` y el id del tenant se
// inserta en la posición correcta de los parámetros, así que nunca se pasa a mano
// (y no puede quedar desalineado con los demás `?`).
const { pool } = require('./pool');

// Tablas que llevan tenant_id. Toda consulta que toque alguna de estas DEBE filtrar.
// `tenants` no está: es la tabla raíz, vive por encima del scope.
const TABLAS_CON_TENANT = new Set([
  'citas', 'clientes', 'configuracion', 'email_verify_codes', 'garantia_fotos',
  'garantias', 'login_codes', 'mensaje_lecturas', 'mensajes_internos', 'vehiculos',
  'notificaciones', 'orden_avances', 'orden_checklist', 'orden_contadores',
  'orden_fotos', 'orden_repuestos', 'orden_tiempos', 'ordenes_trabajo',
  'password_reset_codes', 'promos', 'recompensas_canjeadas', 'servicios',
  'sucursales', 'tareas_mecanico', 'usuarios', 'web_vitals',
]);

// Detecta las tablas nombradas en la consulta junto con su alias, si tiene.
// El alias importa: con varias tablas en juego hay que poder exigir el filtro de CADA
// una, no solo que la palabra tenant_id aparezca en algún lado de la consulta.
const RE_TABLAS = /\b(?:from|join|into|update)\s+`?([a-z_][a-z0-9_]*)`?(?:\s+(?:as\s+)?`?([a-z][a-z0-9_]*)`?)?/gi;

// Palabras que siguen a una tabla y NO son un alias (si no, se toman por alias y el
// filtro se exigiría sobre un nombre inventado).
const NO_ALIAS = new Set([
  'on', 'where', 'set', 'values', 'select', 'join', 'left', 'right', 'inner', 'outer',
  'cross', 'group', 'order', 'limit', 'having', 'union', 'and', 'or', 'using', 'ignore',
]);

function tablasUsadas(sql) {
  const encontradas = [];
  for (const m of sql.matchAll(RE_TABLAS)) {
    const tabla = m[1].toLowerCase();
    const posible = (m[2] || '').toLowerCase();
    encontradas.push({ tabla, alias: posible && !NO_ALIAS.has(posible) ? posible : null });
  }
  return encontradas;
}

// Recorre el SQL contando placeholders, pero SIN mirar dentro de literales de
// texto: un '?' o un '@tenant' dentro de comillas es dato, no placeholder, y
// tratarlo como tal desalinearía todos los parámetros siguientes.
function expandir(sql, params, tenantId) {
  const paramsUsuario = [...params];
  const finales = [];
  let salida = '';
  let comilla = null;

  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];

    if (comilla) {
      salida += c;
      if (c === '\\') { salida += sql[++i] ?? ''; continue; }  // escape dentro del literal
      if (c === comilla) comilla = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { comilla = c; salida += c; continue; }

    if (sql.startsWith('@tenant', i)) {
      salida += '?';
      finales.push(tenantId);
      i += '@tenant'.length - 1;
      continue;
    }
    if (c === '?') {
      salida += '?';
      if (!paramsUsuario.length) {
        throw new Error('tenant-db: hay más placeholders `?` que parámetros recibidos');
      }
      finales.push(paramsUsuario.shift());
      continue;
    }
    salida += c;
  }

  if (paramsUsuario.length) {
    throw new Error(`tenant-db: sobran ${paramsUsuario.length} parámetro(s) sin placeholder`);
  }
  return { sql: salida, params: finales };
}

// Red de seguridad: si la consulta toca una tabla con tenant y en ningún lado
// menciona tenant_id, es casi seguro una fuga. Preferimos romper acá —en el primer
// request de desarrollo— antes que servir datos de otro taller en producción.
function exigirScope(sql) {
  const tocadas = tablasUsadas(sql).filter(t => TABLAS_CON_TENANT.has(t.tabla));
  if (!tocadas.length) return;

  // Se exige el filtro de CADA tabla, no solo que `tenant_id` aparezca suelto: una
  // consulta con el JOIN scopeado pero la tabla principal sin filtrar devolvería
  // igual las filas de todos los talleres, y una comprobación global la dejaría pasar.
  const sinFiltrar = tocadas.filter(({ alias }) => {
    if (alias) return !new RegExp(`\\b${alias}\\.tenant_id\\b`, 'i').test(sql);
    // Sin alias solo puede haber una tabla en juego: alcanza con el tenant_id pelado
    // (o cualificado, si el SQL lo escribe con el nombre de la tabla por delante).
    return !/(?:^|[^.\w])tenant_id\b/i.test(sql);
  });
  if (!sinFiltrar.length) return;

  const detalle = sinFiltrar.map(t => (t.alias ? `${t.tabla} (${t.alias})` : t.tabla)).join(', ');
  throw new Error(
    `tenant-db: la consulta toca ${detalle} sin filtrar por tenant_id. ` +
    'Agregá `tenant_id = @tenant`, o usá sinScope() si es intencional (ej. login).'
  );
}

// Cliente ligado a un tenant. Es lo que las rutas reciben como req.db.
function paraTenant(tenantId) {
  if (!Number.isInteger(tenantId) || tenantId <= 0) {
    throw new Error(`tenant-db: tenantId inválido (${tenantId})`);
  }
  const ejecutar = async (sql, params = []) => {
    exigirScope(sql);
    const q = expandir(sql, params, tenantId);
    return pool.query(q.sql, q.params);
  };
  // Conexión dedicada (transacciones, FOR UPDATE) con el mismo scope y el mismo
  // guard que `query`. Se expone con control manual —begin/commit/rollback/release—
  // en vez de un callback porque las rutas ya deciden ahí adentro qué HTTP devolver
  // en cada rollback, y envolverlas cambiaría ese flujo.
  const conexion = async () => {
    const conn = await pool.getConnection();
    const enConn = async (sql, params = []) => {
      exigirScope(sql);
      const q = expandir(sql, params, tenantId);
      return conn.query(q.sql, q.params);
    };
    return {
      tenantId,
      query: enConn,
      execute: enConn,
      beginTransaction: () => conn.beginTransaction(),
      commit: () => conn.commit(),
      rollback: () => conn.rollback(),
      release: () => conn.release(),
      sinScope: (sql, params = []) => conn.query(sql, params),
    };
  };

  return {
    tenantId,
    query: ejecutar,
    execute: ejecutar,
    conexion,
    getConnection: conexion,
    // Escape hatch explícito y greppable: consultas que legítimamente cruzan
    // tenants (login, tareas de plataforma, métricas agregadas). Se salta la
    // verificación a propósito, por eso conviene que sean pocas y auditables.
    sinScope: (sql, params = []) => pool.query(sql, params),
  };
}

// Chequeo de arranque: si alguien agrega una tabla con tenant_id y no la suma a la
// lista de arriba, el guard dejaría pasar sus consultas sin filtro. Esto lo detecta
// al iniciar en vez de en producción.
async function verificarListaContraEsquema() {
  const [filas] = await pool.query(
    `SELECT table_name AS t FROM information_schema.columns
     WHERE table_schema = DATABASE() AND column_name = 'tenant_id'`
  );
  const enBase = new Set(filas.map(f => String(f.t).toLowerCase()));
  const faltan = [...enBase].filter(t => !TABLAS_CON_TENANT.has(t));
  const sobran = [...TABLAS_CON_TENANT].filter(t => !enBase.has(t));
  if (faltan.length || sobran.length) {
    console.warn(
      '⚠️  tenant-db: la lista TABLAS_CON_TENANT no coincide con el esquema.' +
      (faltan.length ? ` Faltan: ${faltan.join(', ')}.` : '') +
      (sobran.length ? ` Sobran: ${sobran.join(', ')}.` : '')
    );
    return false;
  }
  return true;
}

// Recorre los talleres activos ejecutando `fn(db, tenant)` con el acceso ya scopeado.
// Es la vía para las tareas de fondo (recordatorios, no-show): corren sin request, así
// que no hay token del que sacar el taller. Antes de multi-tenant una sola pasada
// alcanzaba; ahora cada taller tiene su configuración —franja horaria, si quiere
// recordatorios— y hay que resolverlos uno por uno.
//
// El error de un taller no corta el barrido: se loguea y sigue con el siguiente, para
// que un dato roto en uno no deje sin recordatorios a todos los demás.
async function porCadaTenant(fn) {
  const [tenants] = await pool.query(
    "SELECT id, nombre, slug FROM tenants WHERE estado = 'activo' ORDER BY id"
  );
  const resultados = [];
  for (const tenant of tenants) {
    try {
      resultados.push({ tenant: tenant.id, resultado: await fn(paraTenant(tenant.id), tenant) });
    } catch (err) {
      console.error(`⚠️  Tarea de fondo falló para el taller ${tenant.slug}:`, err.message);
      resultados.push({ tenant: tenant.id, error: err.message });
    }
  }
  return resultados;
}

// `exigirScope` se exporta para que los tests auditen el SQL del repo con la MISMA
// lógica que corre en producción. Con una copia en el test, las dos podrían divergir
// y el test daría por buena una consulta que en runtime falla (o al revés).
module.exports = { paraTenant, porCadaTenant, verificarListaContraEsquema, exigirScope, TABLAS_CON_TENANT };
