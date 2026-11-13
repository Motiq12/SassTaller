// Sesiones revocables. El estado de autorización se consulta en cada petición:
// no se cachea, para que todos los workers vean los cierres inmediatamente.

const crypto = require('crypto');
const { pool } = require('../db/pool');

// "Última vez" de una sesión: se anota a lo sumo cada 2 minutos.
const TOQUE_MS = 2 * 60 * 1000;
const toques = new Map();

// { activo, sesiones_desde_ms, rol, tenant_id } del usuario; null si no existe;
// undefined si no se pudo leer la base (quien llama decide: la firma del token ya se
// verificó).
async function estadoDeSesion(id) {
  try {
    const [[u]] = await pool.query('SELECT activo, sesiones_desde_ms, rol, tenant_id FROM usuarios WHERE id = ?', [id]);
    const estado = u ? {
      activo: Number(u.activo) === 1,
      sesiones_desde_ms: u.sesiones_desde_ms == null ? null : Number(u.sesiones_desde_ms),
      rol: u.rol,
      tenant_id: Number(u.tenant_id),
    } : null;
    return estado;
  } catch (err) {
    console.error('⚠️  No se pudo revisar la sesión:', err.code || err.message);
    return undefined;
  }
}

// ¿Esa sesión (sid) sigue abierta? true / false; undefined si la base no respondió.
// Una fila que no existe cuenta como cerrada: el sid lo pone el servidor al firmar.
async function sidAbierto(sid, usuarioId, tenantId) {
  try {
    const [[s]] = await pool.query('SELECT id, cerrada FROM sesiones_personal WHERE sid = ? AND usuario_id = ? AND tenant_id = ? AND vence > NOW()', [sid, usuarioId, tenantId]);
    const abierta = !!s && !s.cerrada;
    if (abierta && Date.now() - (toques.get(sid) || 0) > TOQUE_MS) {
      toques.set(sid, Date.now());
      pool.query('UPDATE sesiones_personal SET ultima_vez = CURRENT_TIMESTAMP WHERE id = ?', [s.id]).catch(() => {});
    }
    return abierta;
  } catch (err) {
    console.error('⚠️  No se pudo revisar la sesión:', err.code || err.message);
    return undefined;
  }
}

// ¿Este token (su payload) sigue valiendo para ese estado?
function sesionVigente(payload, estado) {
  if (!estado || !estado.activo || !Number.isFinite(payload.iat)) return false;
  if (estado.sesiones_desde_ms && Number(payload.iat) * 1000 < estado.sesiones_desde_ms) return false;
  return true;
}

// QP-01: el rol firmado en el token no autoriza por sí solo. Un login que leyó la fila
// antes de que administración le cambiara el rol firma con el rol viejo y abre su
// sesión DESPUÉS del cierre de sesiones, así que ni la fecha ni el sid la invalidan.
// Por eso, en cada petición, el rol (y el taller) del token tiene que coincidir con
// el que la fila tiene AHORA; si no, la sesión no vale y hay que volver a entrar.
// No se relee "antes de firmar" (eso deja otra ventana): se compara siempre.
function rolVigente(payload, estado) {
  if (!estado || typeof estado.rol !== 'string') return false;
  return payload.rol === estado.rol && Number(payload.tenant_id) === Number(estado.tenant_id);
}

// "Chrome en Windows", "App de Android"… Solo para que la persona reconozca el equipo.
function describirAgente(ua) {
  const s = String(ua || '');
  if (!s) return 'Dispositivo desconocido';
  const so = /Android/i.test(s) ? 'Android'
    : /iPhone|iPad|iPod/i.test(s) ? 'iPhone o iPad'
    : /Windows/i.test(s) ? 'Windows'
    : /Mac OS X|Macintosh/i.test(s) ? 'Mac'
    : /Linux/i.test(s) ? 'Linux' : '';
  // La app de Android lleva el sistema adentro de un WebView ("; wv)").
  if (/; wv\)/.test(s)) return `App de ${so || 'celular'}`;
  const nav = /Edg\//.test(s) ? 'Edge'
    : /OPR\//.test(s) ? 'Opera'
    : /Firefox\//.test(s) ? 'Firefox'
    : /Chrome\//.test(s) ? 'Chrome'
    : /Safari\//.test(s) ? 'Safari' : 'Navegador';
  return so ? `${nav} en ${so}` : nav;
}

function nuevoSid() { return crypto.randomBytes(16).toString('hex'); }

// Abre una sesión persistida. Si falla, nunca se debe entregar un token.
async function abrirSesion(usuarioId, req, venceSeg, sid, db = pool) {
  try {
    const [insertada] = await db.query(
      'INSERT INTO sesiones_personal (tenant_id, usuario_id, sid, agente, ip, ultima_vez, vence) SELECT tenant_id, id, ?, ?, ?, CURRENT_TIMESTAMP, to_timestamp(?::bigint) FROM usuarios WHERE id = ?',
      [sid, String(req.headers['user-agent'] || '').slice(0, 255) || null, String(req.ip || '').slice(0, 64) || null, venceSeg, usuarioId]
    );
    if (!insertada.affectedRows) return false;
    // De paso, se borran las vencidas hace más de un mes: la tabla no crece sola.
    db.query("DELETE FROM sesiones_personal WHERE usuario_id = ? AND vence < NOW() - INTERVAL '30 days'", [usuarioId]).catch(() => {});
    return true;
  } catch (err) {
    console.error('⚠️  No se pudo anotar la sesión:', err.code || err.message);
    return false;
  }
}

// Las sesiones abiertas de alguien, la más reciente primero. `actual` marca la de
// quien pregunta.
async function sesionesAbiertas(usuarioId, sidActual) {
  const [filas] = await pool.query(
    `SELECT id, sid, agente, ip, creada, ultima_vez, vence FROM sesiones_personal
     WHERE usuario_id = ? AND cerrada IS NULL AND (vence IS NULL OR vence > NOW())
     ORDER BY COALESCE(ultima_vez, creada) DESC LIMIT 30`,
    [usuarioId]
  );
  const [[u]] = await pool.query('SELECT sesiones_desde_ms FROM usuarios WHERE id = ?', [usuarioId]);
  const desde = u?.sesiones_desde_ms ? Number(u.sesiones_desde_ms) : 0;
  return filas
    // Las que administración cerró de un golpe ya no valen aunque la fila siga abierta.
    .filter((f) => !desde || new Date(f.creada).getTime() >= desde - 1000)
    .map((f) => ({
      id: f.id,
      dispositivo: describirAgente(f.agente),
      // "::ffff:1.2.3.4" es la misma IPv4 escrita como IPv6.
      ip: f.ip ? String(f.ip).replace(/^::ffff:/, '') : null,
      creada: f.creada,
      ultima_vez: f.ultima_vez || f.creada,
      actual: !!sidActual && f.sid === sidActual,
    }));
}

// Cierra una sesión propia (por su id de fila) o todas menos la actual.
async function cerrarSesionPropia(usuarioId, id) {
  const [[s]] = await pool.query('SELECT sid FROM sesiones_personal WHERE id = ? AND usuario_id = ? AND cerrada IS NULL', [id, usuarioId]);
  if (!s) return 0;
  await pool.query('UPDATE sesiones_personal SET cerrada = CURRENT_TIMESTAMP WHERE id = ?', [id]);
  toques.delete(s.sid);
  return 1;
}

async function cerrarOtrasSesiones(usuarioId, sidActual) {
  const [filas] = await pool.query('SELECT sid FROM sesiones_personal WHERE usuario_id = ? AND cerrada IS NULL AND sid <> ?', [usuarioId, sidActual || '']);
  if (!filas.length) return 0;
  await pool.query('UPDATE sesiones_personal SET cerrada = CURRENT_TIMESTAMP WHERE usuario_id = ? AND cerrada IS NULL AND sid <> ?', [usuarioId, sidActual || '']);
  for (const f of filas) toques.delete(f.sid);
  return filas.length;
}

// Al salir con "Cerrar sesión": esa sesión deja de valer aunque alguien guardara el token.
async function cerrarSid(sid) {
  if (!sid) return;
  await pool.query('UPDATE sesiones_personal SET cerrada = CURRENT_TIMESTAMP WHERE sid = ? AND cerrada IS NULL', [sid]);
  toques.delete(sid);
}

// Cierra todas las sesiones abiertas de esos usuarios. Se redondea al segundo, como
// el `iat` del token: un ingreso en el mismo segundo sigue valiendo.
async function cerrarSesiones(ids, db = pool) {
  const lista = [...new Set(ids.map(Number).filter(Boolean))];
  if (!lista.length) return 0;
  const desde = Math.floor(Date.now() / 1000) * 1000;
  // `= ANY(lista)`: en Postgres un `IN (?)` con una lista no funciona (en MySQL sí), y
  // esta función fallaba siempre: no se podía cerrarle la sesión a nadie.
  const scope = db.tenantId ? ' AND tenant_id = @tenant' : '';
  const [r] = await db.query('UPDATE usuarios SET sesiones_desde_ms = ? WHERE id = ANY(?::int[])' + scope, [desde, lista]);
  await db.query('UPDATE sesiones_personal SET cerrada = CURRENT_TIMESTAMP WHERE usuario_id = ANY(?::int[]) AND cerrada IS NULL' + scope, [lista]);
  toques.clear();
  return r.affectedRows || 0;
}

// Al cambiar la contraseña: se cierran todas las demás sesiones de esa persona y queda
// abierta solo la que hizo el cambio. Si alguien más tenía la cuenta abierta, sale.
// Los tokens anteriores al actual dejan de valer por fecha; las sesiones abiertas
// después en otro equipo se cierran por su `sid`.
async function cerrarLasDemas(payload) {
  const desde = Number(payload.iat) * 1000;
  await pool.query(
    'UPDATE usuarios SET sesiones_desde_ms = ? WHERE id = ? AND (sesiones_desde_ms IS NULL OR sesiones_desde_ms < ?)',
    [desde, payload.id, desde]
  );
  await cerrarOtrasSesiones(payload.id, payload.sid);
}

// ── Clientes del portal ──
// Su token no lleva `sid`: se cierran por fecha, y una cuenta eliminada deja de entrar.

async function estadoDeCliente(id) {
  try {
    const [[c]] = await pool.query('SELECT activo, portal_habilitado, portal_version, sesiones_desde_ms FROM clientes WHERE id = ?', [id]);
    const estado = c ? { activo: Number(c.activo) === 1 && Number(c.portal_habilitado) === 1, portal_version: Number(c.portal_version), sesiones_desde_ms: c.sesiones_desde_ms == null ? null : Number(c.sesiones_desde_ms) } : null;
    return estado;
  } catch (err) {
    console.error('⚠️  No se pudo revisar la sesión del cliente:', err.code || err.message);
    return undefined;
  }
}

// Sin `iat`: todas (recuperó la contraseña). Con el `iat` del token actual: todas las
// anteriores a esa (cambió la contraseña y sigue en su sesión).
async function cerrarSesionesDeCliente(id, iat) {
  const desde = iat ? Number(iat) * 1000 : Math.floor(Date.now() / 1000) * 1000;
  await pool.query('UPDATE clientes SET sesiones_desde_ms = ? WHERE id = ?', [desde, id]);
}

function olvidarCliente() {} // Compatibilidad: ya no hay caché de autorización.

// Después de activar o desactivar a alguien: que se note en el próximo pedido.
function olvidar() {}

module.exports = {
  estadoDeSesion, sidAbierto, sesionVigente, rolVigente, cerrarSesiones, olvidar,
  cerrarLasDemas, estadoDeCliente, cerrarSesionesDeCliente, olvidarCliente,
  describirAgente, nuevoSid, abrirSesion, sesionesAbiertas, cerrarSesionPropia, cerrarOtrasSesiones, cerrarSid,
};
