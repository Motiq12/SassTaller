const { test } = require('node:test');
const assert = require('node:assert');

// Contraseñas del personal: la política de Configuración → Seguridad.
const { politica, problemaDeContrasena } = require('../src/utils/contrasena');

test('politica: 8 de fábrica, nunca menos de 8 ni más de 32', () => {
  assert.deepStrictEqual(politica({}), { minimo: 8, variedad: false });
  assert.deepStrictEqual(politica({ pass_min_largo: 4 }), { minimo: 8, variedad: false });
  assert.deepStrictEqual(politica({ pass_min_largo: 12, pass_variedad: 1 }), { minimo: 12, variedad: true });
  assert.strictEqual(politica({ pass_min_largo: 99 }).minimo, 32);
  assert.strictEqual(politica({ pass_min_largo: 'x' }).minimo, 8);
});

test('largo mínimo', () => {
  assert.match(problemaDeContrasena('Corta1', politica({})), /al menos 8/);
  assert.match(problemaDeContrasena('Bastante larga 1', politica({ pass_min_largo: 20 })), /al menos 20/);
  assert.strictEqual(problemaDeContrasena('caballo-bateria', politica({})), null);
});

test('letras y números, solo si la política lo pide', () => {
  const pide = politica({ pass_variedad: 1 });
  assert.match(problemaDeContrasena('soloLetrasAca', pide), /letras y números/);
  assert.match(problemaDeContrasena('99887766554', pide), /letras y números/);
  assert.strictEqual(problemaDeContrasena('ñandú2026taller', pide), null, 'acepta letras con tilde');
  assert.strictEqual(problemaDeContrasena('soloLetrasAca', politica({})), null);
});

test('rechaza las más usadas y las de un solo carácter repetido', () => {
  for (const p of ['12345678', 'Password', 'MSMotos123', 'aaaaaaaaaa']) {
    assert.match(problemaDeContrasena(p, politica({})), /más usadas/, p);
  }
});

test('no puede llevar el correo ni ser el nombre con números', () => {
  const quien = { email: 'karla.rojas@msmotos.com', nombre: 'Karla Rojas' };
  assert.match(problemaDeContrasena('mi-karla.rojas-2026', politica({}), quien), /correo/);
  assert.match(problemaDeContrasena('Karla2026', politica({}), quien), /nombre con números/);
  assert.strictEqual(problemaDeContrasena('Karla va al taller', politica({}), quien), null);
});
