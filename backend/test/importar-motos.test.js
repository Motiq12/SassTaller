const { test } = require('node:test');
const assert = require('node:assert');
const { revisarCsv, plantillaCsv, partirLinea, separadorDe, aNumero, aFecha } = require('../src/utils/importar-motos');

const TIPOS = [{ id: 'scooter', nombre: 'Scooter' }, { id: 'deportiva', nombre: 'Deportiva' }];
const SUC = [{ id: 1, nombre: 'Liberia' }, { id: 2, nombre: 'Cañas' }];
const ctx = { tipos: TIPOS, sucursales: SUC };

test('partirLinea: respeta las comillas y las comillas dobles de Excel', () => {
  assert.deepEqual(partirLinea('a;b;c', ';'), ['a', 'b', 'c']);
  assert.deepEqual(partirLinea('"Urbana 150; roja";1200', ';'), ['Urbana 150; roja', '1200']);
  assert.deepEqual(partirLinea('"Dijo ""hola""";x', ';'), ['Dijo "hola"', 'x']);
});

test('separadorDe: reconoce el punto y coma de Excel en español y la coma', () => {
  assert.equal(separadorDe('nombre;precio;foto'), ';');
  assert.equal(separadorDe('nombre,precio,foto'), ',');
});

test('aNumero: aguanta símbolos y separadores de miles', () => {
  assert.equal(aNumero('₡1.150.000'), 1150000);
  assert.equal(aNumero('1,150,000'), 1150000);
  assert.equal(aNumero('$4650'), 4650);
  assert.equal(aNumero(''), null);
  assert.equal(aNumero('abc'), null);
});

test('aFecha: acepta AAAA-MM-DD y DD/MM/AAAA; avisa si no se entiende', () => {
  assert.equal(aFecha('2026-10-06'), '2026-10-06');
  assert.equal(aFecha('6/10/2026'), '2026-10-06');
  assert.equal(aFecha(''), '');
  assert.equal(aFecha('el martes'), null);
});

test('revisarCsv: lee una fila buena, con la categoría por nombre y unidades por sede', () => {
  const csv = 'nombre;categoria;precio;Liberia;Cañas\nFreedom Urbana 150;Scooter;₡1.150.000;3;1';
  const r = revisarCsv(csv, ctx);
  assert.equal(r.filas.length, 1);
  assert.equal(r.filas[0].error, undefined);
  assert.equal(r.filas[0].datos.tipo, 'scooter');
  assert.equal(r.filas[0].datos.precio, 1150000);
  assert.deepEqual(r.filas[0].datos.stock, { 1: 3, 2: 1 });
});

test('revisarCsv: los títulos valen con tildes, mayúsculas o nombres alternativos', () => {
  const r = revisarCsv('MODELO;Tipo;PRECIO\nHero Hunk;deportiva;1490000', ctx);
  assert.equal(r.filas[0].error, undefined);
  assert.equal(r.filas[0].datos.tipo, 'deportiva');
});

test('revisarCsv: marca la fila mala sin tumbar las buenas', () => {
  const csv = 'nombre;categoria\nBuena;Scooter\n;Scooter\nOtra;Helicóptero\nBuena;Deportiva';
  const r = revisarCsv(csv, ctx);
  assert.equal(r.filas.length, 4);
  assert.equal(r.filas[0].error, undefined);
  assert.equal(r.filas[1].error, 'Sin nombre');
  assert.match(r.filas[2].error, /no existe/);
  assert.equal(r.filas[3].error, 'Repetida en el archivo');
});

test('revisarCsv: rechaza un archivo sin la columna del nombre, o sin filas', () => {
  assert.match(revisarCsv('precio;foto\n100;x', ctx).error, /nombre/);
  assert.ok(revisarCsv('nombre;precio', ctx).error);
  assert.ok(revisarCsv('', ctx).error);
});

test('revisarCsv: una sede que no está en el archivo simplemente no trae unidades', () => {
  const r = revisarCsv('nombre;Liberia\nUrbana;5', ctx);
  assert.deepEqual(r.filas[0].datos.stock, { 1: 5 });
  assert.equal(r.sedes, 1);
});

test('plantillaCsv: trae los títulos, las sedes del taller y una fila de ejemplo', () => {
  const p = plantillaCsv(ctx).split('\r\n');
  assert.match(p[0], /^nombre;categoria;.*;Liberia;Cañas$/);
  assert.match(p[1], /^Freedom Urbana 150;Scooter;nueva/);
});
