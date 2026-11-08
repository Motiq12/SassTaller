// El cupo por franja aguanta reservas simultáneas (utils/cupos.js), contra Postgres real.
//
// Dos transacciones van por la ÚLTIMA plaza de la misma franja. Cada una cuenta, espera
// un momento —para que la otra cuente en el medio, que es justo la carrera— e inserta.
// Con el candado, la segunda cuenta después de que la primera confirmó: entra una sola.
// El control sin candado muestra que la espera de verdad produce la carrera; si no la
// produjera, el primer test pasaría aunque el candado no hiciera nada.
//
// Corre solo con PG_TEST_URL (ver pg-adaptador.test.js).
const test = require('node:test');
const assert = require('node:assert');

const URL_PRUEBA = process.env.PG_TEST_URL;
if (URL_PRUEBA && !/\/\w+_test(\?|$)/.test(URL_PRUEBA)) {
  throw new Error('PG_TEST_URL tiene que apuntar a una base cuyo nombre termine en _test');
}
if (URL_PRUEBA) process.env.DATABASE_URL = URL_PRUEBA;
const saltar = !URL_PRUEBA && 'sin PG_TEST_URL';

let pool, paraTenant, bloquearFranja, tenantId, clienteId, sucursalId;
const CUPO = 1;

test.before(async () => {
  if (saltar) return;
  ({ pool } = require('../src/db/pool'));
  ({ paraTenant } = require('../src/db/tenant-db'));
  ({ bloquearFranja } = require('../src/utils/cupos'));
  const { migrar } = require('../src/db/migrar');
  await migrar({ log: () => {} });
  const [t] = await pool.query("INSERT INTO tenants (nombre, slug) VALUES ('Cupos', ?)", [`cupos-${Date.now()}`]);
  tenantId = t.insertId;
  const [c] = await pool.query("INSERT INTO clientes (tenant_id, nombre, apellido, telefono) VALUES (?, 'C', 'C', '1')", [tenantId]);
  clienteId = c.insertId;
  const [s] = await pool.query("INSERT INTO sucursales (tenant_id, nombre) VALUES (?, 'Central')", [tenantId]);
  sucursalId = s.insertId;
});
test.after(async () => { if (pool) await pool.end(); });

// La reserva tal como la hace el portal, con una pausa entre contar e insertar.
async function reservar(fecha, { conCandado }) {
  const conn = await paraTenant(tenantId).conexion();
  try {
    await conn.beginTransaction();
    if (conCandado) await bloquearFranja(conn, sucursalId, fecha, '10:00');
    const [[{ n }]] = await conn.query(
      "SELECT COUNT(*) AS n FROM citas WHERE tenant_id = @tenant AND fecha = ? AND hora = '10:00' AND sucursal_id = ? AND estado <> 'cancelado'",
      [fecha, sucursalId]
    );
    if (n >= CUPO) { await conn.rollback(); return 'sin lugar'; }
    await conn.query('SELECT pg_sleep(0.3)');
    await conn.query(
      "INSERT INTO citas (tenant_id, cliente_id, sucursal_id, fecha, hora, motivo) VALUES (@tenant, ?, ?, ?, '10:00', 'x')",
      [clienteId, sucursalId, fecha]
    );
    await conn.commit();
    return 'reservó';
  } finally {
    conn.release();
  }
}
const enFranja = async (fecha) =>
  (await pool.query("SELECT COUNT(*) AS n FROM citas WHERE tenant_id = ? AND fecha = ? AND hora = '10:00'", [tenantId, fecha]))[0][0].n;

test('con el candado, dos reservas simultáneas por la última plaza: entra una sola', { skip: saltar }, async () => {
  const r = await Promise.all([reservar('2030-01-10', { conCandado: true }), reservar('2030-01-10', { conCandado: true })]);
  assert.deepStrictEqual(r.sort(), ['reservó', 'sin lugar']);
  assert.strictEqual(await enFranja('2030-01-10'), 1);
});

test('control: sin el candado, la misma carrera sobrevende la franja', { skip: saltar }, async () => {
  await Promise.all([reservar('2030-01-11', { conCandado: false }), reservar('2030-01-11', { conCandado: false })]);
  assert.strictEqual(await enFranja('2030-01-11'), 2, 'la prueba no produjo la carrera: el test de arriba no demostraría nada');
});

test('el candado es por franja: otra hora u otra fecha no espera', { skip: saltar }, async () => {
  const inicio = Date.now();
  await Promise.all([reservar('2030-01-12', { conCandado: true }), reservar('2030-01-13', { conCandado: true })]);
  // Si se esperaran entre sí tardarían 2 × 300 ms; en paralelo, ~300 ms.
  assert.ok(Date.now() - inicio < 550, `franjas distintas se bloquearon entre sí (${Date.now() - inicio} ms)`);
});
