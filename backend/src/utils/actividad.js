// "Mi actividad" del personal (Mi perfil): lo último que hizo cada quien.
//
// Lo de su cuenta (ingresos, contraseña, dos pasos, sesiones) se anota en
// `actividad_personal` desde que existe esa tabla. Lo del trabajo sale de las tablas
// que ya guardan quién hizo qué: citas que agendó, órdenes que abrió, avances,
// garantías, bloqueos, feriados, cambios del sitio web y respaldos. Cada fuente se
// consulta aparte y se mezcla acá (un UNION entre tablas choca por collation).

const { pool } = require('../db/pool');

const TEXTO_CUENTA = {
  ingreso: 'Entraste al sistema',
  contrasena: 'Cambiaste tu contraseña',
  dosfa_on: 'Activaste la verificación en dos pasos',
  dosfa_off: 'Desactivaste la verificación en dos pasos',
  sesion_cerrada: 'Cerraste una sesión abierta',
  sesiones_cerradas: 'Cerraste tus otras sesiones',
  foto: 'Cambiaste tu foto',
  firma: 'Guardaste tu firma',
  cuenta: 'Cambiaste los datos de tu cuenta',
  cierre_equipo: 'Cerraste sesiones del equipo',
  cita_eliminada: 'Borraste una cita',
};

// Nunca lanza: anotar no puede romper la operación que lo dispara.
function anotar(usuarioId, accion, detalle = null) {
  if (!usuarioId) return;
  pool.query('INSERT INTO actividad_personal (tenant_id, usuario_id, accion, detalle) SELECT tenant_id, id, ?, ? FROM usuarios WHERE id = ?',
    [accion, detalle ? String(detalle).slice(0, 300) : null, usuarioId])
    .catch((e) => console.error('No se pudo anotar la actividad:', e.code || e.message));
}

const corto = (t, n = 80) => { const s = String(t || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const nombre = (a, b) => [a, b].filter(Boolean).join(' ').trim();

// Cada fuente devuelve [{ tipo, texto, detalle, orden_id, fecha }]. Si una tabla falla
// (p. ej. todavía no existe en una base vieja) se salta y el resto se muestra igual.
const FUENTES = [
  ['cuenta', `SELECT accion, detalle, created_at AS fecha FROM actividad_personal WHERE usuario_id = ? ORDER BY id DESC LIMIT ?`,
    (f) => ({ texto: TEXTO_CUENTA[f.accion] || f.accion, detalle: f.detalle })],
  ['cita', `SELECT ci.fecha AS dia, ci.hora, ci.created_at AS fecha, cl.nombre, cl.apellido
            FROM citas ci LEFT JOIN clientes cl ON cl.id = ci.cliente_id
            WHERE ci.usuario_id = ? ORDER BY ci.id DESC LIMIT ?`,
    (f) => ({ texto: `Agendaste una cita${nombre(f.nombre, f.apellido) ? ' de ' + nombre(f.nombre, f.apellido) : ''}`,
      detalle: f.dia ? `Para el ${new Date(f.dia).toLocaleDateString('es-CR', { timeZone: 'UTC', day: 'numeric', month: 'short' })}${f.hora ? ' a las ' + String(f.hora).slice(0, 5) : ''}` : null })],
  ['orden', `SELECT id AS orden_id, numero_orden, created_at AS fecha FROM ordenes_trabajo
             WHERE recepcionista_id = ? ORDER BY id DESC LIMIT ?`,
    (f) => ({ texto: `Abriste la orden ${f.numero_orden}`, orden_id: f.orden_id })],
  ['avance', `SELECT a.orden_id, a.descripcion, a.created_at AS fecha, o.numero_orden
              FROM orden_avances a JOIN ordenes_trabajo o ON o.id = a.orden_id
              WHERE a.usuario_id = ? ORDER BY a.id DESC LIMIT ?`,
    (f) => ({ texto: `Anotaste un avance en ${f.numero_orden}`, detalle: corto(f.descripcion), orden_id: f.orden_id })],
  ['garantia', `SELECT g.orden_id, g.descripcion_problema, g.created_at AS fecha, o.numero_orden
                FROM garantias g LEFT JOIN ordenes_trabajo o ON o.id = g.orden_id
                WHERE g.creado_por = ? ORDER BY g.id DESC LIMIT ?`,
    (f) => ({ texto: `Registraste una garantía${f.numero_orden ? ' de ' + f.numero_orden : ''}`, detalle: corto(f.descripcion_problema), orden_id: f.orden_id })],
  ['bloqueo', `SELECT motivo, created_at AS fecha FROM bloqueos_horario WHERE creado_por = ? ORDER BY id DESC LIMIT ?`,
    (f) => ({ texto: 'Bloqueaste horario en la agenda', detalle: corto(f.motivo) })],
  ['feriado', `SELECT nombre, created_at AS fecha FROM feriados WHERE creado_por = ? ORDER BY id DESC LIMIT ?`,
    (f) => ({ texto: `Agregaste el feriado ${corto(f.nombre, 60)}` })],
  ['sitio', `SELECT descripcion, created_at AS fecha FROM web_historial WHERE usuario_id = ? ORDER BY id DESC LIMIT ?`,
    (f) => ({ texto: 'Cambiaste el sitio web', detalle: corto(f.descripcion) })],
  ['respaldo', `SELECT ok, created_at AS fecha FROM respaldos_registro WHERE usuario_id = ? AND origen = 'panel' ORDER BY id DESC LIMIT ?`,
    (f) => ({ texto: Number(f.ok) ? 'Hiciste un respaldo de la base' : 'Intentaste un respaldo y falló' })],
  ['eliminada', `SELECT numero_orden, motivo, created_at AS fecha FROM ordenes_eliminadas WHERE eliminada_por = ? ORDER BY id DESC LIMIT ?`,
    (f) => ({ texto: `Eliminaste la orden ${f.numero_orden}`, detalle: corto(f.motivo) })],
];

async function actividadDe(usuarioId, limite = 40) {
  const listas = await Promise.all(FUENTES.map(async ([tipo, sql, armar]) => {
    try {
      const [filas] = await pool.query(sql, [usuarioId, limite]);
      return filas.map((f) => ({ tipo, detalle: null, orden_id: null, ...armar(f), fecha: f.fecha }));
    } catch (err) {
      if (err.code !== 'ER_NO_SUCH_TABLE') console.error(`Actividad (${tipo}):`, err.code || err.message);
      return [];
    }
  }));
  // Un solo "Entraste al sistema" por equipo y por día (el más reciente): si no, los
  // ingresos tapan todo lo demás.
  const vistos = new Set();
  return listas.flat()
    .filter((a) => a.fecha)
    .sort((a, b) => new Date(b.fecha) - new Date(a.fecha))
    .filter((a) => {
      if (a.tipo !== 'cuenta' || a.texto !== TEXTO_CUENTA.ingreso) return true;
      const clave = `${a.detalle}|${new Date(a.fecha).toLocaleDateString('en-CA', { timeZone: 'America/Costa_Rica' })}`;
      if (vistos.has(clave)) return false;
      vistos.add(clave);
      return true;
    })
    .slice(0, limite);
}

module.exports = { anotar, actividadDe };
