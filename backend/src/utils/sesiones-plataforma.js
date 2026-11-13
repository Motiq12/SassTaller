// Sesiones revocables de la cuenta de plataforma (B-06), con el mismo criterio que las
// del personal (utils/sesiones.js): cada pedido consulta la base, sin caché, para que
// un cierre se note en todos los workers en el pedido siguiente.
//
// La sesión vale si: la fila del sid existe, no está cerrada ni vencida, la cuenta
// sigue activa y con el segundo factor, y la versión de credenciales con que se abrió
// es la de ahora (QA34-02).
const { pool } = require('../db/pool');
const { nuevoSid } = require('./sesiones');

const DURACION_SEG = 8 * 60 * 60; // lo que dura el token del panel

// "Última vez" de una sesión: se anota a lo sumo cada 2 minutos.
const TOQUE_MS = 2 * 60 * 1000;
const toques = new Map();

// Abre una sesión persistida y devuelve su sid, o null si no se pudo (y entonces no
// se entrega token). `credenciales` es la versión que leyó el login junto con el hash
// que comprobó, no la de ahora: si la contraseña cambió en el medio, la sesión nace
// con la versión vieja y no autoriza nada.
async function abrirSesion(adminId, req, credenciales) {
  const sid = nuevoSid();
  try {
    const [r] = await pool.query(
      `INSERT INTO plataforma_sesiones (admin_id, sid, agente, ip, ultima_vez, vence, credenciales_version)
       SELECT id, ?, ?, ?, CURRENT_TIMESTAMP, NOW() + make_interval(secs => ?), ?::int
         FROM plataforma_admins WHERE id = ? AND activo = 1`,
      [sid, String(req.headers['user-agent'] || '').slice(0, 255) || null, String(req.ip || '').slice(0, 64) || null,
        DURACION_SEG, Number(credenciales), adminId]
    );
    if (!r.affectedRows) return null;
    pool.query("DELETE FROM plataforma_sesiones WHERE admin_id = ? AND vence < NOW() - INTERVAL '30 days'", [adminId]).catch(() => {});
    return sid;
  } catch (err) {
    console.error('⚠️  No se pudo anotar la sesión de plataforma:', err.code || err.message);
    return null;
  }
}

// true si la sesión sigue valiendo, false si no, undefined si la base no respondió
// (quien llama falla cerrado).
async function sesionVigente(adminId, sid) {
  try {
    const [[s]] = await pool.query(
      `SELECT s.id, s.cerrada, s.credenciales_version AS cv_sesion,
              a.activo, a.totp_activado, a.credenciales_version AS cv_cuenta
         FROM plataforma_sesiones s JOIN plataforma_admins a ON a.id = s.admin_id
        WHERE s.sid = ? AND s.admin_id = ? AND s.vence > NOW()`,
      [sid, adminId]
    );
    const vale = !!s && !s.cerrada && Number(s.activo) === 1 && Number(s.totp_activado) === 1
      && Number(s.cv_sesion) === Number(s.cv_cuenta);
    if (vale && Date.now() - (toques.get(sid) || 0) > TOQUE_MS) {
      toques.set(sid, Date.now());
      pool.query('UPDATE plataforma_sesiones SET ultima_vez = CURRENT_TIMESTAMP WHERE id = ?', [s.id]).catch(() => {});
    }
    return vale;
  } catch (err) {
    console.error('⚠️  No se pudo revisar la sesión de plataforma:', err.code || err.message);
    return undefined;
  }
}

// "Salir": esa sesión deja de valer aunque alguien haya guardado el token.
async function cerrarSid(adminId, sid) {
  await pool.query('UPDATE plataforma_sesiones SET cerrada = CURRENT_TIMESTAMP WHERE sid = ? AND admin_id = ? AND cerrada IS NULL', [sid, adminId]);
  toques.delete(sid);
}

// Cambio de la propia contraseña, en UNA sentencia: guarda el hash, sube la versión de
// credenciales y le pasa la versión nueva a la sesión desde la que se hizo el cambio,
// que sigue abierta. Después se cierran todas las demás. Un login con la contraseña
// vieja que todavía no terminó queda con la versión anterior y no sirve.
async function cambiarContrasena(adminId, sidActual, hash) {
  await pool.query(
    `WITH a AS (
       UPDATE plataforma_admins SET password_hash = ?, credenciales_version = credenciales_version + 1
        WHERE id = ? AND activo = 1 RETURNING credenciales_version
     )
     UPDATE plataforma_sesiones SET credenciales_version = (SELECT credenciales_version FROM a)
      WHERE sid = ? AND admin_id = ? AND cerrada IS NULL`,
    [hash, adminId, sidActual, adminId]
  );
  await pool.query(
    'UPDATE plataforma_sesiones SET cerrada = CURRENT_TIMESTAMP WHERE admin_id = ? AND sid <> ? AND cerrada IS NULL',
    [adminId, sidActual]
  );
  toques.clear();
}

// Cierra todas las sesiones abiertas de la cuenta (al desactivarla o recuperarla).
async function cerrarTodas(adminId, db = pool) {
  await db.query('UPDATE plataforma_sesiones SET cerrada = CURRENT_TIMESTAMP WHERE admin_id = ? AND cerrada IS NULL', [adminId]);
  toques.clear();
}

// Recuperación de la cuenta (scripts/crear-admin-motiq.js): crea la cuenta o le pone
// una contraseña nueva. Al actualizar sube la versión de credenciales y cierra todas
// sus sesiones, en una transacción. `reiniciar2fa` borra el segundo factor (teléfono y
// códigos de respaldo perdidos): el próximo ingreso lo vuelve a configurar.
async function restablecerCuenta({ nombre, email, hash, reiniciar2fa = false }) {
  const cliente = await pool.getConnection();
  try {
    await cliente.beginTransaction();
    const [[r]] = await cliente.query(
      `INSERT INTO plataforma_admins (nombre, email, password_hash, activo) VALUES (?, ?, ?, 1)
       ON CONFLICT (email) DO UPDATE SET nombre = EXCLUDED.nombre, password_hash = EXCLUDED.password_hash, activo = 1,
         credenciales_version = plataforma_admins.credenciales_version + 1
       RETURNING id, (xmax = 0)::int AS creado`,
      [nombre, email, hash]
    );
    if (reiniciar2fa) {
      await cliente.query(
        'UPDATE plataforma_admins SET totp_activado = 0, totp_secret = NULL, totp_backup = NULL, totp_ultimo_contador = NULL WHERE id = ?',
        [r.id]
      );
    }
    await cerrarTodas(r.id, cliente);
    await cliente.commit();
    return { id: r.id, creado: !!r.creado };
  } catch (err) {
    await cliente.rollback().catch(() => {});
    throw err;
  } finally {
    cliente.release();
  }
}

module.exports = { DURACION_SEG, abrirSesion, sesionVigente, cerrarSid, cambiarContrasena, cerrarTodas, restablecerCuenta };
