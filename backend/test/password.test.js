const { test } = require('node:test');
const assert = require('node:assert');
const { generarPassword } = require('../src/utils/password');

test('tiene el largo pedido', () => {
  assert.equal(generarPassword().length, 20);
  assert.equal(generarPassword(32).length, 32);
});

test('siempre lleva mayúscula, minúscula, dígito y signo', () => {
  // Se prueba muchas veces porque el fallo sería intermitente: una implementación que
  // arma la contraseña al azar puro pasaría casi siempre y fallaría una de cada tantas.
  for (let i = 0; i < 200; i++) {
    const p = generarPassword();
    assert.match(p, /[A-Z]/, p);
    assert.match(p, /[a-z]/, p);
    assert.match(p, /[0-9]/, p);
    assert.match(p, /[!@%&*_\-+=?]/, p);
  }
});

test('no usa caracteres que se confunden al dictarla por teléfono', () => {
  for (let i = 0; i < 200; i++) {
    assert.doesNotMatch(generarPassword(), /[O0lI1]/);
  }
});

test('no repite la misma contraseña', () => {
  const vistas = new Set();
  for (let i = 0; i < 100; i++) vistas.add(generarPassword());
  assert.equal(vistas.size, 100);
});

test('las clases no quedan siempre en las primeras posiciones', () => {
  // Sin mezclar, los cuatro primeros caracteres serían siempre mayúscula, minúscula,
  // dígito y signo en ese orden — un regalo para quien intente adivinarla.
  const primeras = new Set(Array.from({ length: 100 }, () => generarPassword()[0]));
  assert.ok(primeras.size > 10, 'el primer carácter no varía lo suficiente');
});
