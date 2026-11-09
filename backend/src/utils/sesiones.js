// Sesiones del personal: que una sesión deje de valer antes de que venza el token.
//
// El token (JWT) no se guarda en ningún lado: el servidor solo verifica la firma. Para
// poder cerrar sesiones, cada usuario tiene `sesiones_desde_ms`: los tokens firmados
// antes de ese momento ya no valen. Y un empleado desactivado (o borrado) deja de
// entrar enseguida, en vez de seguir con su token hasta que venza (8 h).
//
// Además cada ingreso abre una fila en `sesiones_personal` (con el dispositivo) y el
// token lleva su `sid`: así la persona ve en Mi perfil dónde está conectada y puede
// cerrar una sola. Un token sin `sid` (de antes de esto) sigue valiendo hasta vencer.
//
// middleware/auth.js lo consulta en cada pedido; para no ir a la base cada vez, el
// estado se guarda 10 s en memoria. Cada worker tiene la suya: un cierre se nota en
// los demás a lo sumo 10 s después.

const crypto = require('crypto');
const { pool } = require('../db/pool');

const TTL_MS = 10 * 1000;
const cache = new Map();
const cacheSid = new Map();
// "Última vez" de una sesión: se anota a lo sumo cada 2 minutos.
const TOQUE_MS = 2 * 60 * 1000;
const toques = new Map();

// { activo, sesiones_desde_ms } del usuario; null si no existe; undefined si no se
// pudo leer la base (quien llama decide: la firma del token ya se verificó).
async function estadoDeSesion(id) {
  const guardado = cache.get(id);
  if (guardado && Date.now() - guardado.t < TTL_MS) return guardado.estado;
  try {
    const [[u]] = await pool.query('SELECT activo, sesiones_desde_ms FROM usuarios WHERE id = ?', [id]);
    const estado = u ? { activo: Number(u.activo) === 1, sesiones_desde_ms: u.sesiones_desde_ms == null ? null : Number(u.sesiones_desde_ms) } : null;
    cache.set(id, { estado, t: Date.now() });
    return estado;
  } catch (err) {
    console.error('⚠️  No se pudo revisar la sesión:', err.code || err.message);
    return undefined;
  }
}

// ¿Esa sesión (sid) sigue abierta? true / false; undefined si la base no respondió.
// Una fila que no existe cuenta como cerrada: el sid lo pone el servidor al firmar.
async function sidAbierto(sid) {
  const guardado = cacheSid.get(sid);
  if (guardado && Date.now() - guardado.t < TTL_MS) return guardado.abierta;
  try {
    const [[s]] = await pool.query('SELECT id, cerrada FROM sesiones_personal WHERE sid = ?', [sid]);
    const abierta = !!s && !s.cerrada;
    cacheSid.set(sid, { abierta, t: Date.now() });
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
  if (!estado || !estado.activo) return false;
  if (estado.sesiones_desde_ms && Number(payload.iat) * 1000 < estado.sesiones_desde_ms) return false;
  return true;
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

// Abre la fila de una sesión nueva. false si no se pudo: quien llama firma el token
// sin sid y la persona entra igual, aunque esa sesión no quede en la lista.
async function abrirSesion(usuarioId, req, venceSeg, sid) {
  try {
    await pool.query(
      'INSERT INTO sesiones_personal (tenant_id, usuario_id, sid, agente, ip, ultima_vez, vence) SELECT tenant_id, id, ?, ?, ?, CURRENT_TIMESTAMP, to_timestamp(?::bigint) FROM usuarios WHERE id = ?',
      [sid, String(req.headers['user-agent'] || '').slice(0, 255) || null, String(req.ip || '').slice(0, 64) || null, venceSeg, usuarioId]
    );
    // De paso, se borran las vencidas hace más de un mes: la tabla no crece sola.
    pool.query("DELETE FROM sesiones_personal WHERE usuario_id = ? AND vence < NOW() - INTERVAL '30 days'", [usuarioId]).catch(() => {});
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
  cacheSid.delete(s.sid);
  return 1;
}

async function cerrarOtrasSesiones(usuarioId, sidActual) {
  const [filas] = await pool.query('SELECT sid FROM sesiones_personal WHERE usuario_id = ? AND cerrada IS NULL AND sid <> ?', [usuarioId, sidActual || '']);
  if (!filas.length) return 0;
  await pool.query('UPDATE sesiones_personal SET cerrada = CURRENT_TIMESTAMP WHERE usuario_id = ? AND cerrada IS NULL AND sid <> ?', [usuarioId, sidActual || '']);
  for (const f of filas) cacheSid.delete(f.sid);
  return filas.length;
}

// Al salir con "Cerrar sesión": esa sesión deja de valer aunque alguien guardara el token.
async function cerrarSid(sid) {
  if (!sid) return;
  await pool.query('UPDATE sesiones_personal SET cerrada = CURRENT_TIMESTAMP WHERE sid = ? AND cerrada IS NULL', [sid]);
  cacheSid.delete(sid);
}

// Cierra todas las sesiones abiertas de esos usuarios. Se redondea al segundo, como
// el `iat` del token: un ingreso en el mismo segundo sigue valiendo.
async function cerrarSesiones(ids) {
  const lista = [...new Set(ids.map(Number).filter(Boolean))];
  if (!lista.length) return 0;
  const desde = Math.floor(Date.now() / 1000) * 1000;
  const [r] = await pool.query('UPDATE usuarios SET sesiones_desde_ms = ? WHERE id IN (?)', [desde, lista]);
  await pool.query('UPDATE sesiones_personal SET cerrada = CURRENT_TIMESTAMP WHERE usuario_id IN (?) AND cerrada IS NULL', [lista])
    .catch((e) => console.error('No se pudieron marcar las sesiones:', e.code || e.message));
  for (const id of lista) cache.delete(id);
  cacheSid.clear();
  return r.affectedRows || 0;
}

// Después de activar o desactivar a alguien: que se note en el próximo pedido.
function olvidar(id) { cache.delete(Number(id)); }

module.exports = {
  estadoDeSesion, sidAbierto, sesionVigente, cerrarSesiones, olvidar,
  describirAgente, nuevoSid, abrirSesion, sesionesAbiertas, cerrarSesionPropia, cerrarOtrasSesiones, cerrarSid,
};
