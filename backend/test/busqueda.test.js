const { test } = require('node:test');
const assert = require('node:assert');
const { patronLike, patronDigitos, patronPlaca, MAX_BUSQUEDA } = require('../src/utils/busqueda');

test('patronLike: recorta y envuelve en %', () => {
  assert.equal(patronLike('  Pedro '), '%Pedro%');
  assert.equal(patronLike(''), null);
  assert.equal(patronLike('   '), null);
  assert.equal(patronLike(undefined), null);
});

test('patronLike: % _ y \ se buscan tal cual, no como comodines', () => {
  assert.equal(patronLike('50%'), '%50\\%%');
  assert.equal(patronLike('a_b'), '%a\\_b%');
  assert.equal(patronLike('c:\\x'), '%c:\\\\x%');
});

test('patronLike: tope de largo', () => {
  assert.equal(patronLike('x'.repeat(500)).length, MAX_BUSQUEDA + 2);
});

test('patronDigitos: teléfonos sin guiones ni espacios', () => {
  assert.equal(patronDigitos('8711 2233'), '%87112233%');
  assert.equal(patronDigitos('+506 8711-2233'), '%50687112233%');
  assert.equal(patronDigitos('Pedro'), null);
  assert.equal(patronDigitos('12'), null);
});

test('patronPlaca: como placa_norm', () => {
  assert.equal(patronPlaca('prb 123'), '%PRB123%');
  assert.equal(patronPlaca('prb-123'), '%PRB123%');
  assert.equal(patronPlaca('a'), null);
  assert.equal(patronPlaca('a%_'), null);
});
