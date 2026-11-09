// Todo el SQL del backend, analizado por Postgres.
//
// Extrae del código cada string que es una sentencia SQL (SELECT/INSERT/UPDATE/DELETE/
// WITH) y le pide a Postgres que la prepare (PREPARE), exactamente como la mandaría
// db/pool.js. Postgres resuelve en ese paso las funciones, los tipos, el GROUP BY y los
// parámetros: un DATE_FORMAT, un IFNULL o un `$1` sin tipo deducible revientan acá,
// sin datos y sin tener que llegar a cada endpoint.
//
// Es la red de seguridad de la migración desde MySQL, y queda para que el próximo SQL
// con sintaxis de MySQL se vea en el PR y no en producción.
//
// No ve: el SQL armado con `${…}` (no se sabe qué va adentro hasta correr). Esas
// sentencias se cuentan y se listan aparte; las cubren los tests de endpoints.
//
// Corre solo con PG_TEST_URL (ver pg-adaptador.test.js); sin ella se saltea.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const URL_PRUEBA = process.env.PG_TEST_URL;
if (URL_PRUEBA && !/\/\w+_test(\?|$)/.test(URL_PRUEBA)) {
  throw new Error('PG_TEST_URL tiene que apuntar a una base cuyo nombre termine en _test');
}
if (URL_PRUEBA) process.env.DATABASE_URL = URL_PRUEBA;

const SRC = path.join(__dirname, '../src');
const ES_SQL = /^\s*(SELECT|INSERT|UPDATE|DELETE|WITH)\s/i;
// Estos dos hablan con el driver directo (no pasan por el adaptador), y sus strings
// 'INSERT'/'UPDATE' son nombres de comando, no sentencias.
const EXCLUIDOS = new Set(['db/pool.js', 'db/migrar.js']);

function archivosJs(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? archivosJs(p) : (e.name.endsWith('.js') ? [p] : []);
  });
}

// [{ archivo, linea, sql, interpolado }]
function sqlDelCodigo() {
  const acorn = require('acorn');
  const walk = require('acorn-walk');
  const encontrados = [];
  for (const archivo of archivosJs(SRC)) {
    if (EXCLUIDOS.has(path.relative(SRC, archivo).replace(/\\/g, '/'))) continue;
    const fuente = fs.readFileSync(archivo, 'utf8');
    const ast = acorn.parse(fuente, { ecmaVersion: 'latest', sourceType: 'script', locations: true, allowHashBang: true });
    const anotar = (nodo, sql, interpolado) => {
      if (ES_SQL.test(sql)) {
        encontrados.push({ archivo: path.relative(SRC, archivo).replace(/\\/g, '/'), linea: nodo.loc.start.line, sql, interpolado });
      }
    };
    walk.simple(ast, {
      Literal(n) { if (typeof n.value === 'string') anotar(n, n.value, false); },
      TemplateLiteral(n) {
        const texto = n.quasis.map(q => q.value.cooked).join('${…}');
        anotar(n, texto, n.expressions.length > 0);
      },
    });
  }
  return encontrados;
}

test('todo el SQL estático del backend es válido en Postgres', { skip: !URL_PRUEBA && 'sin PG_TEST_URL' }, async () => {
  const { pool, preparar } = require('../src/db/pool');
  const { migrar } = require('../src/db/migrar');
  await migrar({ log: () => {} });

  const todas = sqlDelCodigo();
  const estaticas = todas.filter(s => !s.interpolado);
  const fallos = [];
  const cliente = await pool.nativo.connect();
  try {
    for (const [i, s] of estaticas.entries()) {
      // @tenant lo expande tenant-db a un placeholder más; acá basta con eso.
      const { texto } = preparar(s.sql.replace(/@tenant/g, '?'));
      try {
        await cliente.query(`PREPARE chk_${i} AS ${texto}`);
        // MySQL no tiene booleanos: `(foto IS NOT NULL) AS tiene_foto` llegaba como 1/0 y
        // el frontend compara contra eso. En Postgres la misma expresión llega como
        // true/false, y nada lo avisa. Toda columna booleana en un resultado es un
        // cambio de comportamiento: se castea a ::int en el SQL.
        const { rows: [ps] } = await cliente.query(
          'SELECT result_types::text AS tipos FROM pg_prepared_statements WHERE name = $1', [`chk_${i}`]
        );
        await cliente.query(`DEALLOCATE chk_${i}`);
        if (/\bboolean\b/.test(ps?.tipos || '')) {
          throw new Error(`devuelve una columna boolean (en MySQL era 1/0): castear a ::int`);
        }
      } catch (e) {
        fallos.push(`${s.archivo}:${s.linea}  ${e.message}\n      ${s.sql.trim().replace(/\s+/g, ' ').slice(0, 140)}`);
      }
    }
  } finally {
    cliente.release();
    await pool.end();
  }

  if (process.env.SQL_REPORTE) {
    const inter = todas.filter(s => s.interpolado);
    console.log(`\nSQL estático: ${estaticas.length} · con \${…}: ${inter.length} · fallos: ${fallos.length}`);
    if (process.env.SQL_REPORTE === 'interpolado') inter.forEach(s => console.log(`  ${s.archivo}:${s.linea}`));
  }
  assert.deepStrictEqual(fallos, [], `\n${fallos.length} sentencias no son válidas en Postgres:\n${fallos.join('\n')}\n`);
});

module.exports = { sqlDelCodigo };
