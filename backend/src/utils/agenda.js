// Lugares de la agenda: cuántas citas hay en cada hora y qué horas están bloqueadas.
//
// El taller atiende hasta `max_citas_hora` citas por hora en cada sede, y cada hora
// se cuenta en MINUTOS: tiene max_citas_hora × 60 minutos de trabajo. Una cita normal
// usa 60 minutos en CADA hora que dura (duracion_horas, que solo cambia
// administración): una de "todo el día" que entra a las 8:00 ocupa un lugar de las
// 8:00 al cierre, no solo el de las 8:00. Un servicio rápido (duracion_min: 20, 30 o
// 40) usa solo esos minutos, en la hora en que empieza: así no se gasta una hora
// entera en un cambio de aceite, y lo que sobra de la hora queda para otro cliente. Y administración puede bloquear horas o
// días enteros (bloqueos_horario), y marcar feriados que se repiten todos los años
// (feriados): en esas horas no se ofrece nada para agendar.
//
// Todo lo que muestra horas libres o acepta una cita pasa por aquí (portal,
// recepción, administración), para que no haya dos maneras de contar.
const { fechaLocalISO, horaLocal } = require('./fecha');
const { horasDisponibles } = require('./configuracion');
const { caeEn } = require('./feriados');

// Duraciones que se pueden elegir. TODO_EL_DIA cubre hasta el cierre, sea a la hora
// que sea que empiece la cita.
const TODO_EL_DIA = 24;
const DURACIONES = [1, 2, 3, 4, 6, TODO_EL_DIA];

function duracionValida(d) {
  return DURACIONES.includes(Number(d));
}

// Minutos de un servicio rápido. Una cita con duracion_min ocupa solo esos minutos;
// sin duracion_min es una cita normal (horas enteras).
const MINUTOS_RAPIDOS = [20, 30, 40];

function minutosRapidosValidos(m) {
  return MINUTOS_RAPIDOS.includes(Number(m));
}

// Los minutos que usa una cita en cada hora que ocupa: los del servicio rápido, o 60.
function minutosPorHora(minutos) {
  return minutosRapidosValidos(minutos) ? Number(minutos) : 60;
}

// Las horas del día ('HH:00') que ocupa una cita que empieza a `hora` y dura
// `duracion` horas. Una cita a las 10:37 (cliente sin cita) cuenta en la de las
// 10:00. Lo que caiga después del cierre no ocupa nada. Un servicio rápido
// (`minutos`) cuenta solo en la hora en que empieza.
function horasDeCita(hora, duracion, horasDia, minutos = null) {
  const inicio = `${String(hora).slice(0, 2)}:00`;
  const cuantas = minutosRapidosValidos(minutos) ? 1 : Math.max(1, Number(duracion) || 1);
  return horasDia.filter((h) => h >= inicio).slice(0, cuantas);
}

// Las horas que tapa un bloqueo dentro de un día. Sin horas = el día entero.
// "De 13:00 a 17:00" bloquea las de 13, 14, 15 y 16 (la de las 17:00 queda libre).
function horasDeBloqueo(b, horasDia) {
  if (!b.hora_desde) return horasDia;
  const desde = `${String(b.hora_desde).slice(0, 2)}:00`;
  const hasta = String(b.hora_hasta).slice(0, 5);
  return horasDia.filter((h) => h >= desde && h < hasta);
}

// Fechas 'YYYY-MM-DD' de `desde` a `hasta` (inclusive).
function fechasEntre(desde, hasta) {
  const out = [];
  const d = new Date(`${desde}T12:00:00Z`);
  const fin = new Date(`${hasta}T12:00:00Z`);
  while (d <= fin) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

// La agenda de un rango de días en una sede: por cada fecha, las horas de atención,
// cuántas citas hay en cada una y cuáles están bloqueadas (con el motivo).
//
// opts.db: una conexión en transacción (si no, el pool). opts.bloquear: FOR UPDATE
// sobre las citas del rango, para que dos reservas al mismo tiempo se pongan en fila
// y no se pase el cupo. opts.excluirId: no contar esa cita (al moverla o alargarla).
// Sin sucursalId cuenta todas las sedes (recepción sin sede elegida).
async function agendaRango(desde, hasta, sucursalId, config, opts = {}) {
  // Sin db del taller no se agenda: el pool global contaría citas de todas las empresas.
  const db = opts.db;
  if (!db) throw new Error('agendaRango: falta el db del taller (opts.db)');
  let sql = `SELECT id, to_char(fecha, 'YYYY-MM-DD') AS fecha, to_char(hora, 'HH24:MI') AS hora, duracion_horas, duracion_min
             FROM citas WHERE tenant_id = @tenant AND fecha BETWEEN ? AND ? AND estado <> 'cancelado'`;
  const params = [desde, hasta];
  if (sucursalId) { sql += ' AND sucursal_id = ?'; params.push(sucursalId); }
  if (opts.excluirId) { sql += ' AND id <> ?'; params.push(opts.excluirId); }
  if (opts.bloquear) sql += ' FOR UPDATE';
  const [citas] = await db.query(sql, params);

  let sqlB = `SELECT id, to_char(fecha_desde, 'YYYY-MM-DD') AS fecha_desde, to_char(fecha_hasta, 'YYYY-MM-DD') AS fecha_hasta,
                     to_char(hora_desde, 'HH24:MI') AS hora_desde, to_char(hora_hasta, 'HH24:MI') AS hora_hasta, motivo
              FROM bloqueos_horario WHERE tenant_id = @tenant AND fecha_desde <= ? AND fecha_hasta >= ?`;
  const paramsB = [hasta, desde];
  if (sucursalId) { sqlB += ' AND (sucursal_id IS NULL OR sucursal_id = ?)'; paramsB.push(sucursalId); }
  const [bloqueos] = await db.query(sqlB, paramsB);

  // Feriados que se repiten (utils/feriados.js): el día entero, todos los años.
  let sqlF = 'SELECT mes, dia, nombre FROM feriados WHERE tenant_id = @tenant';
  const paramsF = [];
  if (sucursalId) { sqlF += ' AND (sucursal_id IS NULL OR sucursal_id = ?)'; paramsF.push(sucursalId); }
  // Si la tabla faltara (migración omitida), se agenda como antes en vez de fallar.
  const feriados = await db.query(sqlF, paramsF).then(([f]) => f, (err) => {
    console.error('⚠️  No se pudieron leer los feriados:', err.code || err.message);
    return [];
  });

  const agenda = {};
  for (const fecha of fechasEntre(desde, hasta)) {
    agenda[fecha] = { horas: horasDisponibles(fecha, config), ocupacion: {}, minutos: {}, bloqueadas: {} };
  }
  for (const c of citas) {
    const dia = agenda[c.fecha];
    if (!dia) continue;
    const usa = minutosPorHora(c.duracion_min);
    for (const h of horasDeCita(c.hora, c.duracion_horas, dia.horas, c.duracion_min)) dia.minutos[h] = (dia.minutos[h] || 0) + usa;
  }
  // `ocupacion`: lugares de 1 hora que ya no caben. Con max lugares, los que quedan
  // son floor((max·60 − minutos)/60) = max − ceil(minutos/60). Las pantallas que
  // cuentan "N disponibles" siguen funcionando igual; para un servicio rápido se
  // mira `minutos`.
  for (const dia of Object.values(agenda)) {
    for (const [h, m] of Object.entries(dia.minutos)) dia.ocupacion[h] = Math.ceil(m / 60);
  }
  for (const b of bloqueos) {
    for (const fecha of fechasEntre(b.fecha_desde > desde ? b.fecha_desde : desde, b.fecha_hasta < hasta ? b.fecha_hasta : hasta)) {
      const dia = agenda[fecha];
      for (const h of horasDeBloqueo(b, dia.horas)) dia.bloqueadas[h] = b.motivo;
    }
  }
  for (const [fecha, dia] of Object.entries(agenda)) {
    const f = feriados.find((x) => caeEn(fecha, x));
    if (f) for (const h of dia.horas) dia.bloqueadas[h] = `Feriado: ${f.nombre}`;
  }
  return agenda;
}

// La agenda de un solo día (ver agendaRango).
async function agendaDia(fecha, sucursalId, config, opts = {}) {
  return (await agendaRango(fecha, fecha, sucursalId, config, opts))[fecha];
}

// Problemas de poner una cita de `duracion` horas (o un servicio rápido de `minutos`)
// a `hora` ese día: horas llenas y horas bloqueadas. Lista vacía = cabe. `dia` sale
// de agendaDia, sin contar la cita que se está moviendo o alargando. Una hora está
// llena para la cita si sus minutos no entran en lo que le queda (max × 60).
function conflictosDeCita(dia, hora, duracion, max, minutos = null) {
  const conflictos = [];
  const usa = minutosPorHora(minutos);
  // Un día armado sin `minutos` (solo con ocupacion) cuenta 60 por lugar ocupado.
  const usados = (h) => (dia.minutos && dia.minutos[h] !== undefined ? dia.minutos[h] : (dia.ocupacion[h] || 0) * 60);
  for (const h of horasDeCita(hora, duracion, dia.horas, minutos)) {
    if (dia.bloqueadas[h] !== undefined) conflictos.push({ hora: h, tipo: 'bloqueada', motivo: dia.bloqueadas[h] });
    else if (usados(h) + usa > max * 60) conflictos.push({ hora: h, tipo: 'llena' });
  }
  return conflictos;
}

// "10:00 (llena), 13:00 (bloqueada: Capacitación)" para los avisos.
function textoConflictos(conflictos) {
  return conflictos
    .map((c) => (c.tipo === 'llena' ? `${c.hora} (llena)` : `${c.hora} (bloqueada${c.motivo ? ': ' + c.motivo : ''})`))
    .join(', ');
}

// Las horas de ese día que ya empezaron, en la hora del taller: no se ofrecen ni se
// aceptan. Un día pasado, todas; uno futuro, ninguna. La de las 13:00 ya empezó a las
// 13:00 (igual que el portal, que pide que la cita empiece en el futuro).
function horasPasadas(fecha, horasDia, offset = -6, ahora = Date.now()) {
  const hoy = fechaLocalISO(offset, 0, ahora);
  if (fecha < hoy) return [...horasDia];
  if (fecha > hoy) return [];
  const ya = horaLocal(offset, ahora);
  return horasDia.filter((h) => h <= ya);
}

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const HORA = /^\d{2}:\d{2}$/;

// Por qué el personal no puede poner una cita ahí, o null si se puede. La usan crear y
// mover una cita (routes/citas.routes.js); el portal tiene sus propias reglas, más
// estrictas (anticipación, sede obligatoria).
//   · Nadie agenda en una fecha u hora que ya pasó.
//   · Con `puedeForzar` (administración) no se mira más: ella decide si el taller da
//     abasto o si se salta un bloqueo que puso ella misma.
//   · Si no: la hora tiene que estar dentro del horario, sin bloquear y con lugar.
// Devuelve { campo, error, status? }.
async function problemaDeHorario({ db, fecha, hora, sucursalId = null, config, puedeForzar = false, excluirId = null, minutos = null, ahora = Date.now() }) {
  const f = String(fecha || '').slice(0, 10);
  const h = String(hora || '').slice(0, 5);
  if (!FECHA.test(f)) return { campo: 'fecha', error: 'Elegí la fecha' };
  if (!HORA.test(h)) return { campo: 'hora', error: 'Elegí la hora' };
  const offset = config.zona_horaria_offset;
  const hoy = fechaLocalISO(offset, 0, ahora);
  if (f < hoy) return { campo: 'fecha', error: 'Esa fecha ya pasó' };
  if (f === hoy && h <= horaLocal(offset, ahora)) return { campo: 'hora', error: 'Esa hora ya pasó. Elegí una más tarde.' };
  if (puedeForzar) return null;

  const dia = await agendaDia(f, sucursalId, config, { db, excluirId });
  if (!dia.horas.length) return { campo: 'fecha', error: 'Ese día el taller está cerrado' };
  if (!dia.horas.includes(`${h.slice(0, 2)}:00`)) return { campo: 'hora', error: 'Esa hora está fuera del horario del taller' };
  const [c] = conflictosDeCita(dia, h, 1, Number(config.max_citas_hora) || 1, minutos);
  if (c && c.tipo === 'bloqueada') {
    return { campo: 'hora', status: 409, error: `Ese horario está bloqueado${c.motivo ? ` (${c.motivo})` : ''}. Elegí otra hora.` };
  }
  if (c) return { campo: 'hora', status: 409, error: 'Esa hora ya está llena. Elegí otra.' };
  return null;
}

module.exports = {
  TODO_EL_DIA, DURACIONES, duracionValida, MINUTOS_RAPIDOS, minutosRapidosValidos, minutosPorHora,
  horasDeCita, horasDeBloqueo, fechasEntre,
  agendaRango, agendaDia, conflictosDeCita, textoConflictos, horasPasadas, problemaDeHorario,
};
