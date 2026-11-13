// Flujos de ingreso de punta a punta (HTTP real contra los routers), con una base falsa.
//
// Por qué existen: cuatro flujos entregaban un token SIN `tenant_id` (2FA del personal,
// verificación de registro, recuperación y código por correo del portal). El token
// firmaba bien, pero middleware/tenant lo cortaba con 401 en el primer pedido. Ningún
// test lo veía porque solo había tests de utilidades, no de endpoints.
//
// La base falsa hace dos cosas que importan para que estos tests detecten esos bugs:
//   1. Pasa cada consulta por el guard real (exigirScope): una consulta sin
//      `tenant_id` revienta acá igual que en producción.
//   2. Devuelve SOLO las columnas que el SELECT pide. Si una consulta se olvida de
//      traer `tenant_id`, el objeto que recibe la ruta tampoco lo tiene, como en MySQL.
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const path = require('node:path');

process.env.JWT_SECRET = 'secreto-de-test';
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const express = require('express');
const totp = require('../src/utils/totp');
const tenantDb = require('../src/db/tenant-db');

// ── Base falsa ────────────────────────────────────────────────────────────
// `tablas` es lo que hay en la "base" para el test en curso: { regex: fila | filas }.
let tablas = [];
let escrituras = [];

function recorte(sql, fila) {
  const m = sql.match(/select\s+([\s\S]*?)\s+from\s/i);
  if (!m || /^\s*\*/.test(m[1])) return { ...fila };
  const pedidas = m[1].split(',').map(c => c.trim().split(/\s+/).pop().replace(/^\w+\./, ''));
  return Object.fromEntries(Object.entries(fila).filter(([k]) => pedidas.includes(k)));
}

function baseFalsa(tenantId) {
  const query = async (sql, params = []) => {
    tenantDb.exigirScope(sql);
    if (/^\s*select/i.test(sql)) {
      const hit = tablas.find(t => t.re.test(sql));
      const filas = hit ? [].concat(hit.filas) : [];
      return [filas.map(f => recorte(sql, f))];
    }
    escrituras.push({ sql, params });
    return [{ affectedRows: 1, insertId: 1 }];
  };
  return { tenantId, query, execute: query };
}

// Los routers toman `paraTenant` al cargarse: se reemplaza ANTES de requerirlos.
tenantDb.paraTenant = (id) => baseFalsa(id);
// /auth/login usa el pool crudo a propósito (todavía no sabe de qué taller es quien
// entra), así que el guard no aplica: se simula sin él. Nunca toca la base real.
const { pool } = require('../src/db/pool');
pool.query = async (sql) => {
  if (/^INSERT INTO sesiones_personal/i.test(sql)) return [{ affectedRows: 1 }];
  if (/FROM sesiones_personal/i.test(sql)) return [[{ id: 1, cerrada: null }]];
  const hit = tablas.find(t => t.re.test(sql));
  return [(hit ? [].concat(hit.filas) : []).map(f => recorte(sql, f))];
};
// El tramo público del portal resuelve el taller por slug contra la base real; acá
// el taller ya está decidido.
const rutaPublico = require.resolve('../src/middleware/tenant-publico');
require.cache[rutaPublico] = {
  id: rutaPublico, filename: rutaPublico, loaded: true,
  exports: (req, _res, next) => { req.db = baseFalsa(1); req.tallerSlug = 'demo'; next(); },
};

const app = express();
app.use(express.json());
app.use('/api/auth', require(path.join(__dirname, '../src/routes/auth.routes')));
app.use('/api/portal', require(path.join(__dirname, '../src/routes/portal.routes')));
app.use('/api/mecanico', require(path.join(__dirname, '../src/routes/mecanico.routes')));

let base;
const server = http.createServer(app);
test.before(() => new Promise(r => server.listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; r(); })));
test.after(() => new Promise(r => server.close(r)));
test.beforeEach(() => { tablas = []; escrituras = []; });

async function pedir(metodo, ruta, cuerpo, token) {
  const res = await fetch(base + ruta, {
    method: metodo,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  return { status: res.status, body: await res.json() };
}

const HASH_123456 = bcrypt.hashSync('123456', 4);
const cliente = (extra = {}) => ({
  id: 40, tenant_id: 1, nombre: 'Lu', apellido: 'Mora', email: 'lu@x.com',
  foto: null, activo: 1, portal_habilitado: 1, portal_version: 0, password_hash: 'h', email_verificado: 0, ...extra,
});

// ── 2FA del personal ──────────────────────────────────────────────────────
const SECRETO = totp.generarSecreto();
const usuario2fa = (extra = {}) => ({
  id: 7, tenant_id: 3, nombre: 'Ana', email: 'ana@x.com', rol: 'admin', activo: 1,
  totp_secret: SECRETO, totp_activado: 1, totp_backup: null, totp_ultimo_contador: 0, ...extra,
});
const parcial = () => jwt.sign({ id: 7, tenant_id: 3, pend2fa: true }, process.env.JWT_SECRET, { expiresIn: '5m' });

test('2FA con la app: la sesión sale con el taller del token parcial', async () => {
  tablas = [{ re: /from usuarios/i, filas: usuario2fa() }];
  const codigo = totp.codigoPara(SECRETO, Math.floor(Date.now() / 1000 / totp.PERIODO));
  const { status, body } = await pedir('POST', '/api/auth/2fa/verificar', { token_parcial: parcial(), codigo });
  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(jwt.decode(body.data.token).tenant_id, 3);
});

test('2FA con código de respaldo: entra y el código queda quemado', async () => {
  const hash = bcrypt.hashSync('A1B2C3D4', 4);
  tablas = [{ re: /from usuarios/i, filas: usuario2fa({ totp_backup: JSON.stringify([hash]) }) }];
  const { status, body } = await pedir('POST', '/api/auth/2fa/verificar', { token_parcial: parcial(), codigo: 'a1b2-c3d4' });
  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(jwt.decode(body.data.token).tenant_id, 3);
  const quema = escrituras.find(e => /totp_backup/.test(e.sql));
  assert.ok(quema, 'no se actualizó la lista de códigos de respaldo');
  assert.equal(quema.params[0], '[]');
});

// ── Portal del cliente ────────────────────────────────────────────────────
test('portal: entrar con código por correo da un token con taller', async () => {
  tablas = [
    { re: /from login_codes/i, filas: { id: 1, code_hash: HASH_123456, attempts: 0 } },
    { re: /from clientes/i, filas: cliente({ email_verificado: 1 }) },
  ];
  const { status, body } = await pedir('POST', '/api/portal/otp/verificar', { email: 'lu@x.com', codigo: '123456' });
  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(jwt.decode(body.data.token).tenant_id, 1);
});

test('portal: recuperar la contraseña da un token con taller', async () => {
  tablas = [
    { re: /from password_reset_codes/i, filas: { id: 1, code_hash: HASH_123456, attempts: 0 } },
    { re: /from clientes/i, filas: cliente({ email_verificado: 1 }) },
  ];
  const { status, body } = await pedir('POST', '/api/portal/recuperar/confirmar', { email: 'lu@x.com', codigo: '123456', password: 'nueva-clave-1' });
  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(jwt.decode(body.data.token).tenant_id, 1);
});

test('portal: confirmar el registro con el código da un token con taller', async () => {
  tablas = [
    { re: /from email_verify_codes/i, filas: { id: 1, code_hash: HASH_123456, attempts: 0 } },
    { re: /from clientes/i, filas: cliente() },
  ];
  const { status, body } = await pedir('POST', '/api/portal/registro/verificar', { email: 'lu@x.com', codigo: '123456' });
  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(jwt.decode(body.data.token).tenant_id, 1);
});

test('portal: un cliente ya verificado NO recibe sesión por /registro/verificar', async () => {
  // Antes devolvía un token sin mirar el código: con saber el correo de un cliente que
  // cargó el taller (nacen verificados) alcanzaba para entrar a su cuenta.
  tablas = [{ re: /from clientes/i, filas: cliente({ email_verificado: 1 }) }];
  const { status, body } = await pedir('POST', '/api/portal/registro/verificar', { email: 'lu@x.com', codigo: '000000' });
  assert.equal(status, 409);
  assert.equal(body.data, undefined);
});

// ── Toma de cuenta por el login unificado ────────────────────────────────
// El ataque: /portal/registro "reclama" un cliente que el taller cargó sin contraseña
// y le pone la del atacante, con email_verificado = 0. Antes /auth/login no miraba
// ese campo y le daba la sesión.
const HASH_CLAVE = bcrypt.hashSync('clave-del-atacante', 4);

test('login unificado: un cliente con el correo sin confirmar no entra con contraseña', async () => {
  tablas = [{ re: /from clientes/i, filas: cliente({ password_hash: HASH_CLAVE, email_verificado: 0 }) }];
  const { status, body } = await pedir('POST', '/api/auth/login', { email: 'lu@x.com', password: 'clave-del-atacante' });
  assert.equal(status, 403);
  assert.equal(body.requiere_verificacion, true);
  assert.equal(body.data, undefined);
});

test('login unificado: un cliente con el correo confirmado entra normalmente', async () => {
  tablas = [{ re: /from clientes/i, filas: cliente({ password_hash: HASH_CLAVE, email_verificado: 1 }) }];
  const { status, body } = await pedir('POST', '/api/auth/login', { email: 'lu@x.com', password: 'clave-del-atacante' });
  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(body.data.tipo, 'cliente');
  assert.equal(jwt.decode(body.data.token).tenant_id, 1);
});

test('portal: entrar por código no confirma una cuenta con contraseña pendiente', async () => {
  // Si lo hiciera, el dueño real del correo, al entrar por código, dejaría activa la
  // contraseña que puso el atacante al reclamar la cuenta.
  tablas = [
    { re: /from login_codes/i, filas: { id: 1, code_hash: HASH_123456, attempts: 0 } },
    { re: /from clientes/i, filas: cliente({ password_hash: HASH_CLAVE, email_verificado: 0 }) },
  ];
  const { status } = await pedir('POST', '/api/portal/otp/verificar', { email: 'lu@x.com', codigo: '123456' });
  assert.equal(status, 200);
  const promocion = escrituras.find(e => /email_verificado = 1/.test(e.sql));
  assert.ok(promocion, 'no se intentó confirmar el correo');
  assert.match(promocion.sql, /password_hash IS NULL/, 'confirma el correo aunque haya una contraseña pendiente');
});

// ── Mecánico ──────────────────────────────────────────────────────────────
test('mecánico: cambiar el estado de su cita no choca con el guard de tenant', async () => {
  tablas = [
    { re: /from citas/i, filas: { id: 5, estado: 'agendado', orden_id: null } },
    { re: /from usuarios/i, filas: { activo: 1, sesiones_desde_ms: null } },
  ];
  const token = jwt.sign({ id: 9, rol: 'tecnico', tenant_id: 1, sid: 'sesion-mecanico' }, process.env.JWT_SECRET);
  const { status, body } = await pedir('PATCH', '/api/mecanico/citas/5/estado', { estado: 'en_revision' }, token);
  assert.equal(status, 200, JSON.stringify(body));
  assert.ok(escrituras.some(e => /^UPDATE citas SET/.test(e.sql)));
});

// ── Login unificado: el mismo correo en varios talleres ──────────────────
const CLAVE_LOGIN = 'ClaveSegura123';
const HASH_LOGIN = bcrypt.hashSync(CLAVE_LOGIN, 4);
const talleresDeLogin = { re: /from tenants/i, filas: [{ id: 1, nombre: 'Alfa', slug: 'alfa' }, { id: 2, nombre: 'Beta', slug: 'beta' }] };
const clienteDe = (id, tenant_id, password_hash = HASH_LOGIN) => cliente({ id, tenant_id, password_hash, email_verificado: 1 });

test('login: la cuenta de cliente del segundo taller también entra', async () => {
  tablas = [{ re: /from clientes/i, filas: [clienteDe(1, 1, bcrypt.hashSync('OtraClave99', 4)), clienteDe(2, 2)] }, talleresDeLogin];
  const { status, body } = await pedir('POST', '/api/auth/login', { email: 'lu@x.com', password: CLAVE_LOGIN });
  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(body.data.tipo, 'cliente');
  assert.equal(jwt.decode(body.data.token).tenant_id, 2);
});

test('login: con la misma contraseña en dos talleres pregunta a cuál entrar', async () => {
  tablas = [{ re: /from clientes/i, filas: [clienteDe(1, 1), clienteDe(2, 2)] }, talleresDeLogin];
  const { status, body } = await pedir('POST', '/api/auth/login', { email: 'lu@x.com', password: CLAVE_LOGIN });
  assert.equal(status, 409);
  assert.deepEqual(body.talleres.map(t => t.slug), ['alfa', 'beta']);
  assert.equal(body.token, undefined);
});

test('login: la contraseña equivocada no revela en qué talleres está el correo', async () => {
  tablas = [{ re: /from clientes/i, filas: [clienteDe(1, 1), clienteDe(2, 2)] }, talleresDeLogin];
  const { status, body } = await pedir('POST', '/api/auth/login', { email: 'lu@x.com', password: 'NoEsLaClave1' });
  assert.equal(status, 401);
  assert.equal(body.talleres, undefined);
});

test('login: entra sin preguntar al último taller que usó', async () => {
  tablas = [{ re: /from clientes/i, filas: [clienteDe(1, 1), clienteDe(2, 2)] }, talleresDeLogin];
  const { status, body } = await pedir('POST', '/api/auth/login', { email: 'lu@x.com', password: CLAVE_LOGIN, preferido: 'beta' });
  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(jwt.decode(body.data.token).tenant_id, 2);
});

test('login: un preferido ajeno no da acceso: vuelve a preguntar', async () => {
  tablas = [{ re: /from clientes/i, filas: [clienteDe(1, 1), clienteDe(2, 2)] }, talleresDeLogin];
  const { status } = await pedir('POST', '/api/auth/login', { email: 'lu@x.com', password: CLAVE_LOGIN, preferido: 'gamma' });
  assert.equal(status, 409);
});
