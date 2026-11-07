const { test } = require('node:test');
const assert = require('node:assert');
const {
  TODO_EL_DIA, duracionValida, horasDeCita, horasDeBloqueo, fechasEntre, conflictosDeCita, textoConflictos,
} = require('../src/utils/agenda');

// Lunes a sábado de 8:00 a 17:00: la última hora que se ofrece es la de las 16:00.
const DIA = ['08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00'];

test('una cita de 1 hora ocupa solo su hora', () => {
  assert.deepEqual(horasDeCita('10:00', 1, DIA), ['10:00']);
});

test('una cita de 3 horas ocupa su hora y las dos siguientes', () => {
  assert.deepEqual(horasDeCita('10:00', 3, DIA), ['10:00', '11:00', '12:00']);
});

test('«todo el día» ocupa hasta el cierre, empiece a la hora que empiece', () => {
  assert.deepEqual(horasDeCita('08:00', TODO_EL_DIA, DIA), DIA);
  assert.deepEqual(horasDeCita('14:00', TODO_EL_DIA, DIA), ['14:00', '15:00', '16:00']);
});

test('una cita a media hora (cliente sin cita) cuenta en la hora en punto', () => {
  assert.deepEqual(horasDeCita('10:37', 1, DIA), ['10:00']);
});

test('lo que cae después del cierre no ocupa nada', () => {
  assert.deepEqual(horasDeCita('15:00', 4, DIA), ['15:00', '16:00']);
  assert.deepEqual(horasDeCita('18:00', 1, DIA), []);
});

test('un bloqueo sin horas tapa el día entero', () => {
  assert.deepEqual(horasDeBloqueo({ hora_desde: null }, DIA), DIA);
});

test('un bloqueo de 13:00 a 17:00 deja libre la hora final', () => {
  assert.deepEqual(horasDeBloqueo({ hora_desde: '13:00', hora_hasta: '17:00' }, DIA), ['13:00', '14:00', '15:00', '16:00']);
  assert.deepEqual(horasDeBloqueo({ hora_desde: '08:00', hora_hasta: '12:00' }, DIA), ['08:00', '09:00', '10:00', '11:00']);
});

test('solo se aceptan las duraciones del menú', () => {
  for (const d of [1, 2, 3, 4, 6, 24, '4']) assert.equal(duracionValida(d), true);
  for (const d of [0, 5, 25, -1, 'x', null]) assert.equal(duracionValida(d), false);
});

test('fechasEntre incluye las dos puntas y cruza de mes', () => {
  assert.deepEqual(fechasEntre('2026-10-30', '2026-11-02'), ['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']);
  assert.deepEqual(fechasEntre('2026-10-30', '2026-10-30'), ['2026-10-30']);
});

test('conflictos: horas llenas y bloqueadas dentro de lo que dura la cita', () => {
  const dia = { horas: DIA, ocupacion: { '09:00': 2, '10:00': 1 }, bloqueadas: { '11:00': 'Capacitación' } };
  assert.deepEqual(conflictosDeCita(dia, '08:00', 1, 2), []);
  assert.deepEqual(conflictosDeCita(dia, '08:00', 4, 2), [
    { hora: '09:00', tipo: 'llena' },
    { hora: '11:00', tipo: 'bloqueada', motivo: 'Capacitación' },
  ]);
  assert.equal(textoConflictos(conflictosDeCita(dia, '08:00', 4, 2)), '09:00 (llena), 11:00 (bloqueada: Capacitación)');
});
