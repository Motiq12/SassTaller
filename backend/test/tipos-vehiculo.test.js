const { test } = require('node:test');
const assert = require('node:assert');
const { TIPOS, normalizarTipos, limpiarAtributos, etiquetaPara, mensaje } = require('../src/utils/tipos-vehiculo');

test('una empresa puede atender camiones, buses, busetas y otros', () => {
  assert.deepStrictEqual(normalizarTipos(['camion', 'bus', 'buseta', 'otro']), ['camion', 'bus', 'buseta', 'otro']);
  for (const clave of ['camion', 'bus', 'buseta', 'otro']) assert.ok(TIPOS[clave].etiqueta, clave);
});

test('cada tipo guarda solo sus datos propios y dentro del rango', () => {
  assert.deepStrictEqual(limpiarAtributos('camion', { ejes: 3, combustible: 'Diésel', pasajeros: 40 }), { combustible: 'Diésel', ejes: 3 });
  assert.deepStrictEqual(limpiarAtributos('bus', { pasajeros: 45 }), { pasajeros: 45 });
  assert.strictEqual(limpiarAtributos('buseta', { pasajeros: 90 }), null, 'una buseta no lleva 90 pasajeros');
  assert.deepStrictEqual(limpiarAtributos('otro', { descripcion: 'Cuadraciclo' }), { descripcion: 'Cuadraciclo' });
});

test('los textos concuerdan con el tipo', () => {
  assert.strictEqual(mensaje(['buseta'], 'registrad'), 'Buseta registrada');
  assert.strictEqual(mensaje(['camion'], 'registrad'), 'Camión registrado');
  assert.strictEqual(etiquetaPara(['bus', 'camion']).singular, 'Vehículo');
});
