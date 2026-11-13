// Cupo de la agenda: que dos reservas simultáneas no tomen la misma última plaza (B-13).
//
// Toda ruta que crea una cita, la mueve o le cambia la duración llama a bloquearAgenda
// dentro de su transacción, ANTES de contar las citas, y valida e inserta (o mueve) en
// esa misma transacción. El candado se suelta solo con el COMMIT o el ROLLBACK.
//
// Por qué un candado consultivo y no `FOR UPDATE`: bloquear las filas que ya existen no
// frena a una fila NUEVA que compite por el mismo cupo, que es justo la carrera. Con el
// candado, la segunda reserva espera a que la primera confirme y recién entonces cuenta.
//
// Qué se bloquea: la agenda de UN día de UNA sede del taller. No la hora suelta, porque
// una cita ocupa todas las horas que dura (hasta el día entero, ver utils/agenda.js) y
// administración puede alargarla: con candados por hora, cada camino tendría que
// calcular qué horas toca y alcanzaría con que uno se equivoque. El día entero de una
// sede es lo que lee agendaDia, así que lo que se cuenta es exactamente lo bloqueado.
// En un taller las reservas de una sede para un mismo día son pocas: la espera no se nota.
//
// Sedes y reservas sin sede: recepción puede agendar sin elegir sede, y entonces el
// cupo se cuenta sobre TODAS las sedes de ese día (agendaRango sin sucursalId). Por eso
// hay dos niveles por día:
//   · reserva con sede  → candado COMPARTIDO del día + candado EXCLUSIVO de su sede;
//   · reserva sin sede  → candado EXCLUSIVO del día.
// Dos sedes distintas no se esperan entre sí; una reserva sin sede espera a todas.
//
// Talleres: el primer entero del candado es el id del taller, así que dos talleres
// nunca comparten candado (ni por una colisión del hash del resto de la clave).
//
// Orden de bloqueo (sin interbloqueos, QP3-02): un orden GLOBAL de los recursos. Por
// fecha ascendente y, en cada fecha, primero el nivel del día y después las sedes por id
// ascendente. Cada transacción pide TODO lo que necesita (el origen de la cita que mueve
// y el destino) de una sola vez y en ese orden, con un solo modo por clave (nunca pasa
// de compartido a exclusivo). Así dos movidas cruzadas (A→B y B→A) se ponen en fila en
// vez de trabarse. Todas las rutas pasan por acá.
//
// Las filas de citas NO se bloquean para contar (nada de FOR UPDATE sobre el día): el
// candado consultivo ya protege esa lectura, y bloquear filas de otras citas era lo que
// cerraba el ciclo del deadlock. La única fila que se bloquea es la de la cita que se
// modifica, y siempre DESPUÉS de los candados consultivos (ver conCitaEnAgenda).
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

// Ubicación = { fecha, sucursalId } (sucursalId null: sin sede, cuenta todas).
function normalizar(ubicaciones) {
  const porDia = new Map();
  for (const u of [].concat(ubicaciones)) {
    const dia = String(u?.fecha || '').slice(0, 10);
    if (!FECHA.test(dia)) continue;
    const sede = Number(u.sucursalId) || null;
    if (!porDia.has(dia)) porDia.set(dia, { sinSede: false, sedes: new Set() });
    const d = porDia.get(dia);
    if (sede) d.sedes.add(sede); else d.sinSede = true;
  }
  return [...porDia.keys()].sort().map((dia) => {
    const d = porDia.get(dia);
    // El candado exclusivo del día ya excluye a todas sus sedes: con él no hace falta
    // (ni se debe: sería pasar de exclusivo a compartido) pedir las de sede.
    return { dia, sinSede: d.sinSede, sedes: d.sinSede ? [] : [...d.sedes].sort((a, b) => a - b) };
  });
}

// Clave legible del conjunto bloqueado, para saber si cambió entre dos lecturas.
function claveUbicaciones(ubicaciones) {
  return JSON.stringify(normalizar(ubicaciones));
}

async function bloquearUbicaciones(conn, ubicaciones) {
  if (!Number.isInteger(conn?.tenantId)) throw new Error('bloquearAgenda: falta la conexión del taller');
  for (const { dia, sinSede, sedes } of normalizar(ubicaciones)) {
    if (sinSede) {
      await conn.query('SELECT pg_advisory_xact_lock(?::int, hashtext(?))', [conn.tenantId, `agenda:${dia}`]);
      continue;
    }
    await conn.query('SELECT pg_advisory_xact_lock_shared(?::int, hashtext(?))', [conn.tenantId, `agenda:${dia}`]);
    for (const sede of sedes) {
      await conn.query('SELECT pg_advisory_xact_lock(?::int, hashtext(?))', [conn.tenantId, `agenda:${dia}:sede:${sede}`]);
    }
  }
}

async function bloquearAgenda(conn, sucursalId, fechas) {
  await bloquearUbicaciones(conn, [].concat(fechas).map((fecha) => ({ fecha, sucursalId })));
}

// Nombre anterior (una franja = fecha + hora). Bloquea el día entero de la sede.
async function bloquearFranja(conn, sucursalId, fecha, _hora) {
  await bloquearAgenda(conn, sucursalId, [fecha]);
}

// Error que la ruta responde con 409 (y no 500): la agenda estaba demasiado disputada.
class AgendaOcupada extends Error {
  constructor(mensaje = 'La agenda cambió mientras se guardaba. Intentá de nuevo.') {
    super(mensaje);
    this.status = 409;
    this.agendaOcupada = true;
  }
}

const INTENTOS = 4;
const esInterbloqueo = (e) => e && (e.code === '40P01' || e.sqlState === '40P01');

// Transacción de agenda sobre una cita QUE YA EXISTE: moverla, cambiarle la sede o la
// duración (QP3-02, QP3-03). El protocolo:
//   1. `leer(db)` la cita sin bloqueo, solo para saber qué candados hacen falta;
//   2. abrir la transacción y bloquear, en el orden global, su ubicación ACTUAL (origen)
//      y las de `destinos(cita)`. Quien cambie la ubicación o la duración de esta cita
//      tiene que tener el candado de su ubicación actual: con el origen tomado, nadie
//      la cambia mientras tanto;
//   3. releer la cita adentro (`leer(conn, true)`, FOR UPDATE de esa sola fila) y, si
//      su ubicación o sus destinos ya no son los bloqueados, deshacer y empezar de
//      nuevo: lo que se valida es la cita vigente, no la leída antes del candado;
//   4. `fn(conn, cita)` valida con la duración y la ubicación releídas, y escribe.
// `fn` devuelve { error } para deshacer, o lo que sea para confirmar. Un interbloqueo
// (40P01) con otra transacción se reintenta; si persiste, AgendaOcupada (409).
// `leer` devuelve { fecha, sucursal_id, ... } o null (no existe: { noExiste: true }).
async function conCitaEnAgenda(db, { leer, destinos = () => [], fn, intentos = INTENTOS }) {
  for (let intento = 1; intento <= intentos; intento++) {
    const vista = await leer(db, false);
    if (!vista) return { noExiste: true };
    const bloqueadas = [{ fecha: vista.fecha, sucursalId: vista.sucursal_id }, ...destinos(vista)];
    const conn = await db.conexion();
    try {
      await conn.beginTransaction();
      await bloquearUbicaciones(conn, bloqueadas);
      const cita = await leer(conn, true);
      if (!cita) { await conn.rollback(); return { noExiste: true }; }
      const necesarias = [{ fecha: cita.fecha, sucursalId: cita.sucursal_id }, ...destinos(cita)];
      if (claveUbicaciones(necesarias) !== claveUbicaciones(bloqueadas)) {
        // Otra petición la movió entre la lectura y el candado: otra vuelta.
        await conn.rollback();
        continue;
      }
      const r = await fn(conn, cita);
      if (r && r.error) await conn.rollback();
      else await conn.commit();
      return r || {};
    } catch (e) {
      await conn.rollback().catch(() => {});
      if (!esInterbloqueo(e)) throw e;
    } finally {
      conn.release();
    }
  }
  throw new AgendaOcupada();
}

module.exports = { bloquearAgenda, bloquearFranja, bloquearUbicaciones, conCitaEnAgenda, AgendaOcupada, esInterbloqueo };
