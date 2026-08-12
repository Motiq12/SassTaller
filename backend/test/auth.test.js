const { test } = require('node:test');
const assert = require('node:assert');
const jwt = require('jsonwebtoken');

// El middleware lee process.env.JWT_SECRET al verificar: lo fijamos antes de importarlo.
process.env.JWT_SECRET = 'test-secret';
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

test('rechaza (401) si falta el header Authorization', () => {
  const res = fakeRes(); let llamado = false;
  auth(reqCon(null), res, () => { llamado = true; });
  assert.equal(res._status, 401);
  assert.equal(llamado, false);
});

test('rechaza (401) un token inválido', () => {
  const res = fakeRes(); let llamado = false;
  auth(reqCon('no-es-un-jwt'), res, () => { llamado = true; });
  assert.equal(res._status, 401);
  assert.equal(llamado, false);
});

// Núcleo del fix CRÍTICO #1: un token del portal (tipo:'cliente') NO sirve en staff.
test('rechaza (403) un token de cliente del portal', () => {
  const token = jwt.sign({ id: 9, tipo: 'cliente', nombre: 'Marco' }, process.env.JWT_SECRET);
  const res = fakeRes(); let llamado = false;
  auth(reqCon(token), res, () => { llamado = true; });
  assert.equal(res._status, 403);
  assert.equal(llamado, false, 'no debe continuar a la ruta de staff');
});

test('rechaza (403) un token sin rol', () => {
  const token = jwt.sign({ id: 1, nombre: 'X' }, process.env.JWT_SECRET);
  const res = fakeRes(); let llamado = false;
  auth(reqCon(token), res, () => { llamado = true; });
  assert.equal(res._status, 403);
  assert.equal(llamado, false);
});

// 2FA: el token parcial (contraseña ok, falta el código) no es una sesión válida.
test('rechaza (403) un token parcial de 2FA aunque traiga rol', () => {
  const token = jwt.sign({ id: 3, rol: 'admin', pend2fa: true }, process.env.JWT_SECRET);
  const res = fakeRes(); let llamado = false;
  auth(reqCon(token), res, () => { llamado = true; });
  assert.equal(res._status, 403);
  assert.equal(llamado, false, 'un login a medias no debe abrir sesión');
});

test('acepta un token de staff y expone req.usuario', () => {
  const token = jwt.sign({ id: 5, rol: 'recepcion', nombre: 'Ana', tenant_id: 1 }, process.env.JWT_SECRET);
  const req = reqCon(token); const res = fakeRes(); let llamado = false;
  auth(req, res, () => { llamado = true; });
  assert.equal(llamado, true);
  assert.equal(res._status, null, 'no debe responder error');
  assert.equal(req.usuario.rol, 'recepcion');
  assert.equal(req.usuario.id, 5);
});

// Multi-tenant: `auth` encadena el scope por taller, así que autenticar y quedar
// acotado a un taller son el mismo paso. Un token sin tenant_id es de antes de la
// migración (o manipulado) y no puede abrir sesión: sin taller no hay forma de
// filtrar, y dejarlo pasar significaría consultar sin scope.
test('rechaza (401) un token de staff sin tenant_id', () => {
  const token = jwt.sign({ id: 5, rol: 'recepcion', nombre: 'Ana' }, process.env.JWT_SECRET);
  const res = fakeRes(); let llamado = false;
  auth(reqCon(token), res, () => { llamado = true; });
  assert.equal(res._status, 401);
  assert.equal(llamado, false, 'sin taller no puede seguir a la ruta');
});

test('deja en req.db un acceso a datos ligado al taller del token', () => {
  const token = jwt.sign({ id: 5, rol: 'admin', tenant_id: 42 }, process.env.JWT_SECRET);
  const req = reqCon(token);
  auth(req, fakeRes(), () => {});
  assert.equal(req.tenantId, 42);
  assert.equal(req.db.tenantId, 42, 'req.db debe estar acotado al taller del token');
});
