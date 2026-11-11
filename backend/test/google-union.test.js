// Unir una cuenta del portal a Google no puede dejar activa una contraseña pendiente.
//
// Alguien que sabe el correo de un cliente puede registrarse con ese correo y SU
// contraseña: la cuenta queda sin verificar y no puede entrar. Si después el dueño real
// entra con Google y eso da la cuenta por verificada sin tocar la contraseña, la del
// otro pasa a servir. Corre solo con PG_TEST_URL (ver pg-adaptador.test.js).
const test = require('node:test');
const assert = require('node:assert');

const URL_PRUEBA = process.env.PG_TEST_URL;
const saltar = !URL_PRUEBA && 'sin PG_TEST_URL: no hay Postgres de prueba';
if (URL_PRUEBA && !/\/\w+_test(\?|$)/.test(URL_PRUEBA)) throw new Error('PG_TEST_URL tiene que apuntar a una base cuyo nombre termine en _test');
if (URL_PRUEBA) process.env.DATABASE_URL = URL_PRUEBA;
process.env.JWT_SECRET = process.env.JWT_SECRET || 'solo-para-esta-prueba';

let pool, paraTenant, unirConGoogle, tenantId;

test.before(async () => {
  if (saltar) return;
  ({ pool } = require('../src/db/pool'));
  ({ paraTenant } = require('../src/db/tenant-db'));
  ({ unirConGoogle } = require('../src/routes/portal.routes'));
  await pool.nativo.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await require('../src/db/migrar').migrar({ log: () => {} });
  const { rows } = await pool.nativo.query("INSERT INTO tenants (nombre, slug, plan, estado) VALUES ('Prueba', 'prueba-google', 'trial', 'activo') RETURNING id");
  tenantId = rows[0].id;
});

test.after(async () => { if (pool) await pool.end(); });

const alta = async (email, hash, verificado) => {
  const { rows } = await pool.nativo.query(
    "INSERT INTO clientes (tenant_id, nombre, apellido, telefono, email, password_hash, email_verificado) VALUES ($1, 'Ana', 'Mora', '88881111', $2, $3, $4) RETURNING *",
    [tenantId, email, hash, verificado]
  );
  return rows[0];
};
const leer = async (id) => (await pool.nativo.query('SELECT password_hash, email_verificado, google_sub FROM clientes WHERE id = $1', [id])).rows[0];

test('una contraseña pendiente (cuenta sin verificar) se borra al unir con Google', { skip: saltar }, async () => {
  const c = await alta('victima@prueba.test', 'hash-que-puso-otro', 0);
  await unirConGoogle(paraTenant(tenantId), c, 'sub-1');
  const d = await leer(c.id);
  assert.strictEqual(d.password_hash, null);
  assert.strictEqual(Number(d.email_verificado), 1);
  assert.strictEqual(d.google_sub, 'sub-1');
});

test('la contraseña de una cuenta ya verificada se conserva', { skip: saltar }, async () => {
  const c = await alta('duena@prueba.test', 'hash-propio', 1);
  await unirConGoogle(paraTenant(tenantId), c, 'sub-2');
  const d = await leer(c.id);
  assert.strictEqual(d.password_hash, 'hash-propio');
  assert.strictEqual(d.google_sub, 'sub-2');
});
