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
// Orden de bloqueo (sin interbloqueos): por fecha ascendente y, en cada fecha, primero
// el nivel del día y después el de la sede. Todas las rutas pasan por acá, así que todas
// toman los candados en el mismo orden.
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

async function bloquearAgenda(conn, sucursalId, fechas) {
  if (!Number.isInteger(conn?.tenantId)) throw new Error('bloquearAgenda: falta la conexión del taller');
  const dias = [...new Set([].concat(fechas).map((f) => String(f || '').slice(0, 10)))].filter((f) => FECHA.test(f)).sort();
  const sede = Number(sucursalId) || null;
  for (const dia of dias) {
    if (sede) {
      await conn.query('SELECT pg_advisory_xact_lock_shared(?::int, hashtext(?))', [conn.tenantId, `agenda:${dia}`]);
      await conn.query('SELECT pg_advisory_xact_lock(?::int, hashtext(?))', [conn.tenantId, `agenda:${dia}:sede:${sede}`]);
    } else {
      await conn.query('SELECT pg_advisory_xact_lock(?::int, hashtext(?))', [conn.tenantId, `agenda:${dia}`]);
    }
  }
}

// Nombre anterior (una franja = fecha + hora). Bloquea el día entero de la sede.
async function bloquearFranja(conn, sucursalId, fecha, _hora) {
  await bloquearAgenda(conn, sucursalId, [fecha]);
}

module.exports = { bloquearAgenda, bloquearFranja };
