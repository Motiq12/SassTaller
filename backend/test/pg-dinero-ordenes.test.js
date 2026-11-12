const test = require('node:test');
const { casosDinero } = require('../scripts/lib/casos-dinero');

const url = process.env.PG_TEST_URL;
if (url && !/\/\w+_test(\?|$)/.test(url)) throw new Error('PG_TEST_URL debe terminar en _test');
if (url) process.env.DATABASE_URL = url;
process.env.JWT_SECRET = 'solo-tests-dinero-sin-secretos-reales';
process.env.RESEND_API_KEY = '';
const ctx = {};
let pool, server;

test.before(async () => {
  if (!url) return;
  ({ pool } = require('../src/db/pool'));
  await require('../src/db/migrar').migrar({ log: () => {} });
  ctx.db = pool;
  const jwt = require('jsonwebtoken');
  const sello = `${Date.now()}-${process.pid}`;
  for (const sufijo of ['a', 'b']) {
    const [t] = await pool.query("INSERT INTO tenants (nombre, slug) VALUES ('Dinero', ?)", [`dinero-${sello}-${sufijo}`]);
    const [u] = await pool.query("INSERT INTO usuarios (tenant_id, nombre, email, password_hash, rol) VALUES (?, 'Admin', ?, 'no-es-clave-real', 'admin')", [t.insertId, `dinero-${sello}-${sufijo}@prueba.test`]);
    const token = jwt.sign({ id: u.insertId, rol: 'admin', tenant_id: t.insertId }, process.env.JWT_SECRET, { expiresIn: '1h' });
    if (sufijo === 'a') Object.assign(ctx, { tenantId: t.insertId, usuarioId: u.insertId, token });
    else ctx.otroToken = token;
  }
  const [c] = await pool.query("INSERT INTO clientes (tenant_id, nombre, apellido, telefono) VALUES (?, 'Cliente', 'Prueba', '88881234')", [ctx.tenantId]);
  ctx.clienteId = c.insertId;
  const [v] = await pool.query("INSERT INTO vehiculos (tenant_id, cliente_id, placa, marca, modelo, tipo) VALUES (?, ?, ?, 'Toyota', 'Prueba', 'auto')", [ctx.tenantId, ctx.clienteId, `D${sello}`]);
  ctx.vehiculoId = v.insertId;
  ctx.clienteToken = jwt.sign({ id: ctx.clienteId, tipo: 'cliente', tenant_id: ctx.tenantId }, process.env.JWT_SECRET, { expiresIn: '1h' });
  const app = require('express')();
  app.use(require('express').json());
  for (const ruta of ['ordenes', 'recepcion', 'garantias', 'portal', 'clientes', 'mecanico']) app.use(`/api/${ruta}`, require(`../src/routes/${ruta}.routes`));
  await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); });
  ctx.pedir = async (met, ruta, { token, body } = {}) => {
    const r = await fetch(`http://127.0.0.1:${server.address().port}/api${ruta}`, {
      method: met, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: r.status, json: await r.json() };
  };
});

test.after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  if (pool) await pool.end();
});

for (const [nombre, ejecutar] of casosDinero(ctx)) test(nombre, { skip: !url && 'sin PG_TEST_URL' }, ejecutar);
