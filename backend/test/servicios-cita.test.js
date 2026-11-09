const { test } = require('node:test');
const assert = require('node:assert');
const {
  MAX_SERVICIOS_CITA, serviciosDelPedido, pedidoTraeServicios, problemaConServicios, textoServicios,
} = require('../src/utils/servicios-cita');

// Varios servicios por cita: la pantalla manda `servicios`; la app instalada que no se
// actualizó todavía manda `tipo_servicio` suelto.
test('lee la lista de servicios, sin repetidos ni vacíos y en el orden elegido', () => {
  assert.deepEqual(serviciosDelPedido({ servicios: [' Cambio de aceite ', 'Frenos', 'Cambio de aceite', ''] }), ['Cambio de aceite', 'Frenos']);
  assert.deepEqual(serviciosDelPedido({ tipo_servicio: 'Frenos' }), ['Frenos']);
  assert.deepEqual(serviciosDelPedido({}), []);
});

test('al editar, sin servicios en el pedido se conservan los que tenía', () => {
  assert.equal(pedidoTraeServicios({ motivo: 'x' }), false);
  assert.equal(pedidoTraeServicios({ servicios: [] }), true);
  assert.equal(pedidoTraeServicios({ tipo_servicio: null }), true);
});

test('el portal exige al menos uno; nadie pasa del máximo', async () => {
  assert.equal(await problemaConServicios({}, [], { obligatorio: true }), 'Elige al menos un servicio');
  assert.equal(await problemaConServicios({}, []), null);
  const demasiados = Array.from({ length: MAX_SERVICIOS_CITA + 1 }, (_, i) => `Servicio ${i}`);
  assert.match(await problemaConServicios({}, demasiados), /hasta/);
});

test('el texto para mostrar une los servicios con +', () => {
  assert.equal(textoServicios(['Cambio de aceite', 'Frenos']), 'Cambio de aceite + Frenos');
  assert.equal(textoServicios([]), null);
});
