const { test } = require('node:test');
const assert = require('node:assert');

// Configuración → Respaldos: qué copias hay guardadas y en qué estado se muestran.
const { respaldosGuardados, resumirRespaldos } = require('../src/services/respaldo');

const P = 'respaldos/';
const objetos = [
  { clave: 'respaldos/railway_2026-10-22T08-30-00Z.sql.gz.enc', bytes: 1300000 },
  { clave: 'respaldos/railway_2026-10-24T08-30-00Z.sql.gz.enc', bytes: 1400000 },
  { clave: 'respaldos/railway_2026-10-23T08-30-00Z.sql.gz', bytes: 1350000 },
  { clave: 'respaldos/notas.txt', bytes: 10 },          // no es un respaldo
  { clave: 'otra-cosa/railway_2026-10-25T08-30-00Z.sql.gz', bytes: 1 }, // otro prefijo
];

test('respaldosGuardados: solo los respaldos, del más nuevo al más viejo', () => {
  const g = respaldosGuardados(objetos, P);
  assert.deepStrictEqual(g.map((x) => x.fecha), ['2026-10-24T08:30:00Z', '2026-10-23T08:30:00Z', '2026-10-22T08:30:00Z']);
  assert.strictEqual(g[0].nombre, 'railway_2026-10-24T08-30-00Z.sql.gz.enc');
  assert.strictEqual(g[0].cifrado, true);
  assert.strictEqual(g[1].cifrado, false);
  assert.strictEqual(g[0].bytes, 1400000);
});

const ahora = new Date('2026-10-24T20:00:00Z');
const ok = (fecha) => ({ ok: 1, created_at: new Date(fecha) });
const mal = (fecha) => ({ ok: 0, created_at: new Date(fecha), error: 'sin red' });

test('sin configurar manda sobre todo', () => {
  assert.strictEqual(resumirRespaldos({ activo: false, registro: [ok('2026-10-24T08:30:00Z')], ahora }).estado, 'sin_configurar');
});

test('al día con un respaldo de anoche', () => {
  const r = resumirRespaldos({ activo: true, registro: [ok('2026-10-24T08:31:00Z')], guardados: null, ahora });
  assert.deepStrictEqual(r, { estado: 'al_dia', ultimo_ok: '2026-10-24T08:31:00.000Z' });
});

test('el último que falló se muestra como fallo, con el último bueno', () => {
  const r = resumirRespaldos({ activo: true, registro: [mal('2026-10-24T08:30:00Z'), ok('2026-10-23T08:30:00Z')], ahora });
  assert.deepStrictEqual(r, { estado: 'fallo', ultimo_ok: '2026-10-23T08:30:00.000Z' });
});

test('atrasado si el último bueno tiene más de 30 horas', () => {
  assert.strictEqual(resumirRespaldos({ activo: true, registro: [ok('2026-10-23T08:30:00Z')], ahora }).estado, 'atrasado');
});

test('sin registro todavía (recién instalado), vale lo que hay guardado', () => {
  const r = resumirRespaldos({ activo: true, registro: [], guardados: respaldosGuardados(objetos, P), ahora });
  assert.deepStrictEqual(r, { estado: 'al_dia', ultimo_ok: '2026-10-24T08:30:00Z' });
  assert.strictEqual(resumirRespaldos({ activo: true, registro: [], guardados: [], ahora }).estado, 'sin_datos');
});
