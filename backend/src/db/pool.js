// Acceso a Postgres con la MISMA forma que tenía mysql2.
//
// La migración de MySQL a Postgres no tocó las ~600 consultas de las rutas más que en
// el dialecto, porque este módulo conserva el contrato que todas asumen:
//
//   const [filas] = await pool.query('SELECT … WHERE id = ?', [id]);
//   const [r] = await pool.query('INSERT …', [...]);      r.insertId, r.affectedRows
//   const conn = await pool.getConnection();               beginTransaction/commit/rollback/release
//   err.code === 'ER_DUP_ENTRY'                            (los códigos de MySQL)
//
// Lo que hace por debajo, y por qué:
//   • `?` → `$1, $2…`, salteando literales. Postgres no entiende `?`.
//   • INSERT sin RETURNING → se le agrega `RETURNING id` para poder dar `insertId`
//     (Postgres no tiene LAST_INSERT_ID). Las tablas sin columna id quedan afuera.
//   • Booleanos → 1/0: las columnas de flags son smallint, como el tinyint(1) de antes,
//     y mysql2 convertía true en 1 solo.
//   • Errores de Postgres → código de MySQL equivalente, para que utils/responder siga
//     devolviendo 400 a un dato inválido en vez de 500.
//   • COUNT(*) llega como número (bigint en Postgres; pg lo daría como texto).
//     NUMERIC queda como texto, igual que DECIMAL en mysql2.
//
// El aislamiento por taller NO vive acá: lo pone db/tenant-db.js encima de este pool.
const { Pool, types } = require('pg');
require('dotenv').config();

// bigint (OID 20): COUNT(*), SUM de enteros, totp_ultimo_contador. Todos muy por debajo
// de 2^53, así que número es seguro y evita que `count === 0` o `n >= limite` comparen
// contra un texto.
types.setTypeParser(20, (v) => (v === null ? null : Number(v)));

// Presupuesto TOTAL de conexiones, repartido entre los workers. Cada proceso abre su
// propio pool, así que sin dividir, 4 workers × 10 abrirían 40 y el número real se
// escaparía sin que nadie lo note (Postgres corta en max_connections, que en Railway
// es 100, y las peticiones empiezan a fallar con un error que no dice nada de esto).
const TOTAL_CONEXIONES = Number(process.env.DB_POOL_TOTAL) || 40;
const WORKERS = Math.max(1, Number(process.env.WEB_CONCURRENCY) || 1);
const POR_PROCESO = Math.max(4, Math.floor(TOTAL_CONEXIONES / WORKERS));

function buildConfig() {
  const comun = {
    max: POR_PROCESO,
    // Todo en UTC, como el volcado original y como corría MySQL en Railway: CURRENT_DATE
    // y NOW() dan lo mismo en cualquier máquina. La hora del taller la aplica el código
    // con su offset (configuracion.zona_horaria_offset), no la sesión de la base.
    options: '-c TimeZone=UTC',
  };
  // Railway inyecta DATABASE_URL en el servicio que referencia a su Postgres.
  if (process.env.DATABASE_URL) {
    return { ...comun, connectionString: process.env.DATABASE_URL };
  }
  return {
    ...comun,
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 5432,
    user: process.env.DB_USER || 'motiq',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'sasstaller',
  };
}

// Tablas sin columna `id`: en ellas un INSERT no puede llevar `RETURNING id`.
// test/pg-adaptador.test.js compara esta lista contra el esquema real.
const TABLAS_SIN_ID = new Set(['mensaje_lecturas', 'motiq_seguidos', 'orden_contadores', 'planes_config']);

// `?` → `$n` fuera de literales y de identificadores entre comillas. Una comilla
// doblada ('') cierra y reabre el literal, así que el recorrido simple la respeta.
function aPlaceholdersPg(sql) {
  let salida = '';
  let n = 0;
  let comilla = null;
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    if (comilla) {
      salida += c;
      if (c === comilla) comilla = null;
      continue;
    }
    if (c === "'" || c === '"') { comilla = c; salida += c; continue; }
    if (c === '?') { salida += `$${++n}`; continue; }
    salida += c;
  }
  return { texto: salida, cantidad: n };
}

function preparar(sql) {
  const { texto, cantidad } = aPlaceholdersPg(sql);
  const insert = texto.match(/^\s*INSERT\s+INTO\s+"?(\w+)"?/i);
  const conRetorno = /\bRETURNING\b/i.test(texto);
  const agregaId = insert && !conRetorno && !TABLAS_SIN_ID.has(insert[1].toLowerCase());
  return {
    texto: agregaId ? `${texto.replace(/;\s*$/, '')} RETURNING id` : texto,
    cantidad,
    retornoPropio: conRetorno,
  };
}

function normalizar(v) {
  if (v === undefined) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  return v;
}

// Resultado de pg → la forma de mysql2.
function aFormaMysql(r, retornoPropio) {
  const escritura = r.command === 'INSERT' || r.command === 'UPDATE' || r.command === 'DELETE';
  if (!escritura || retornoPropio) return [r.rows, r.fields];
  return [{
    insertId: r.command === 'INSERT' ? (r.rows[0]?.id ?? 0) : 0,
    affectedRows: r.rowCount ?? 0,
    changedRows: r.rowCount ?? 0,
    warningStatus: 0,
  }, undefined];
}

// SQLSTATE de Postgres → el código de mysql2 que ya maneja el resto del sistema.
function codigoMysql(e) {
  switch (e.code) {
    case '23505': return 'ER_DUP_ENTRY';
    case '23502': return 'ER_BAD_NULL_ERROR';
    case '22001': return 'ER_DATA_TOO_LONG';
    case '23514': return 'WARN_DATA_TRUNCATED';            // CHECK: valor fuera del ENUM o largo
    case '22P02': case '22007': case '22008': case '22003':
      return 'ER_TRUNCATED_WRONG_VALUE';                    // número/fecha con formato inválido
    case '23503':
      // La misma violación de FK cubre los dos sentidos; el mensaje dice cuál es.
      return /still referenced/i.test(e.detail || e.message) ? 'ER_ROW_IS_REFERENCED_2' : 'ER_NO_REFERENCED_ROW_2';
    default: return null;
  }
}

function traducirError(e, sql) {
  const mysql = codigoMysql(e);
  if (mysql) {
    e.sqlState = e.code;
    e.code = mysql;
  }
  e.sqlMessage = e.message;
  e.sql = sql;
  return e;
}

async function ejecutar(cliente, sql, params = []) {
  const p = preparar(sql);
  const valores = (Array.isArray(params) ? params : [params]).map(normalizar);
  if (valores.length !== p.cantidad) {
    throw new Error(`pool: la consulta tiene ${p.cantidad} placeholders y recibió ${valores.length} parámetros`);
  }
  try {
    return aFormaMysql(await cliente.query(p.texto, valores), p.retornoPropio);
  } catch (e) {
    throw traducirError(e, p.texto);
  }
}

const pg = new Pool(buildConfig());
// Una conexión ociosa que se cae (reinicio de la base, red) emite 'error' en el pool:
// sin este listener, ese evento tumba el proceso entero.
pg.on('error', (err) => console.error('Postgres: conexión ociosa perdida:', err.message));

const pool = {
  query: (sql, params) => ejecutar(pg, sql, params),
  execute: (sql, params) => ejecutar(pg, sql, params),
  async getConnection() {
    const cliente = await pg.connect();
    // Soltarla dos veces no es un error: mysql2 lo toleraba y varias rutas sueltan la
    // conexión antes de un return y otra vez en el finally. pg lanza una excepción, que
    // convertía una respuesta 404 ya enviada en un fallo del servidor.
    let suelta = false;
    return {
      query: (sql, params) => ejecutar(cliente, sql, params),
      execute: (sql, params) => ejecutar(cliente, sql, params),
      beginTransaction: () => cliente.query('BEGIN'),
      commit: () => cliente.query('COMMIT'),
      rollback: () => cliente.query('ROLLBACK'),
      ping: () => cliente.query('SELECT 1'),
      release: () => {
        if (suelta) return;
        suelta = true;
        cliente.release();
      },
    };
  },
  end: () => pg.end(),
  // Para lo que no tiene equivalente en la interfaz de mysql2 (migraciones, LISTEN…).
  nativo: pg,
};

async function testConnection() {
  try {
    const { rows } = await pg.query('SELECT current_database() AS db, version() AS v');
    console.log(`✅ Postgres conectado: ${rows[0].db} (${String(rows[0].v).split(' ').slice(0, 2).join(' ')})`);
  } catch (err) {
    console.error('❌ No se pudo conectar a Postgres:', err.code || err.message);
  }
}

module.exports = { pool, testConnection, aPlaceholdersPg, preparar, TABLAS_SIN_ID };
