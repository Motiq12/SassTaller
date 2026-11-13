// Regresiones B-04/05/07/08: routers HTTP y sesiones persistidas en Postgres.
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');

const url = process.env.PG_TEST_URL;
if (url && !/\/\w+_test(\?|$)/.test(url)) throw new Error('Se requiere una base propia terminada en _test');
if (url) process.env.DATABASE_URL = url;
process.env.JWT_SECRET = 'prueba-local-sesiones-t03';
delete process.env.TURNSTILE_SECRET;
const t = (nombre, fn) => test(nombre, { skip: !url && 'sin PG_TEST_URL' }, fn);

let pool, server, base, admin, tenantId, sucursalId, rolId, numero = 0;
const clave = 'UnaClaveSegura123';
const hash = bcrypt.hashSync(clave, 4);
const codigoHash = bcrypt.hashSync('654321', 4);

async function pedir(method, ruta, body, token) {
  const r = await fetch(base + ruta, {
    method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: await r.json() };
}
const estadoStaff = token => pedir('GET', '/prueba/staff', null, token);
const estadoCliente = token => pedir('GET', '/prueba/cliente', null, token);
async function entrar(email) {
  const r = await pedir('POST', '/api/auth/login', { email, password: clave });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.data.token;
}
async function empleado() {
  const email = `empleado${++numero}@prueba.test`;
  const [r] = await pool.query("INSERT INTO usuarios (tenant_id, nombre, email, password_hash, rol) VALUES (?, 'Empleado', ?, ?, 'recepcion')", [tenantId, email, hash]);
  return { id: r.insertId, email, token: await entrar(email) };
}
async function cliente() {
  const email = `cliente${++numero}@prueba.test`;
  const [r] = await pool.query("INSERT INTO clientes (tenant_id, nombre, apellido, telefono, email, password_hash, email_verificado, google_sub) VALUES (?, 'Ana', 'Mora', '88881111', ?, ?, 1, ?)", [tenantId, email, hash, email]);
  return { id: r.insertId, email, token: await entrar(email) };
}
const alta = slug => ({ nombre: 'Taller de prueba', slug, tipos: ['moto'], provincia: 'Guanacaste', canton: 'Liberia', admin: { nombre: 'Admin', email: `${slug}@prueba.test`, password: clave } });

test.before(async () => {
  if (!url) return;
  ({ pool } = require('../src/db/pool'));
  await pool.nativo.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public');
  await require('../src/db/migrar').migrar({ log: () => {} });
  // Únicamente se sustituyen servicios externos; auth, routers y SQL son reales.
  const mailer = require('../src/services/mailer');
  for (const key of Object.keys(mailer)) if (key.startsWith('enviar')) mailer[key] = async () => {};
  const google = require('../src/utils/google-id');
  google.googleConfigurado = () => true;
  google.verificarIdToken = async email => ({ email, sub: email });
  const app = express();
  app.use(express.json());
  app.use('/api/auth', require('../src/routes/auth.routes'));
  app.use('/api/onboarding', require('../src/routes/onboarding.routes'));
  app.use('/api/usuarios', require('../src/routes/usuarios.routes'));
  app.use('/api/clientes', require('../src/routes/clientes.routes'));
  app.use('/api/portal', require('../src/routes/portal.routes'));
  app.get('/prueba/staff', require('../src/middleware/auth'), (_req, res) => res.json({ ok: true }));
  app.get('/prueba/cliente', require('../src/middleware/auth-cliente'), (_req, res) => res.json({ ok: true }));
  server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  base = `http://127.0.0.1:${server.address().port}`;
  const r = await pedir('POST', '/api/onboarding', alta('sesiones-t03'));
  assert.equal(r.status, 201, JSON.stringify(r.body));
  admin = r.body.data.token;
  tenantId = r.body.data.taller.id;
  const [[s]] = await pool.query('SELECT id FROM sucursales WHERE tenant_id = ? LIMIT 1', [tenantId]);
  sucursalId = s.id;
  const [rol] = await pool.query("INSERT INTO roles (tenant_id, nombre, clave, base, permisos, de_fabrica) VALUES (?, 'Recepción limitada', 'limitada', 'mostrador', '[]', 0)", [tenantId]);
  rolId = rol.insertId;
});
test.after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  if (pool) await pool.end();
});

for (const [campo, valor] of [['rol', () => 'tecnico'], ['rol_id', () => rolId], ['sucursal_id', () => sucursalId], ['permisos_web', () => ({ catalogo: true })]]) {
  t(`B-04: cambiar ${campo} revoca todas las sesiones inmediatamente`, async () => {
    const u = await empleado();
    const segunda = await entrar(u.email);
    assert.equal((await estadoStaff(u.token)).status, 200);
    const r = await pedir('PUT', `/api/usuarios/${u.id}`, { nombre: 'Empleado', email: u.email, rol: 'recepcion', [campo]: valor() }, admin);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal((await estadoStaff(u.token)).status, 401);
    assert.equal((await estadoStaff(segunda)).status, 401);
    assert.equal((await estadoStaff(await entrar(u.email))).status, 200);
  });
}
t('B-04: PATCH de sucursal revoca y una edición sin cambios conserva la sesión', async () => {
  const u = await empleado();
  let r = await pedir('PUT', `/api/usuarios/${u.id}`, { nombre: 'Otro nombre', email: u.email, rol: 'recepcion' }, admin);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal((await estadoStaff(u.token)).status, 200);
  r = await pedir('PATCH', `/api/usuarios/${u.id}/sucursal`, { sucursal_id: sucursalId }, admin);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal((await estadoStaff(u.token)).status, 401);
});
t('B-04: si no se pueden cerrar las sesiones, se revierte el cambio de permisos', async () => {
  const u = await empleado();
  await pool.nativo.query(`CREATE FUNCTION impedir_cierre_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fallo de prueba'; END $$;
    CREATE TRIGGER impedir_cierre_test BEFORE UPDATE ON sesiones_personal FOR EACH ROW EXECUTE FUNCTION impedir_cierre_test()`);
  try {
    const r = await pedir('PUT', `/api/usuarios/${u.id}`, { nombre: 'Empleado', email: u.email, rol: 'tecnico' }, admin);
    assert.equal(r.status, 500);
    const [[actual]] = await pool.query('SELECT rol FROM usuarios WHERE id = ?', [u.id]);
    assert.equal(actual.rol, 'recepcion');
    assert.equal((await estadoStaff(u.token)).status, 200);
  } finally {
    await pool.nativo.query('DROP TRIGGER impedir_cierre_test ON sesiones_personal; DROP FUNCTION impedir_cierre_test()');
  }
});
t('B-05: desactivar portal revoca el token y bloquea contraseña, OTP, Google y registro', async () => {
  const c = await cliente();
  assert.equal((await estadoCliente(c.token)).status, 200);
  assert.equal((await pedir('GET', `/api/clientes/${c.id}`, null, admin)).body.data.tiene_portal, 1);
  await pool.query("INSERT INTO login_codes (tenant_id, cliente_id, code_hash, expires_at) VALUES (?, ?, ?, NOW() + INTERVAL '10 minutes')", [tenantId, c.id, codigoHash]);
  const r = await pedir('PATCH', `/api/clientes/${c.id}/portal`, { activar: false }, admin);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal((await estadoCliente(c.token)).status, 401);
  for (const path of ['/api/auth/login', '/api/portal/login']) {
    assert.equal((await pedir('POST', path, { taller: 'sesiones-t03', email: c.email, password: clave })).status, 401);
  }
  const otp = await pedir('POST', '/api/portal/otp/verificar', { taller: 'sesiones-t03', email: c.email, codigo: '654321' });
  assert.equal(otp.status, 400);
  assert.equal(otp.body.data, undefined);
  const google = await pedir('POST', '/api/portal/google', { taller: 'sesiones-t03', credential: c.email });
  assert.equal(google.status, 401);
  const pase = jwt.sign({ tipo: 'google-alta', sub: c.email, email: c.email }, process.env.JWT_SECRET, { expiresIn: '15m' });
  const completar = await pedir('POST', '/api/portal/google/completar', { taller: 'sesiones-t03', pase_google: pase, nombre: 'Ana', apellido: 'Mora', telefono: '88881111', cedula: '112340567' });
  assert.equal(completar.status, 401);
  const registro = await pedir('POST', '/api/portal/registro', { taller: 'sesiones-t03', email: c.email, password: clave, nombre: 'Ana', apellido: 'Mora', telefono: '88881111', cedula: '112340567' });
  assert.equal(registro.status, 401);
  const solicitud = await pedir('POST', '/api/portal/otp/solicitar', { taller: 'sesiones-t03', email: c.email });
  assert.equal(solicitud.status, 200);
  const [[cuenta]] = await pool.query('SELECT count(*)::int AS n FROM login_codes WHERE cliente_id = ?', [c.id]);
  assert.equal(cuenta.n, 0, 'los códigos pendientes se borran y no se emite uno nuevo');
  const ficha = await pedir('GET', `/api/clientes/${c.id}`, null, admin);
  assert.equal(ficha.status, 200, JSON.stringify(ficha.body));
  assert.equal(ficha.body.data.tiene_portal, 0);
});
t('B-05: cambiar la clave o reactivar no revive tokens anteriores, aun del mismo segundo', async () => {
  const c = await cliente();
  const iat = Math.floor(Date.now() / 1000);
  const anterior = jwt.sign({ id: c.id, tipo: 'cliente', tenant_id: tenantId, iat }, process.env.JWT_SECRET);
  assert.equal((await estadoCliente(anterior)).status, 200);
  let r = await pedir('PATCH', `/api/clientes/${c.id}/portal`, { password: clave }, admin);
  assert.equal(r.status, 200);
  assert.equal((await estadoCliente(anterior)).status, 401);
  assert.equal((await estadoCliente(c.token)).status, 401);
  const nuevo = await entrar(c.email);
  assert.equal((await estadoCliente(nuevo)).status, 200);
  await pedir('PATCH', `/api/clientes/${c.id}/portal`, { activar: false }, admin);
  r = await pedir('PATCH', `/api/clientes/${c.id}/portal`, { password: clave }, admin);
  assert.equal(r.status, 200);
  assert.equal((await estadoCliente(nuevo)).status, 401);
  assert.equal((await estadoCliente(await entrar(c.email))).status, 200);
});
t('B-07: el alta tiene sid persistido, salir lo revoca y un token sin sid se rechaza', async () => {
  const r = await pedir('POST', '/api/onboarding', alta('alta-sid-t03'));
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const token = r.body.data.token;
  const payload = jwt.decode(token);
  assert.equal(typeof payload.sid, 'string');
  const [[s]] = await pool.query('SELECT usuario_id FROM sesiones_personal WHERE sid = ?', [payload.sid]);
  assert.equal(s.usuario_id, payload.id);
  assert.equal((await estadoStaff(token)).status, 200);
  assert.equal((await pedir('POST', '/api/auth/salir', {}, token)).status, 200);
  assert.equal((await estadoStaff(token)).status, 401);
  delete payload.sid;
  assert.equal((await estadoStaff(jwt.sign(payload, process.env.JWT_SECRET))).status, 401);
});
t('B-07/08: no se entrega token cuando falla la persistencia de la sesión de login', async () => {
  const u = await empleado();
  const original = pool.query;
  pool.query = async (sql, params) => {
    if (/INSERT INTO sesiones_personal/.test(sql)) throw new Error('fallo de prueba');
    return original(sql, params);
  };
  try {
    const r = await pedir('POST', '/api/auth/login', { email: u.email, password: clave });
    assert.equal(r.status, 503);
    assert.equal(r.body.data, undefined);
  } finally { pool.query = original; }
});
t('B-07: si falla la sesión del alta, tampoco queda el taller creado', async () => {
  const original = pool.getConnection;
  pool.getConnection = async () => {
    const conn = await original();
    const query = conn.query;
    conn.query = async (sql, params) => {
      if (/INSERT INTO sesiones_personal/.test(sql)) throw new Error('fallo de prueba');
      return query(sql, params);
    };
    return conn;
  };
  try {
    const r = await pedir('POST', '/api/onboarding', alta('alta-fallida-t03'));
    assert.equal(r.status, 503, JSON.stringify(r.body));
    assert.equal(r.body.data, undefined);
    const [rows] = await pool.query("SELECT id FROM tenants WHERE slug = 'alta-fallida-t03'");
    assert.equal(rows.length, 0);
  } finally { pool.getConnection = original; }
});
t('B-08: sin estado persistido, incluso una sesión recién validada responde 503', async () => {
  const u = await empleado();
  const c = await cliente();
  assert.equal((await estadoStaff(u.token)).status, 200);
  assert.equal((await estadoCliente(c.token)).status, 200);
  const original = pool.query;
  pool.query = async () => { throw new Error('fallo de conexión'); };
  try {
    assert.equal((await estadoStaff(u.token)).status, 503);
    assert.equal((await estadoCliente(c.token)).status, 503);
  } finally { pool.query = original; }
});
