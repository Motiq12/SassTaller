// T04: ids de otro taller en el CUERPO de los pedidos, con PostgreSQL y HTTP reales.
// Los casos están en scripts/lib/casos-referencias.js (también los corre la prueba de dos empresas).
const test = require('node:test');
const { casosReferencias } = require('../scripts/lib/casos-referencias');

const url = process.env.PG_TEST_URL;
if (url && !/\/\w+_test(\?|$)/.test(url)) throw new Error('PG_TEST_URL debe terminar en _test');
if (url) process.env.DATABASE_URL = url;
process.env.JWT_SECRET = process.env.JWT_SECRET || 'solo-tests-referencias-sin-secretos-reales';
process.env.RESEND_API_KEY = '';
const ctx = { propio: { tokens: {} }, otro: {} };
let pool, server;

test.before(async () => {
  if (!url) return;
  ({ pool } = require('../src/db/pool'));
  await require('../src/db/migrar').migrar({ log: () => {} });
  ctx.db = pool;
  const jwt = require('jsonwebtoken');
  const { abrirSesion, nuevoSid } = require('../src/utils/sesiones');
  const sello = `${Date.now()}-${process.pid}`;
  // Sesión real, como en el login: el token lleva el sid de una fila de sesiones_personal.
  const sesion = async (usuarioId, rol, tenantId) => {
    const sid = nuevoSid();
    const token = jwt.sign({ id: usuarioId, rol, tenant_id: tenantId, sid }, process.env.JWT_SECRET, { expiresIn: '1h' });
    if (!(await abrirSesion(usuarioId, { headers: {}, ip: '127.0.0.1' }, jwt.decode(token).exp, sid))) throw new Error('no se pudo abrir la sesión de prueba');
    return token;
  };
  const uno = async (sql, params) => (await pool.query(sql, params))[0][0];
  for (const lado of ['propio', 'otro']) {
    const t = await uno("INSERT INTO tenants (nombre, slug) VALUES ('Referencias', ?) RETURNING id", [`ref-${sello}-${lado}`]);
    ctx[lado].tenantId = t.id;
  }
  const P = ctx.propio;
  P.sedeId = (await uno("INSERT INTO sucursales (tenant_id, nombre, activa) VALUES (?, 'Sede propia', 1) RETURNING id", [P.tenantId])).id;
  const usuario = async (rol, sede) => (await uno(
    'INSERT INTO usuarios (tenant_id, nombre, email, password_hash, rol, sucursal_id) VALUES (?, ?, ?, \'no-es-clave-real\', ?, ?) RETURNING id',
    [P.tenantId, rol, `ref-${sello}-${rol}@prueba.test`, rol, sede])).id;
  P.adminId = await usuario('admin', null);
  P.recepcionId = await usuario('recepcion', P.sedeId);
  P.tecnicoId = await usuario('tecnico', P.sedeId);
  P.tokens.admin = await sesion(P.adminId, 'admin', P.tenantId);
  P.tokens.recepcion = await sesion(P.recepcionId, 'recepcion', P.tenantId);
  P.tokens.tecnico = await sesion(P.tecnicoId, 'tecnico', P.tenantId);
  P.clienteId = (await uno("INSERT INTO clientes (tenant_id, nombre, apellido, telefono) VALUES (?, 'Cliente', 'Propio', '88881234') RETURNING id", [P.tenantId])).id;
  P.vehiculoId = (await uno("INSERT INTO vehiculos (tenant_id, cliente_id, placa, marca, modelo, tipo) VALUES (?, ?, ?, 'Toyota', 'Prueba', 'auto') RETURNING id", [P.tenantId, P.clienteId, `RF${Date.now().toString(36)}`.toUpperCase()])).id;
  P.tokens.cliente = jwt.sign({ id: P.clienteId, tipo: 'cliente', tenant_id: P.tenantId }, process.env.JWT_SECRET, { expiresIn: '1h' });

  ctx.conexionAparte = async () => {
    const conn = await pool.getConnection();
    return { query: (sql, params) => conn.query(sql, params), end: async () => conn.release() };
  };
  const express = require('express');
  const app = express();
  app.use(express.json());
  for (const ruta of ['auth', 'ordenes', 'citas', 'recepcion', 'clientes', 'portal', 'mecanico']) app.use(`/api/${ruta}`, require(`../src/routes/${ruta}.routes`));
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  ctx.pedir = async (met, ruta, { token, body } = {}) => {
    const r = await fetch(`http://127.0.0.1:${server.address().port}/api${ruta}`, {
      method: met, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const texto = await r.text();
    let json = null; try { json = JSON.parse(texto); } catch { /* */ }
    return { status: r.status, json };
  };
});

test.after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (pool) await pool.end();
});

for (const [nombre, ejecutar] of casosReferencias(ctx)) test(nombre, { skip: !url && 'sin PG_TEST_URL' }, ejecutar);
