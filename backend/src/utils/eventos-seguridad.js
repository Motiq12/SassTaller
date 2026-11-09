// Eventos de seguridad: lo que conviene que alguien vea aunque no esté mirando el panel.
// Se anotan en `eventos_seguridad` y los lee el vigilante de n8n por
// GET /api/monitor/seguridad (routes/monitor.routes.js) para avisar por Telegram:
// muchos logins fallidos, un administrador nuevo, alguien que apagó la verificación en
// dos pasos, un respaldo que no salió.
//
// Anotar nunca rompe la operación que lo dispara (igual que utils/actividad.js).
const crypto = require('crypto');
const { pool } = require('../db/pool');

// Lo que se anota. Los que hace una persona del equipo llevan `actor_id`.
const TIPOS = {
  login_fallido: 'Login fallido',
  login_bloqueado: 'Bloqueado por demasiados intentos',
  dosfa_fallido: 'Código de dos pasos incorrecto',
  portal_login_fallido: 'Login fallido en el portal',
  recuperacion_pedida: 'Recuperación de contraseña pedida (portal)',
  usuario_creado: 'Usuario del equipo creado',
  rol_cambiado: 'Cambio de rol',
  usuario_activado: 'Cuenta activada',
  usuario_desactivado: 'Cuenta desactivada',
  usuario_eliminado: 'Usuario eliminado',
  dosfa_desactivado: 'Verificación en dos pasos desactivada',
  rol_editado: 'Casillas de un rol cambiadas',
};

// Los que son "cambios" (una persona tocó cuentas o permisos) y no intentos.
const CAMBIOS = ['usuario_creado', 'rol_cambiado', 'usuario_activado', 'usuario_desactivado',
  'usuario_eliminado', 'dosfa_desactivado', 'rol_editado'];

const DIAS_GUARDADOS = 90;

function registrarEvento(tipo, { email = null, ip = null, usuarioId = null, actorId = null, detalle = null } = {}) {
  if (!TIPOS[tipo]) return;
  pool.query(
    // El taller sale del usuario o de quien actuó. Un intento fallido con un correo que
    // no existe no es de ningún taller: queda en NULL, no en el taller 1.
    'INSERT INTO eventos_seguridad (tenant_id, tipo, email, ip, usuario_id, actor_id, detalle) VALUES ((SELECT tenant_id FROM usuarios WHERE id = COALESCE(?, ?)), ?, ?, ?, ?, ?, ?)',
    [actorId || null, usuarioId || null, tipo, email ? String(email).trim().toLowerCase().slice(0, 190) : null, ip ? String(ip).slice(0, 64) : null,
      usuarioId || null, actorId || null, detalle ? String(detalle).slice(0, 300) : null]
  ).catch((e) => console.error('No se pudo anotar el evento de seguridad:', e.code || e.message));
  // Un intento fallido cada tanto limpia lo viejo: un ataque llena la tabla rápido.
  if (Math.random() < 0.01) {
    pool.query(`DELETE FROM eventos_seguridad WHERE created_at < NOW() - INTERVAL ${DIAS_GUARDADOS} DAY`).catch(() => {});
  }
}

// "jefry@gmail.com" → "j***@gmail.com". Para correos que no son del equipo (clientes
// o inventados por quien prueba contraseñas): el aviso dice a quién apuntan sin
// mandar el correo completo de un cliente a un grupo de Telegram.
function enmascararCorreo(email) {
  const s = String(email || '');
  const at = s.indexOf('@');
  if (at < 1) return s ? s.charAt(0) + '***' : '';
  return s.charAt(0) + '***' + s.slice(at);
}

// ¿La clave que manda n8n es la de MONITOR_CLAVE? Compara los resúmenes SHA-256 con
// timingSafeEqual: así el tiempo de respuesta no delata cuántos caracteres acertó.
function claveCorrecta(recibida, esperada) {
  if (!esperada || !recibida) return false;
  const a = crypto.createHash('sha256').update(String(recibida)).digest();
  const b = crypto.createHash('sha256').update(String(esperada)).digest();
  return crypto.timingSafeEqual(a, b);
}

// Lo que pasó en los últimos `minutos`, más el estado del último respaldo.
async function resumenSeguridad(minutos) {
  const [filas] = await pool.query(
    `SELECT e.tipo, e.email, e.ip, e.detalle, e.created_at,
            a.nombre AS actor, u.nombre AS usuario_nombre, u.email AS usuario_email
     FROM eventos_seguridad e
     LEFT JOIN usuarios a ON a.id = e.actor_id
     LEFT JOIN usuarios u ON u.id = e.usuario_id
     WHERE e.created_at >= NOW() - INTERVAL ? MINUTE
     ORDER BY e.id`,
    [minutos]
  );
  // ¿El correo es de alguien del equipo? Se compara acá y no con un JOIN: las dos
  // tablas pueden tener collation distinta y MySQL no deja compararlas.
  const [equipo] = await pool.query('SELECT LOWER(email) AS email FROM usuarios');
  const delEquipo = new Set(equipo.map((u) => u.email));
  for (const f of filas) f.es_del_equipo = !!f.email && delEquipo.has(String(f.email).toLowerCase());

  const cuenta = (lista) => Object.entries(lista.reduce((acc, k) => { acc[k] = (acc[k] || 0) + 1; return acc; }, {}))
    .map(([clave, n]) => ({ clave, n })).sort((x, y) => y.n - x.n).slice(0, 5);
  const fallidos = filas.filter((f) => f.tipo === 'login_fallido' || f.tipo === 'portal_login_fallido');
  const correo = (f) => (f.es_del_equipo ? f.email : enmascararCorreo(f.email));

  return {
    minutos,
    logins_fallidos: {
      total: fallidos.length,
      por_cuenta: cuenta(fallidos.filter((f) => f.email).map(correo)).map(({ clave, n }) => ({ cuenta: clave, intentos: n })),
      por_ip: cuenta(fallidos.filter((f) => f.ip).map((f) => f.ip)).map(({ clave, n }) => ({ ip: clave, intentos: n })),
      a_cuentas_del_equipo: fallidos.filter((f) => f.es_del_equipo).length,
    },
    bloqueos_por_intentos: filas.filter((f) => f.tipo === 'login_bloqueado').length,
    dosfa_fallidos: filas.filter((f) => f.tipo === 'dosfa_fallido').length,
    recuperaciones_pedidas: filas.filter((f) => f.tipo === 'recuperacion_pedida').length,
    cambios: filas.filter((f) => CAMBIOS.includes(f.tipo)).map((f) => ({
      tipo: f.tipo,
      que: TIPOS[f.tipo],
      quien: f.actor || null,
      sobre: f.usuario_nombre ? `${f.usuario_nombre} (${f.usuario_email})` : null,
      detalle: f.detalle,
      cuando: f.created_at,
    })),
    respaldo: await ultimoRespaldo(),
  };
}

async function ultimoRespaldo() {
  try {
    const [[ultimo]] = await pool.query(
      'SELECT ok, error, created_at FROM respaldos_registro WHERE origen = ? ORDER BY id DESC LIMIT 1', ['automatico']
    );
    const [[bueno]] = await pool.query(
      `SELECT TIMESTAMPDIFF(HOUR, created_at, NOW()) AS horas FROM respaldos_registro
       WHERE ok = 1 ORDER BY id DESC LIMIT 1`
    );
    return {
      ultimo_ok: ultimo ? !!ultimo.ok : null,
      ultimo_error: ultimo && !ultimo.ok ? String(ultimo.error || '').slice(0, 200) : null,
      ultimo_cuando: ultimo ? ultimo.created_at : null,
      horas_desde_el_ultimo_bueno: bueno ? Number(bueno.horas) : null,
    };
  } catch {
    return null; // tabla sin migrar: el resto del resumen sirve igual
  }
}

module.exports = { TIPOS, registrarEvento, enmascararCorreo, claveCorrecta, resumenSeguridad };
