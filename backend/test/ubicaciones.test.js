const { test } = require('node:test');
const assert = require('node:assert');
const { UBICACIONES, leerUbicacion } = require('../src/utils/ubicaciones');

test('Costa Rica: 7 provincias y 84 cantones', () => {
  assert.equal(Object.keys(UBICACIONES).length, 7);
  assert.equal(Object.values(UBICACIONES).flat().length, 84);
});

test('la ubicación tiene que ser de la lista y del mismo lugar', () => {
  assert.deepEqual(leerUbicacion('Guanacaste', 'Liberia'), { provincia: 'Guanacaste', canton: 'Liberia' });
  assert.deepEqual(leerUbicacion('', ''), { provincia: null, canton: null });
  assert.ok(leerUbicacion('Guanacaste', 'Escazú').error, 'un cantón de otra provincia');
  assert.ok(leerUbicacion('Guanacaste', '').error, 'provincia sin cantón');
  assert.ok(leerUbicacion('constructor', 'x').error, 'no se cuela una propiedad del objeto');
});
