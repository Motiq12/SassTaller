const { test } = require('node:test');
const assert = require('node:assert');

// Mensajes al cliente que reescribe el taller (utils/plantillas.js).
const { rellenar, normalizarPlantillas, correoDeHito } = require('../src/utils/plantillas');

test('rellenar pone los datos y saca los trozos entre corchetes sin dato', () => {
  const t = 'Hola {nombre}, el presupuesto de tu {moto}[ (orden {orden})] está listo[ por {total}].';
  assert.strictEqual(rellenar(t, { nombre: 'Ana', moto: 'Freedom 150', orden: 'OT-1', total: '₡10 000' }),
    'Hola Ana, el presupuesto de tu Freedom 150 (orden OT-1) está listo por ₡10 000.');
  assert.strictEqual(rellenar(t, { nombre: 'Ana', moto: 'Freedom 150' }), 'Hola Ana, el presupuesto de tu Freedom 150 está listo.');
});

test('rellenar: un dato que no existe queda vacío, sin dejar llaves ni dobles espacios', () => {
  assert.strictEqual(rellenar('Hola {nombre}  {inventado} ¿todo bien?', { nombre: 'Luis' }), 'Hola Luis ¿todo bien?');
  assert.strictEqual(rellenar('Línea uno\nLínea dos {nombre}', { nombre: 'Luis' }), 'Línea uno\nLínea dos Luis');
});

test('normalizarPlantillas descarta lo que no sirve', () => {
  const n = normalizarPlantillas({
    whatsapp: { orden_lista: '  Ya está  ', 'Mala Clave': 'x', vacia: '   ', larga: 'x'.repeat(900) },
    correo: { listo: { titulo: 'Lista', mensaje: '' }, otro: { titulo: 'x' } },
  });
  assert.deepStrictEqual(Object.keys(n.whatsapp).sort(), ['larga', 'orden_lista']);
  assert.strictEqual(n.whatsapp.orden_lista, 'Ya está');
  assert.strictEqual(n.whatsapp.larga.length, 700);
  assert.deepStrictEqual(n.correo, { listo: { titulo: 'Lista' } });
  assert.deepStrictEqual(normalizarPlantillas('no es json'), { whatsapp: {}, correo: {} });
  assert.deepStrictEqual(normalizarPlantillas(null), { whatsapp: {}, correo: {} });
});

test('correoDeHito: lo del taller encima de lo de fábrica, campo por campo', () => {
  const propias = { correo: { listo: { mensaje: '{nombre}, tu {moto} te espera.' } } };
  assert.deepStrictEqual(correoDeHito('listo', propias, { nombre: 'Ana', moto: 'KYMCO Agility' }),
    { titulo: 'Tu moto está lista', mensaje: 'Ana, tu KYMCO Agility te espera.' });
  assert.deepStrictEqual(correoDeHito('entregado', {}, { moto: 'tu moto' }),
    { titulo: 'Servicio entregado', mensaje: 'tu moto fue entregada. ¡Gracias por tu visita!' });
  assert.strictEqual(correoDeHito('en_revision', {}, {}), null);
});
