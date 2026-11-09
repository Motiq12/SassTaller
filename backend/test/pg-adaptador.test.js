// El adaptador de db/pool.js contra un Postgres REAL.
//
// Los errores de la migración de MySQL a Postgres son de dialecto y de tipos: no se ven
// con una base falsa. Este archivo levanta el esquema base en una base de prueba y
// comprueba que el contrato de mysql2 que asumen las rutas se sigue cumpliendo.
//
// Corre solo si hay una base de prueba: PG_TEST_URL=postgres://…/motiq_test
// (en CI la pone el workflow; en local, ver .env.example). Sin ella se saltea.
const test = require('node:test');
const assert = require('node:assert');

const URL_PRUEBA = process.env.PG_TEST_URL;
const saltar = !URL_PRUEBA && 'sin PG_TEST_URL: no hay Postgres de prueba';

// El test borra y recrea el esquema entero. Que nunca pueda apuntar a una base real.
if (URL_PRUEBA && !/\/\w+_test(\?|$)/.test(URL_PRUEBA)) {
  throw new Error('PG_TEST_URL tiene que apuntar a una base cuyo nombre termine en _test');
}
if (URL_PRUEBA) process.env.DATABASE_URL = URL_PRUEBA;

let pool, migrar, paraTenant, verificarListaContraEsquema, aPlaceholdersPg, TABLAS_SIN_ID;

test.before(async () => {
  if (saltar) return;
  ({ pool, aPlaceholdersPg, TABLAS_SIN_ID } = require('../src/db/pool'));
  ({ migrar } = require('../src/db/migrar'));
  ({ paraTenant, verificarListaContraEsquema } = require('../src/db/tenant-db'));
  await pool.nativo.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrar({ log: () => {} });
  // Sin id explícito: así la identidad queda en 1 y 2, y el resto del archivo puede
  // asumir esos números sin dejar la secuencia desfasada.
  await pool.query("INSERT INTO tenants (nombre, slug, estado) VALUES ('Uno', 'uno', 'activo'), ('Dos', 'dos', 'activo')");
});
test.after(async () => { if (pool) await pool.end(); });

const t = (nombre, fn) => test(nombre, { skip: saltar }, fn);

// ── Traducción de placeholders (sin base) ─────────────────────────────────
test('`?` pasa a $n, pero no dentro de literales ni identificadores', () => {
  const { aPlaceholdersPg: f } = require('../src/db/pool');
  assert.deepStrictEqual(
    f("SELECT * FROM x WHERE a = ? AND b = '¿qué?' AND \"c?\" = ? AND d = 'it''s ?'"),
    { texto: "SELECT * FROM x WHERE a = $1 AND b = '¿qué?' AND \"c?\" = $2 AND d = 'it''s ?'", cantidad: 2 }
  );
});

// ── Esquema y migraciones ─────────────────────────────────────────────────
t('migrar es idempotente: la segunda vez no queda nada pendiente', async () => {
  assert.deepStrictEqual(await migrar({ log: () => {} }), []);
});

t('la lista de tablas con tenant_id coincide con el esquema real', async () => {
  assert.equal(await verificarListaContraEsquema(), true);
});

t('TABLAS_SIN_ID coincide con las tablas que de verdad no tienen columna id', async () => {
  const [filas] = await pool.query(`SELECT table_name AS t FROM information_schema.tables x
    WHERE table_schema = current_schema() AND table_name <> 'schema_migraciones'
      AND NOT EXISTS (SELECT 1 FROM information_schema.columns c
                      WHERE c.table_schema = x.table_schema AND c.table_name = x.table_name AND c.column_name = 'id')`);
  assert.deepStrictEqual(filas.map(f => f.t).sort(), [...TABLAS_SIN_ID].sort());
});

// ── Forma de los resultados (contrato de mysql2) ──────────────────────────
t('SELECT devuelve [filas] y COUNT(*) llega como número', async () => {
  const [filas] = await pool.query('SELECT COUNT(*) AS n FROM tenants WHERE estado = ?', ['activo']);
  assert.strictEqual(filas[0].n, 2);
});

t('INSERT devuelve insertId; en varias filas, el de la primera', async () => {
  const [r] = await pool.query("INSERT INTO clientes (tenant_id, nombre, apellido, telefono) VALUES (1, 'A', 'B', '1')");
  assert.ok(Number.isInteger(r.insertId) && r.insertId > 0);
  assert.strictEqual(r.affectedRows, 1);
  const [r2] = await pool.query("INSERT INTO clientes (tenant_id, nombre, apellido, telefono) VALUES (1, 'C', 'D', '2'), (1, 'E', 'F', '3')");
  assert.strictEqual(r2.insertId, r.insertId + 1);
  assert.strictEqual(r2.affectedRows, 2);
});

t('INSERT en una tabla sin id no rompe (no se le agrega RETURNING id)', async () => {
  const [r] = await pool.query("INSERT INTO planes_config (plan, precio_mensual) VALUES ('test_sin_id', 0)");
  assert.strictEqual(r.affectedRows, 1);
  assert.strictEqual(r.insertId, 0);
});

t('UPDATE devuelve affectedRows y un booleano se guarda como 1/0', async () => {
  const [r] = await pool.query('UPDATE clientes SET activo = ? WHERE tenant_id = ? AND nombre = ?', [false, 1, 'A']);
  assert.strictEqual(r.affectedRows, 1);
  const [[c]] = await pool.query("SELECT activo FROM clientes WHERE nombre = 'A'");
  assert.strictEqual(c.activo, 0);
});

t('un RETURNING escrito a mano devuelve las filas', async () => {
  const [filas] = await pool.query("UPDATE clientes SET apellido = 'Z' WHERE nombre = ? RETURNING id, apellido", ['C']);
  assert.strictEqual(filas[0].apellido, 'Z');
});

// ── Tipos ─────────────────────────────────────────────────────────────────
t('los correos se comparan sin distinguir mayúsculas, como en MySQL', async () => {
  await pool.query("INSERT INTO clientes (tenant_id, nombre, apellido, telefono, email) VALUES (1, 'M', 'M', '9', 'Lu@Example.com')");
  const [filas] = await pool.query('SELECT nombre FROM clientes WHERE email = ?', ['lu@example.COM']);
  assert.strictEqual(filas.length, 1);
});

t('NUMERIC queda como texto (igual que DECIMAL en mysql2) y jsonb llega como objeto', async () => {
  await pool.query("INSERT INTO configuracion (tenant_id, id, horarios) VALUES (1, 1, ?)", [JSON.stringify([{ dia: 1 }])]);
  const [[cfg]] = await pool.query('SELECT horarios FROM configuracion WHERE tenant_id = 1');
  assert.deepStrictEqual(cfg.horarios, [{ dia: 1 }]);
  const [[o]] = await pool.query('SELECT 12.50::numeric(10,2) AS m');
  assert.strictEqual(o.m, '12.50');
});

t('updated_at se actualiza solo al modificar la fila (reemplazo de ON UPDATE)', async () => {
  await pool.query("UPDATE clientes SET updated_at = '2000-01-01' WHERE nombre = 'E'");
  await pool.query("UPDATE clientes SET apellido = 'cambio' WHERE nombre = 'E'");
  const [[c]] = await pool.query("SELECT updated_at FROM clientes WHERE nombre = 'E'");
  assert.ok(c.updated_at.getFullYear() > 2000);
});

// ── Errores: el código de MySQL que espera utils/responder ────────────────
const codigo = async (sql, params) => {
  try { await pool.query(sql, params); } catch (e) { return e.code; }
  return 'sin error';
};

t('único duplicado → ER_DUP_ENTRY', async () => {
  assert.strictEqual(await codigo("INSERT INTO tenants (nombre, slug) VALUES ('X', 'uno')"), 'ER_DUP_ENTRY');
});

t('FK a una fila inexistente → ER_NO_REFERENCED_ROW_2; borrar algo referenciado → ER_ROW_IS_REFERENCED_2', async () => {
  assert.strictEqual(await codigo("INSERT INTO clientes (tenant_id, nombre, apellido, telefono) VALUES (999, 'a', 'b', 'c')"), 'ER_NO_REFERENCED_ROW_2');
  assert.strictEqual(await codigo('DELETE FROM tenants WHERE id = 1'), 'ER_ROW_IS_REFERENCED_2');
});

t('valor fuera del ENUM → WARN_DATA_TRUNCATED; texto largo → ER_DATA_TOO_LONG; falta obligatorio → ER_BAD_NULL_ERROR', async () => {
  assert.strictEqual(await codigo("INSERT INTO citas (tenant_id, cliente_id, fecha, hora, motivo, estado) SELECT 1, id, '2026-01-01', '09:00', 'x', 'inventado' FROM clientes LIMIT 1"), 'WARN_DATA_TRUNCATED');
  assert.strictEqual(await codigo('INSERT INTO clientes (tenant_id, nombre, apellido, telefono) VALUES (1, ?, ?, ?)', ['x'.repeat(200), 'b', 'c']), 'ER_DATA_TOO_LONG');
  assert.strictEqual(await codigo("INSERT INTO clientes (tenant_id, apellido, telefono) VALUES (1, 'b', 'c')"), 'ER_BAD_NULL_ERROR');
});

// ── Transacciones y aislamiento por taller ────────────────────────────────
t('una transacción con rollback no deja nada', async () => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query("INSERT INTO clientes (tenant_id, nombre, apellido, telefono) VALUES (1, 'Fantasma', 'x', 'x')");
    await conn.rollback();
  } finally { conn.release(); }
  const [[{ n }]] = await pool.query("SELECT COUNT(*) AS n FROM clientes WHERE nombre = 'Fantasma'");
  assert.strictEqual(n, 0);
});

t('req.db (tenant-db) sobre Postgres: @tenant acota y el guard sigue rechazando lo que no filtra', async () => {
  await pool.query("INSERT INTO clientes (tenant_id, nombre, apellido, telefono) VALUES (2, 'DelDos', 'x', 'x')");
  const db = paraTenant(1);
  const [filas] = await db.query('SELECT nombre FROM clientes WHERE tenant_id = @tenant AND nombre = ?', ['DelDos']);
  assert.strictEqual(filas.length, 0, 'el taller 1 vio un cliente del taller 2');
  await assert.rejects(db.query('SELECT nombre FROM clientes WHERE nombre = ?', ['DelDos']), /sin filtrar por tenant_id/);
  const conn = await db.conexion();
  try {
    const [[{ n }]] = await conn.query('SELECT COUNT(*) AS n FROM clientes WHERE tenant_id = @tenant');
    assert.ok(n >= 1);
  } finally { conn.release(); }
});
