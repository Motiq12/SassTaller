const { test } = require('node:test');
const assert = require('node:assert');
const jwt = require('jsonwebtoken');

// El middleware lee process.env.JWT_SECRET al verificar: lo fijamos antes de importarlo.
process.env.JWT_SECRET = 'test-secret';

// Base falsa para la revisión de la sesión (utils/sesiones.js): usuarios en memoria.
// Va en la caché de módulos antes de cargar el middleware, para no abrir conexión.
const usuarios = new Map();
const pool = {
  async query(sql, params) {
    if (/FROM sesiones_personal/.test(sql)) return [[{ id: 1, cerrada: null }]];
    if (/UPDATE sesiones_personal/.test(sql)) return [{ affectedRows: 1 }];
    if (/FROM usuarios WHERE id = \?/.test(sql)) return [[usuarios.get(params[0])].filter(Boolean)];
    throw new Error('Consulta no prevista en la prueba: ' + sql);
  },
};
require.cache[require.resolve('../src/db/pool')] = { id: 'pool', filename: 'pool', loaded: true, exports: { pool } };
for (const id of [5, 7]) usuarios.set(id, { activo: 1, sesiones_desde_ms: null });
const auth = require('../src/middleware/auth');

// res falso que captura status() y json().
function fakeRes() {
  return {
    _status: null, _body: null,
    status(c) { this._status = c; return this; },
    json(b) { this._body = b; return this; },
  };
}
function reqCon(token) {
  return { headers: token ? { authorization: `Bearer ${token}` } : {} };
}

test('rechaza (401) si falta el header Authorization', async () => {
  const res = fakeRes(); let llamado = false;
  await auth(reqCon(null), res, () => { llamado = true; });
  assert.equal(res._status, 401);
  assert.equal(llamado, false);
});

test('rechaza (401) un token inválido', async () => {
  const res = fakeRes(); let llamado = false;
  await auth(reqCon('no-es-un-jwt'), res, () => { llamado = true; });
  assert.equal(res._status, 401);
  assert.equal(llamado, false);
});

// Núcleo del fix CRÍTICO #1: un token del portal (tipo:'cliente') NO sirve en staff.
test('rechaza (403) un token de cliente del portal', async () => {
  const token = jwt.sign({ id: 9, tipo: 'cliente', nombre: 'Marco' }, process.env.JWT_SECRET);
  const res = fakeRes(); let llamado = false;
  await auth(reqCon(token), res, () => { llamado = true; });
  assert.equal(res._status, 403);
  assert.equal(llamado, false, 'no debe continuar a la ruta de staff');
});

test('rechaza (403) un token sin rol', async () => {
  const token = jwt.sign({ id: 1, nombre: 'X' }, process.env.JWT_SECRET);
  const res = fakeRes(); let llamado = false;
  await auth(reqCon(token), res, () => { llamado = true; });
  assert.equal(res._status, 403);
  assert.equal(llamado, false);
});

// 2FA: el token parcial (contraseña ok, falta el código) no es una sesión válida.
test('rechaza (403) un token parcial de 2FA aunque traiga rol', async () => {
  const token = jwt.sign({ id: 3, rol: 'admin', pend2fa: true }, process.env.JWT_SECRET);
  const res = fakeRes(); let llamado = false;
  await auth(reqCon(token), res, () => { llamado = true; });
  assert.equal(res._status, 403);
  assert.equal(llamado, false, 'un login a medias no debe abrir sesión');
});

test('acepta un token de staff y expone req.usuario', async () => {
  const token = jwt.sign({ id: 5, rol: 'recepcion', nombre: 'Ana', tenant_id: 1, sid: 'sesion-test' }, process.env.JWT_SECRET);
  const req = reqCon(token); const res = fakeRes(); let llamado = false;
  await auth(req, res, () => { llamado = true; });
  assert.equal(llamado, true);
  assert.equal(res._status, null, 'no debe responder error');
  assert.equal(req.usuario.rol, 'recepcion');
  assert.equal(req.usuario.id, 5);
});

// Rol `contenido` (solo administra el sitio web): lista blanca de rutas en el
// propio middleware, para que una ruta protegida solo con `auth` no le quede abierta.
function reqContenido(url) {
  const token = jwt.sign({ id: 7, nombre: 'Colaboradora', rol: 'contenido', tenant_id: 1, sid: 'sesion-test' }, process.env.JWT_SECRET);
  return { headers: { authorization: `Bearer ${token}` }, originalUrl: url };
}

test('contenido: pasa a la administración del sitio web y a su sesión', async () => {
  for (const url of ['/api/web/motos', '/api/web/resumen?x=1', '/api/auth/me', '/api/marca']) {
    const res = fakeRes(); let llamado = false;
    await auth(reqContenido(url), res, () => { llamado = true; });
    assert.equal(llamado, true, `debe pasar a ${url}`);
  }
});

test('contenido: no entra a nada del taller (403)', async () => {
  for (const url of ['/api/motos', '/api/clientes', '/api/ordenes/5', '/api/usuarios', '/api/webhooks', '/api/promos']) {
    const res = fakeRes(); let llamado = false;
    await auth(reqContenido(url), res, () => { llamado = true; });
    assert.equal(res._status, 403, `debe rechazar ${url}`);
    assert.equal(llamado, false);
  }
});

// ── Sesiones cerradas y personal desactivado (utils/sesiones.js) ──
const { cerrarSesiones } = require('../src/utils/sesiones');

test('una sesión cerrada por administración deja de valer aunque el token no venza', async () => {
  usuarios.set(20, { activo: 1, sesiones_desde_ms: null });
  const viejo = jwt.sign({ id: 20, rol: 'recepcion', tenant_id: 1, sid: 'sesion-test', iat: Math.floor(Date.now() / 1000) - 60 }, process.env.JWT_SECRET);
  let res = fakeRes(); let llamado = false;
  await auth(reqCon(viejo), res, () => { llamado = true; });
  assert.equal(llamado, true, 'antes de cerrar, pasa');

  // cerrarSesiones escribe en la base: acá se simula lo que dejaría.
  usuarios.set(20, { activo: 1, sesiones_desde_ms: Math.floor(Date.now() / 1000) * 1000 });
  require('../src/utils/sesiones').olvidar(20);
  res = fakeRes(); llamado = false;
  await auth(reqCon(viejo), res, () => { llamado = true; });
  assert.equal(res._status, 401);
  assert.equal(res._body.codigo, 'sesion_cerrada');
  assert.equal(llamado, false);

  // Volver a entrar da un token nuevo, que sí vale.
  const nuevo = jwt.sign({ id: 20, rol: 'recepcion', tenant_id: 1, sid: 'sesion-test' }, process.env.JWT_SECRET);
  res = fakeRes(); llamado = false;
  await auth(reqCon(nuevo), res, () => { llamado = true; });
  assert.equal(llamado, true);
});

test('un empleado desactivado o borrado no entra, aunque su token sea válido', async () => {
  usuarios.set(21, { activo: 0, sesiones_desde_ms: null });
  for (const id of [21, 999]) {
    const token = jwt.sign({ id, rol: 'tecnico', tenant_id: 1, sid: 'sesion-test' }, process.env.JWT_SECRET);
    const res = fakeRes(); let llamado = false;
    await auth(reqCon(token), res, () => { llamado = true; });
    assert.equal(res._status, 401, `id ${id}`);
    assert.equal(llamado, false);
  }
});

test('si la base no responde, devuelve 503 y no autoriza', async () => {
  const original = pool.query; const err = console.error;
  pool.query = async () => { throw new Error('ECONNREFUSED'); };
  console.error = () => {};
  try {
    const token = jwt.sign({ id: 22, rol: 'admin', tenant_id: 1, sid: 'sesion-test' }, process.env.JWT_SECRET);
    const res = fakeRes(); let llamado = false;
    await auth(reqCon(token), res, () => { llamado = true; });
    assert.equal(llamado, false);
    assert.equal(res._status, 503);
  } finally {
    pool.query = original; console.error = err;
  }
});

test('cerrarSesiones no hace nada con una lista vacía', async () => {
  assert.equal(await cerrarSesiones([]), 0);
});

// Los tokens anteriores a las sesiones persistidas deben volver a iniciar sesión.
test('rechaza 401 un token de personal sin sid', async () => {
  const token = jwt.sign({ id: 5, rol: 'admin', tenant_id: 1 }, process.env.JWT_SECRET);
  const res = fakeRes(); let llamado = false;
  await auth(reqCon(token), res, () => { llamado = true; });
  assert.equal(res._status, 401);
  assert.equal(llamado, false);
});

test('si falla solamente la consulta del sid, devuelve 503', async () => {
  const original = pool.query;
  pool.query = async (sql, params) => {
    if (/FROM sesiones_personal/.test(sql)) throw new Error('ECONNREFUSED');
    return original(sql, params);
  };
  try {
    const token = jwt.sign({ id: 5, rol: 'admin', tenant_id: 1, sid: 'caida-sid' }, process.env.JWT_SECRET);
    const res = fakeRes(); let llamado = false;
    await auth(reqCon(token), res, () => { llamado = true; });
    assert.equal(res._status, 503);
    assert.equal(llamado, false);
  } finally { pool.query = original; }
});
