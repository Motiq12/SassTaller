const { test } = require('node:test');
const assert = require('node:assert');
const { TRANSICIONES_ORDEN, TRANSICIONES_CITA, transicionPermitida } = require('../src/utils/transiciones');

test('orden: avances válidos permitidos', () => {
  assert.equal(transicionPermitida(TRANSICIONES_ORDEN, 'recepcion', 'diagnostico'), true);
  assert.equal(transicionPermitida(TRANSICIONES_ORDEN, 'en_reparacion', 'lista_entrega'), true);
});

// Servicio rápido: de recepción directo a reparación, sin diagnóstico ni presupuesto.
test('orden: recepcion→en_reparacion (servicio rápido) permitido', () => {
  assert.equal(transicionPermitida(TRANSICIONES_ORDEN, 'recepcion', 'en_reparacion'), true);
});

// La entrega va por «Entregar» (POST /recepcion/ordenes/:id/entregar), no por cambio de estado.
test('orden: lista_entrega→entregada está bloqueado', () => {
  assert.equal(transicionPermitida(TRANSICIONES_ORDEN, 'lista_entrega', 'entregada'), false);
});

test('orden: saltos y retrocesos ilógicos bloqueados', () => {
  assert.equal(transicionPermitida(TRANSICIONES_ORDEN, 'recepcion', 'lista_entrega'), false);
  assert.equal(transicionPermitida(TRANSICIONES_ORDEN, 'entregada', 'diagnostico'), false);
});

test('cita: avance válido permitido; salto bloqueado', () => {
  assert.equal(transicionPermitida(TRANSICIONES_CITA, 'agendado', 'en_revision'), true);
  assert.equal(transicionPermitida(TRANSICIONES_CITA, 'listo', 'entregado'), true);
  assert.equal(transicionPermitida(TRANSICIONES_CITA, 'agendado', 'listo'), false);
});

test('no-op (mismo estado) siempre permitido', () => {
  assert.equal(transicionPermitida(TRANSICIONES_ORDEN, 'diagnostico', 'diagnostico'), true);
  assert.equal(transicionPermitida(TRANSICIONES_CITA, 'entregado', 'entregado'), true);
});

test('cancelar: permitido desde estados activos, no desde terminales', () => {
  assert.equal(transicionPermitida(TRANSICIONES_ORDEN, 'diagnostico', 'cancelada'), true);
  assert.equal(transicionPermitida(TRANSICIONES_ORDEN, 'entregada', 'cancelada'), false);
  assert.equal(transicionPermitida(TRANSICIONES_CITA, 'en_revision', 'cancelado'), true);
  assert.equal(transicionPermitida(TRANSICIONES_CITA, 'entregado', 'cancelado'), false);
});
