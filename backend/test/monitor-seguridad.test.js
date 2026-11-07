const { test } = require('node:test');
const assert = require('node:assert');
const express = require('express');

// El vigilante de n8n lee /api/monitor/seguridad con su propia clave (MONITOR_CLAVE).
const { enmascararCorreo, claveCorrecta } = require('../src/utils/eventos-seguridad');

test('los correos que no son del equipo van enmascarados', () => {
  assert.strictEqual(enmascararCorreo('pedro.solis@gmail.com'), 'p***@gmail.com');
  assert.strictEqual(enmascararCorreo('sinarroba'), 's***');
  assert.strictEqual(enmascararCorreo(''), '');
});

test('la clave se compara completa', () => {
  const clave = 'a'.repeat(40);
  assert.strictEqual(claveCorrecta(clave, clave), true);
  assert.strictEqual(claveCorrecta('a'.repeat(39), clave), false);
  assert.strictEqual(claveCorrecta('', clave), false);
  assert.strictEqual(claveCorrecta(clave, ''), false);
});

// La ruta sin base de datos: solo lo que responde antes de leer nada.
async function pedir(clave) {
  const app = express();
  app.use('/api/monitor', require('../src/routes/monitor.routes'));
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const r = await fetch(`http://127.0.0.1:${port}/api/monitor/seguridad`, { headers: clave ? { 'X-Monitor-Clave': clave } : {} });
    return r.status;
  } finally {
    server.close();
  }
}

test('sin MONITOR_CLAVE (o con una corta) la ruta no existe', async () => {
  delete process.env.MONITOR_CLAVE;
  assert.strictEqual(await pedir('cualquiera'), 404);
  process.env.MONITOR_CLAVE = 'corta';
  assert.strictEqual(await pedir('corta'), 404);
});

test('con MONITOR_CLAVE, sin clave o con una equivocada no entra', async () => {
  process.env.MONITOR_CLAVE = 'b'.repeat(40);
  assert.strictEqual(await pedir(null), 401);
  assert.strictEqual(await pedir('c'.repeat(40)), 401);
  delete process.env.MONITOR_CLAVE;
});
