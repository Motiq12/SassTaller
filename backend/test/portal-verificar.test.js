const { test } = require('node:test');
const assert = require('node:assert');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');

// POST /api/portal/registro/verificar abre una sesión de cliente, así que solo
// puede hacerlo quien trae el código que se mandó a ese correo. Estas pruebas
// cubren el caso que se había escapado: una cuenta YA verificada recibía la
// sesión con cualquier código, o sea que alcanzaba con saber el correo.

process.env.JWT_SECRET = 'test-secret';

// Base falsa. La ruta usa req.db (acotado al taller por middleware/tenant), así que
// se le pasa esto como req.db además de dejarlo en la caché de módulos.
// Se pone en la caché de módulos antes de cargar las rutas, para que ninguna
// abra una conexión de verdad.
const db = { clientes: [], codigos: [] };
const pool = {
  async query(sql, params = []) {
    // Los patrones no dependen del orden de las condiciones: el filtro por taller
    // que agrega req.db puede caer antes o después del resto del WHERE.
    if (/FROM clientes WHERE .*email = \?/.test(sql)) {
      return [db.clientes.filter((c) => c.email === params[0] && c.activo)];
    }
    if (/FROM email_verify_codes/.test(sql)) {
      const vigentes = db.codigos.filter((c) => c.cliente_id === params[0] && c.proposito === 'registro' && !c.used && !c.vencido);
      return [vigentes.slice(-1)];
    }
    if (/UPDATE email_verify_codes SET attempts/.test(sql)) {
      db.codigos.find((c) => c.id === params[0]).attempts += 1;
      return [{ affectedRows: 1 }];
    }
    if (/UPDATE email_verify_codes SET used = 1 WHERE id = \?/.test(sql)) {
      db.codigos.find((c) => c.id === params[0]).used = 1;
      return [{ affectedRows: 1 }];
    }
    if (/UPDATE clientes SET email_verificado = 1/.test(sql)) {
      db.clientes.find((c) => c.id === params[0]).email_verificado = 1;
      return [{ affectedRows: 1 }];
    }
    throw new Error('Consulta no prevista en la prueba: ' + sql);
  },
};
const rutaPool = require.resolve('../src/db/pool');
require.cache[rutaPool] = { id: rutaPool, filename: rutaPool, loaded: true, exports: { pool } };

const router = require('../src/routes/portal.routes');
const capa = router.stack.find((l) => l.route && l.route.path === '/registro/verificar' && l.route.methods.post);
const verificar = capa.route.stack[capa.route.stack.length - 1].handle;

function fakeRes() {
  return {
    _status: 200, _body: null,
    status(c) { this._status = c; return this; },
    json(b) { this._body = b; return this; },
  };
}
async function pedir(email, codigo) {
  const res = fakeRes();
  await verificar({ body: { email, codigo }, db: pool, tenantId: 1 }, res);
  return res;
}

// Cada prueba usa su propio correo: el tope de intentos es por correo y vive en memoria.
let serie = 0;
async function cliente({ verificado, codigo, vencido = false }) {
  const id = ++serie;
  const c = { id, nombre: 'Ana', apellido: 'Mora', email: `cliente${id}@prueba.test`, email_verificado: verificado ? 1 : 0, activo: 1 };
  db.clientes.push(c);
  if (codigo) {
    db.codigos.push({ id: 100 + id, cliente_id: id, proposito: 'registro', code_hash: await bcrypt.hash(codigo, 4), attempts: 0, used: 0, vencido });
  }
  return c;
}
const sinSesion = (res) => assert.equal(res._body && res._body.data, undefined, 'no debe devolver ninguna sesión');

test('una cuenta ya verificada NO recibe sesión con un código cualquiera', async () => {
  const c = await cliente({ verificado: true });
  const res = await pedir(c.email, '000000');
  assert.equal(res._status, 400);
  assert.equal(res._body.error, 'Código inválido o expirado');
  sinSesion(res);
});

test('una cuenta ya verificada tampoco entra con un código que ya se usó', async () => {
  const c = await cliente({ verificado: true, codigo: '123456' });
  db.codigos.find((k) => k.cliente_id === c.id).used = 1;
  const res = await pedir(c.email, '123456');
  assert.equal(res._status, 400);
  sinSesion(res);
});

test('el código correcto verifica la cuenta y abre la sesión del cliente', async () => {
  const c = await cliente({ verificado: false, codigo: '654321' });
  const res = await pedir(c.email, '654321');
  assert.equal(res._status, 200);
  const payload = jwt.verify(res._body.data.token, process.env.JWT_SECRET);
  assert.equal(payload.tipo, 'cliente');
  assert.equal(payload.id, c.id);
  assert.equal(c.email_verificado, 1);
  assert.equal(db.codigos.find((k) => k.cliente_id === c.id).used, 1, 'el código queda gastado');
});

test('el mismo código no sirve una segunda vez', async () => {
  const c = await cliente({ verificado: false, codigo: '222333' });
  assert.equal((await pedir(c.email, '222333'))._status, 200);
  const res = await pedir(c.email, '222333');
  assert.equal(res._status, 400);
  sinSesion(res);
});

test('un código incorrecto no abre sesión y cuenta como intento', async () => {
  const c = await cliente({ verificado: false, codigo: '111222' });
  const res = await pedir(c.email, '999999');
  assert.equal(res._status, 400);
  sinSesion(res);
  assert.equal(c.email_verificado, 0);
  assert.equal(db.codigos.find((k) => k.cliente_id === c.id).attempts, 1);
});

test('un código vencido no abre sesión', async () => {
  const c = await cliente({ verificado: false, codigo: '444555', vencido: true });
  const res = await pedir(c.email, '444555');
  assert.equal(res._status, 400);
  sinSesion(res);
});

test('un correo que no existe recibe el mismo error que un código malo', async () => {
  const res = await pedir('nadie@prueba.test', '123456');
  assert.equal(res._status, 400);
  assert.equal(res._body.error, 'Código inválido o expirado');
  sinSesion(res);
});
