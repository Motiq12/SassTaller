const { test } = require('node:test');
const assert = require('node:assert');

// "Hoy", la semana y el mes en la hora del taller (utils/sql-fechas.js). En Railway la
// base corre en UTC: a las 7 p. m. de Costa Rica, CURDATE() ya es mañana.
const { rangoDelTaller, inicioDelDia, enPeriodo, hoySQL, diasDelPeriodo } = require('../src/utils/sql-fechas');

const NOCHE = Date.parse('2026-10-25T01:00:00Z'); // sábado 24-oct-2026, 7 p. m. en CR

test('a las 7 p. m. de Costa Rica, hoy sigue siendo hoy', () => {
  assert.deepStrictEqual(rangoDelTaller('hoy', -6, NOCHE), { desde: '2026-10-24', hasta: '2026-10-25' });
  assert.strictEqual(hoySQL(-6, NOCHE), "'2026-10-24'");
});

test('semana de lunes a domingo, mes, mes pasado y año', () => {
  assert.deepStrictEqual(rangoDelTaller('semana', -6, NOCHE), { desde: '2026-10-19', hasta: '2026-10-26' });
  assert.deepStrictEqual(rangoDelTaller('mes', -6, NOCHE), { desde: '2026-10-01', hasta: '2026-11-01' });
  assert.deepStrictEqual(rangoDelTaller('mes_pasado', -6, NOCHE), { desde: '2026-09-01', hasta: '2026-10-01' });
  assert.deepStrictEqual(rangoDelTaller('anio', -6, NOCHE), { desde: '2026-01-01', hasta: '2027-01-01' });
  // El 31 de diciembre a las 9 p. m. todavía es diciembre (en UTC ya es enero).
  const fin = Date.parse('2027-01-01T03:00:00Z');
  assert.deepStrictEqual(rangoDelTaller('mes', -6, fin), { desde: '2026-12-01', hasta: '2027-01-01' });
  // En enero, el mes pasado es diciembre del año anterior.
  assert.deepStrictEqual(rangoDelTaller('mes_pasado', -6, Date.parse('2027-01-10T15:00:00Z')), { desde: '2026-12-01', hasta: '2027-01-01' });
  // Un domingo es el último día de su semana.
  assert.deepStrictEqual(rangoDelTaller('semana', -6, Date.parse('2026-10-25T18:00:00Z')), { desde: '2026-10-19', hasta: '2026-10-26' });
  assert.throws(() => rangoDelTaller('siempre'));
});

test('el día del taller empieza a las 6:00 UTC', () => {
  assert.strictEqual(inicioDelDia('2026-10-24', -6).toISOString(), '2026-10-24T06:00:00.000Z');
});

test('enPeriodo arma la condición y no acepta columnas raras', () => {
  assert.strictEqual(enPeriodo('c.fecha', 'mes', { offset: -6, ahora: NOCHE }), "(c.fecha >= '2026-10-01' AND c.fecha < '2026-11-01')");
  const momento = enPeriodo('fecha_fin', 'hoy', { momento: true, offset: -6, ahora: NOCHE });
  assert.match(momento, /^\(fecha_fin >= '\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}' AND fecha_fin < '.+'\)$/);
  assert.throws(() => enPeriodo('fecha; DROP TABLE citas', 'hoy'));
});

test('días del período para la serie de reportes', () => {
  assert.strictEqual(diasDelPeriodo('mes', -6, NOCHE), 31);
  assert.strictEqual(diasDelPeriodo('mes_pasado', -6, NOCHE), 30);
  assert.strictEqual(diasDelPeriodo('mes', -6, Date.parse('2028-02-10T15:00:00Z')), 29);
});
