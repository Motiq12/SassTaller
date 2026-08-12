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
  'garantias', 'login_codes', 'mensaje_lecturas', 'mensajes_internos', 'motos',
  'notificaciones', 'orden_avances', 'orden_checklist', 'orden_contadores',
  'orden_fotos', 'orden_repuestos', 'orden_tiempos', 'ordenes_trabajo',
  'password_reset_codes', 'promos', 'recompensas_canjeadas', 'servicios',
  'sucursales', 'tareas_mecanico', 'usuarios', 'web_vitals',
]);

// Detecta las tablas nombradas en la consulta (FROM, JOIN, UPDATE, INSERT, DELETE).
const RE_TABLAS = /\b(?:from|join|into|update)\s+`?([a-z_][a-z0-9_]*)`?/gi;

function tablasUsadas(sql) {
  const encontradas = new Set();
  for (const m of sql.matchAll(RE_TABLAS)) encontradas.add(m[1].toLowerCase());
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
  const tocadas = [...tablasUsadas(sql)].filter(t => TABLAS_CON_TENANT.has(t));
  if (!tocadas.length) return;
  if (/tenant_id/i.test(sql)) return;
  throw new Error(
    `tenant-db: la consulta toca ${tocadas.join(', ')} sin filtrar por tenant_id. ` +
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
  return {
    tenantId,
    query: ejecutar,
    execute: ejecutar,
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

module.exports = { paraTenant, verificarListaContraEsquema, TABLAS_CON_TENANT };
