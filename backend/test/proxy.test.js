const test = require('node:test');
const assert = require('node:assert');
const { saltosDeProxy } = require('../src/utils/proxy');

test('sin TRUST_PROXY_SALTOS se confía en un solo proxy (Railway)', () => {
  assert.strictEqual(saltosDeProxy(undefined), 1);
  assert.strictEqual(saltosDeProxy(''), 1);
});

test('con Cloudflare delante se configuran 2 saltos', () => {
  assert.strictEqual(saltosDeProxy('2'), 2);
});

test('un valor raro cae a 1 en vez de confiar de más', () => {
  for (const v of ['0', '-1', '9', 'true', '1.5', 'todo']) assert.strictEqual(saltosDeProxy(v), 1);
});
