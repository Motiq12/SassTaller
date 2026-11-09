// Qué hosts identifican a un taller (middleware/tenant-publico.js).
// La regla es la misma que usa el frontend en services/taller.service.ts.
const test = require('node:test');
const assert = require('node:assert');
const { slugDelHost } = require('../src/middleware/tenant-publico');

test('un subdominio del producto es un taller', () => {
  assert.strictEqual(slugDelHost('msmotors.motiq12.com'), 'msmotors');
  assert.strictEqual(slugDelHost('MS-Motors.motiq12.com'), 'ms-motors');
});

test('el dominio del producto NO es un taller (era el bug: motiq12.com → "motiq12")', () => {
  assert.strictEqual(slugDelHost('motiq12.com'), null);
  assert.strictEqual(slugDelHost('www.motiq12.com'), null);
});

test('los dominios del hosting, las IP y localhost no son talleres', () => {
  assert.strictEqual(slugDelHost('8oet1zi6.up.railway.app'), null);
  assert.strictEqual(slugDelHost('localhost'), null);
  assert.strictEqual(slugDelHost('127.0.0.1'), null);
  assert.strictEqual(slugDelHost('192.168.1.20'), null);
  assert.strictEqual(slugDelHost('::1'), null);
  assert.strictEqual(slugDelHost(''), null);
  assert.strictEqual(slugDelHost(undefined), null);
});
