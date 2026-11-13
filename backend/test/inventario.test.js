// Validación del catálogo de repuestos (utils/inventario.js).
const test = require('node:test');
const assert = require('node:assert');
const { datosDeRepuesto, cantidadValida, repuestoDelCatalogo } = require('../src/utils/inventario');

test('un repuesto válido se limpia y redondea', () => {
  const { datos } = datosDeRepuesto({ nombre: '  Filtro de aceite ', codigo: ' FA-1 ', costo: '1500.555', precio: 2500, minimo: '3' });
  assert.deepStrictEqual(datos, { codigo: 'FA-1', nombre: 'Filtro de aceite', marca: null, unidad: 'unidad', costo: 1500.56, precio: 2500, minimo: 3 });
});

test('lo que no sirve se rechaza con su campo', () => {
  const casos = [
    [{ nombre: '' }, 'nombre'], [{ nombre: 'x'.repeat(201) }, 'nombre'], [{ nombre: 'a', codigo: 'c'.repeat(61) }, 'codigo'],
    [{ nombre: 'a', costo: -1 }, 'costo'], [{ nombre: 'a', precio: 'abc' }, 'precio'], [{ nombre: 'a', minimo: 1.5 }, 'minimo'],
    [{ nombre: 'a', minimo: -2 }, 'minimo'], [{ nombre: 'a', precio: 1e12 }, 'precio'],
  ];
  for (const [b, campo] of casos) assert.strictEqual(datosDeRepuesto(b).campo, campo, JSON.stringify(b).slice(0, 60));
});

test('cantidades enteras, positivas o cero según el caso', () => {
  assert.strictEqual(cantidadValida(3), true);
  assert.strictEqual(cantidadValida('4'), true);
  for (const v of [0, -1, 1.5, 'x', null, 200000]) assert.strictEqual(cantidadValida(v), false, String(v));
  assert.strictEqual(cantidadValida(0, { permitirCero: true }), true);
});

test('repuestoDelCatalogo: vacío no se revisa, ajeno o inválido da false', async () => {
  const db = { query: async (sql, [id]) => [[id === 7 ? { id: 7, nombre: 'Bujía', precio: '900.00' } : undefined]] };
  assert.strictEqual(await repuestoDelCatalogo(db, null), null);
  assert.strictEqual(await repuestoDelCatalogo(db, ''), null);
  assert.strictEqual((await repuestoDelCatalogo(db, 7)).id, 7);
  assert.strictEqual(await repuestoDelCatalogo(db, 99), false);
  assert.strictEqual(await repuestoDelCatalogo(db, '1 OR 1=1'), false);
});
