// Los topes del plan gratis (2 usuarios, 1 sucursal) no se pueden esquivar
// reactivando. Antes el alta comprobaba el tope pero la reactivación no, así que
// alcanzaba con desactivar a uno, crear otro y volver a activar al primero.
//
// Mismo armado que login-flujos.test.js: HTTP real contra los routers y una base
// falsa que pasa cada consulta por el guard de tenant. Nunca toca la base real.
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

process.env.JWT_SECRET = 'secreto-de-test';
const jwt = require('jsonwebtoken');
const express = require('express');
const tenantDb = require('../src/db/tenant-db');
const { fijarPlan } = require('../src/utils/estado-tenant');

const TALLER = 1;
let estado;       // lo que hay en la "base" en cada test
let escrituras;

function baseFalsa(tenantId) {
  const query = async (sql, params = []) => {
    tenantDb.exigirScope(sql);
    if (/COUNT\(\*\) AS n FROM usuarios/i.test(sql)) return [[{ n: estado.usuariosActivos }]];
    if (/COUNT\(\*\) AS n FROM sucursales/i.test(sql)) return [[{ n: estado.sucursalesActivas }]];
    if (/SELECT activo FROM usuarios/i.test(sql)) return [estado.usuario ? [{ activo: estado.usuario.activo }] : []];
    if (/SELECT activa FROM sucursales/i.test(sql)) return [estado.sucursal ? [{ activa: estado.sucursal.activa }] : []];
    if (/COUNT\(\*\) AS activas/i.test(sql)) return [[{ activas: estado.sucursalesActivas }]];
    if (/^\s*select/i.test(sql)) return [[]];
    escrituras.push({ sql, params });
    return [{ affectedRows: 1 }];
  };
  return { tenantId, query, execute: query };
}
tenantDb.paraTenant = (id) => baseFalsa(id);

const app = express();
app.use(express.json());
app.use('/api/usuarios', require('../src/routes/usuarios.routes'));
app.use('/api/admin', require('../src/routes/admin.routes'));

let base;
const server = http.createServer(app);
test.before(() => new Promise(r => server.listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; r(); })));
test.after(() => new Promise(r => server.close(r)));
test.beforeEach(() => {
  fijarPlan(TALLER, 'gratis');
  estado = { usuariosActivos: 0, sucursalesActivas: 0, usuario: null, sucursal: null };
  escrituras = [];
});

const TOKEN_ADMIN = jwt.sign({ id: 1, rol: 'admin', tenant_id: TALLER }, process.env.JWT_SECRET);
async function patch(ruta, cuerpo) {
  const res = await fetch(base + ruta, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN_ADMIN}` },
    body: JSON.stringify(cuerpo),
  });
  return { status: res.status, body: await res.json() };
}
const activoEscrito = () => escrituras.some(e => /SET (activo|activa) = \?/.test(e.sql) && e.params[0] === 1);

// ── Usuarios (gratis: tope 2) ─────────────────────────────────────────────
test('usuarios: reactivar con el tope lleno devuelve 402 y no toca la base', async () => {
  estado.usuariosActivos = 2;
  estado.usuario = { activo: 0 };
  const { status, body } = await patch('/api/usuarios/5/activo', { activo: true });
  assert.equal(status, 402);
  assert.equal(body.tope, 'usuarios');
  assert.equal(activoEscrito(), false);
});

test('usuarios: reactivar con lugar en el plan funciona', async () => {
  estado.usuariosActivos = 1;
  estado.usuario = { activo: 0 };
  const { status } = await patch('/api/usuarios/5/activo', { activo: true });
  assert.equal(status, 200);
  assert.equal(activoEscrito(), true);
});

test('usuarios: "activar" a uno ya activo no choca con el tope (no suma nada)', async () => {
  estado.usuariosActivos = 2;
  estado.usuario = { activo: 1 };
  const { status } = await patch('/api/usuarios/5/activo', { activo: true });
  assert.equal(status, 200);
});

test('usuarios: desactivar nunca mira el tope', async () => {
  estado.usuariosActivos = 5; // p. ej. un taller que bajó de trial con más gente
  const { status } = await patch('/api/usuarios/5/activo', { activo: false });
  assert.equal(status, 200);
});

test('usuarios: en trial no hay tope que valga', async () => {
  fijarPlan(TALLER, 'trial');
  estado.usuariosActivos = 40;
  estado.usuario = { activo: 0 };
  const { status } = await patch('/api/usuarios/5/activo', { activo: true });
  assert.equal(status, 200);
});

// ── Sucursales (gratis: tope 1) ───────────────────────────────────────────
test('sucursales: reactivar con el tope lleno devuelve 402 y no toca la base', async () => {
  estado.sucursalesActivas = 1;
  estado.sucursal = { activa: 0 };
  const { status, body } = await patch('/api/admin/sucursales/3/activa', { activa: true });
  assert.equal(status, 402);
  assert.equal(body.tope, 'sucursales');
  assert.equal(activoEscrito(), false);
});

test('sucursales: reactivar con lugar en el plan funciona', async () => {
  fijarPlan(TALLER, 'pro');
  estado.sucursalesActivas = 3;
  estado.sucursal = { activa: 0 };
  const { status } = await patch('/api/admin/sucursales/3/activa', { activa: true });
  assert.equal(status, 200);
  assert.equal(activoEscrito(), true);
});

test('sucursales: reactivar una que no existe da 404', async () => {
  const { status } = await patch('/api/admin/sucursales/99/activa', { activa: true });
  assert.equal(status, 404);
});
