const { test } = require('node:test');
const assert = require('node:assert');
const {
  minutosRapidosValidos, minutosPorHora, horasDeCita, conflictosDeCita,
} = require('../src/utils/agenda');

// Servicios rápidos: una cita de 20, 30 o 40 minutos usa solo esos minutos de la hora
// en que empieza; cada hora tiene max_citas_hora × 60 minutos de trabajo.
const DIA = ['08:00', '09:00', '10:00', '11:00'];
const dia = (minutos, extra = {}) => ({ horas: DIA, ocupacion: {}, minutos, bloqueadas: {}, ...extra });

test('solo 20, 30 y 40 son minutos de servicio rápido', () => {
  assert.equal(minutosRapidosValidos(20), true);
  assert.equal(minutosRapidosValidos('40'), true);
  assert.equal(minutosRapidosValidos(45), false);
  assert.equal(minutosRapidosValidos(null), false);
  assert.equal(minutosPorHora(30), 30);
  assert.equal(minutosPorHora(null), 60);
});

test('un servicio rápido ocupa solo la hora en que empieza', () => {
  assert.deepEqual(horasDeCita('09:00', 3, DIA, 40), ['09:00']);
  assert.deepEqual(horasDeCita('09:50', 1, DIA, 20), ['09:00']);
});

test('con una cita normal en la hora y cupo 2, todavía entra otra normal o tres rápidas', () => {
  const d = dia({ '09:00': 60 });
  assert.deepEqual(conflictosDeCita(d, '09:00', 1, 2), []);
  assert.deepEqual(conflictosDeCita(d, '09:00', 1, 2, 20), []);
  const conTresRapidas = dia({ '09:00': 60 + 20 + 20 + 20 });
  assert.equal(conflictosDeCita(conTresRapidas, '09:00', 1, 2, 20).length, 1); // ya no cabe una cuarta
  assert.equal(conflictosDeCita(conTresRapidas, '09:00', 1, 2).length, 1);     // ni una normal
});

test('una cita normal no entra si a la hora le quedan menos de 60 minutos', () => {
  const d = dia({ '10:00': 70 }); // una normal + una rápida de 10 sobre cupo 2 → quedan 50
  assert.equal(conflictosDeCita(d, '10:00', 1, 2).length, 1);
  assert.deepEqual(conflictosDeCita(d, '10:00', 1, 2, 40), []); // una de 40 sí
});

test('una hora bloqueada no admite servicios rápidos', () => {
  const d = dia({}, { bloqueadas: { '08:00': 'Capacitación' } });
  assert.deepEqual(conflictosDeCita(d, '08:00', 1, 2, 20), [{ hora: '08:00', tipo: 'bloqueada', motivo: 'Capacitación' }]);
});
