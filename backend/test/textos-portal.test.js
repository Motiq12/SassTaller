const { test } = require('node:test');
const assert = require('node:assert');

// Textos del portal que escribe el taller (utils/textos-portal.js).
const { normalizarTextosPortal, textosParaGuardar } = require('../src/utils/textos-portal');

test('normalizar: vacío si no hay nada o no es JSON', () => {
  const vacio = { bienvenida: { titulo: '', texto: '' }, condiciones: [], condiciones_actualizado: null };
  assert.deepStrictEqual(normalizarTextosPortal(null), vacio);
  assert.deepStrictEqual(normalizarTextosPortal('{roto'), vacio);
});

test('normalizar recorta, descarta secciones a medias y pone tope', () => {
  const n = normalizarTextosPortal({
    bienvenida: { titulo: '  Aviso  ', texto: 'x'.repeat(600) },
    condiciones: [{ titulo: 'Garantía', texto: ' 30 días ' }, { titulo: 'Sin texto', texto: '' }, ...Array(30).fill({ titulo: 'A', texto: 'b' })],
  });
  assert.strictEqual(n.bienvenida.titulo, 'Aviso');
  assert.strictEqual(n.bienvenida.texto.length, 500);
  assert.deepStrictEqual(n.condiciones[0], { titulo: 'Garantía', texto: '30 días' });
  assert.strictEqual(n.condiciones.length, 20);
});

test('la fecha de las condiciones se pone sola, solo cuando cambian', () => {
  const antes = { condiciones: [{ titulo: 'Garantía', texto: '30 días' }], condiciones_actualizado: '2026-10-01' };
  // Cambia solo la bienvenida: la fecha queda.
  assert.strictEqual(textosParaGuardar({ ...antes, bienvenida: { texto: 'Hola' } }, antes, '2026-10-24').condiciones_actualizado, '2026-10-01');
  // Cambian las condiciones: hoy.
  assert.strictEqual(textosParaGuardar({ condiciones: [{ titulo: 'Garantía', texto: '60 días' }] }, antes, '2026-10-24').condiciones_actualizado, '2026-10-24');
  // Sin condiciones propias (vuelve a las de fábrica): sin fecha.
  assert.strictEqual(textosParaGuardar({ condiciones: [] }, antes, '2026-10-24').condiciones_actualizado, null);
  // No se puede mandar una fecha inventada.
  assert.strictEqual(textosParaGuardar({ condiciones: antes.condiciones, condiciones_actualizado: '2020-01-01' }, antes, '2026-10-24').condiciones_actualizado, '2026-10-01');
});
