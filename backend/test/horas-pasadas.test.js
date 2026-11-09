const { test } = require('node:test');
const assert = require('node:assert');

// No se ofrece ni se acepta una cita en una hora que ya pasó (24-oct-2026: recepción
// ofrecía las 8:00 a la 1:41 p. m.). Y recepción no puede salirse del horario, ni
// agendar en horas llenas o bloqueadas. Con un reloj fijo: sábado 24-oct-2026, 13:41 en CR.
const { horasPasadas, problemaDeHorario } = require('../src/utils/agenda');

const AHORA = Date.parse('2026-10-24T19:41:00Z'); // 13:41 en Costa Rica (UTC-6)
const HORAS = ['08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00'];

test('horasPasadas: hoy, las que ya empezaron; un día pasado, todas; uno futuro, ninguna', () => {
  assert.deepStrictEqual(horasPasadas('2026-10-24', HORAS, -6, AHORA), ['08:00', '09:00', '10:00', '11:00', '12:00', '13:00']);
  assert.deepStrictEqual(horasPasadas('2026-10-23', HORAS, -6, AHORA), HORAS);
  assert.deepStrictEqual(horasPasadas('2026-10-26', HORAS, -6, AHORA), []);
  // A las 13:00 en punto, la de las 13:00 ya empezó.
  assert.ok(horasPasadas('2026-10-24', HORAS, -6, Date.parse('2026-10-24T19:00:00Z')).includes('13:00'));
  // Pasada la medianoche en UTC sigue siendo el mismo día en Costa Rica.
  assert.deepStrictEqual(horasPasadas('2026-10-24', HORAS, -6, Date.parse('2026-10-25T03:00:00Z')), HORAS);
});

// Base falsa para agendaDia: citas (para el cupo) y bloqueos.
function baseCon({ citas = [], bloqueos = [] } = {}) {
  return {
    async query(sql) {
      if (/FROM citas/.test(sql)) return [citas];
      if (/FROM bloqueos_horario/.test(sql)) return [bloqueos];
      return [[]];
    },
  };
}
// Lunes a sábado de 8 a 17; domingo cerrado. Dos citas por hora.
const config = {
  zona_horaria_offset: -6, max_citas_hora: 2,
  horarios: [0, 1, 2, 3, 4, 5, 6].map((dia) => ({ dia, abre: '08:00', cierra: '17:00', activo: dia === 0 ? 0 : 1 })),
};
// problemaDeHorario usa el pool de verdad; acá se reemplaza por la base falsa.
const pool = require('../src/db/pool').pool;
async function probar(datos, base = baseCon()) {
  const original = pool.query;
  pool.query = base.query;
  try {
    return await problemaDeHorario({ db: base, config, ahora: AHORA, ...datos });
  } finally {
    pool.query = original;
  }
}

test('nadie agenda en el pasado, ni administración', async () => {
  for (const puedeForzar of [false, true]) {
    assert.match((await probar({ fecha: '2026-10-24', hora: '08:00', puedeForzar })).error, /ya pasó/);
    assert.match((await probar({ fecha: '2026-10-24', hora: '13:00', puedeForzar })).error, /ya pasó/);
    assert.match((await probar({ fecha: '2026-10-20', hora: '10:00', puedeForzar })).error, /fecha ya pasó/);
  }
  assert.strictEqual(await probar({ fecha: '2026-10-24', hora: '14:00' }), null, 'más tarde hoy sí');
  assert.strictEqual(await probar({ fecha: '2026-10-24', hora: '13:50', puedeForzar: true }), null, 'una hora suelta futura, sí');
});

test('recepción: dentro del horario, sin bloqueo y con lugar', async () => {
  assert.match((await probar({ fecha: '2026-10-25', hora: '10:00' })).error, /cerrado/, 'domingo');
  assert.match((await probar({ fecha: '2026-10-26', hora: '18:00' })).error, /fuera del horario/);
  const bloqueado = baseCon({ bloqueos: [{ fecha_desde: '2026-10-26', fecha_hasta: '2026-10-26', hora_desde: '13:00', hora_hasta: '17:00', motivo: 'Capacitación' }] });
  const b = await probar({ fecha: '2026-10-26', hora: '14:00' }, bloqueado);
  assert.strictEqual(b.status, 409);
  assert.match(b.error, /bloqueado \(Capacitación\)/);
  const lleno = baseCon({ citas: [1, 2].map((id) => ({ id, fecha: '2026-10-26', hora: '10:00', duracion_horas: 1 })) });
  assert.match((await probar({ fecha: '2026-10-26', hora: '10:00' }, lleno)).error, /llena/);
  assert.strictEqual(await probar({ fecha: '2026-10-26', hora: '11:00' }, lleno), null);
});

test('administración se salta horario, bloqueo y cupo (pero no el pasado)', async () => {
  const lleno = baseCon({ citas: [1, 2].map((id) => ({ id, fecha: '2026-10-26', hora: '10:00', duracion_horas: 1 })) });
  assert.strictEqual(await probar({ fecha: '2026-10-26', hora: '10:00', puedeForzar: true }, lleno), null);
  assert.strictEqual(await probar({ fecha: '2026-10-25', hora: '10:00', puedeForzar: true }), null);
});

test('fecha u hora mal escritas', async () => {
  assert.strictEqual((await probar({ fecha: 'mañana', hora: '10:00' })).campo, 'fecha');
  assert.strictEqual((await probar({ fecha: '2026-10-26', hora: '10' })).campo, 'hora');
});
