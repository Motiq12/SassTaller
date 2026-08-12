// Evita el retroceso: los archivos de rutas ya migrados a multi-tenant no pueden
// volver a usar el pool crudo. Sin esto, una consulta agregada más adelante con
// `pool.query` esquivaría el guard de tenant-db y filtraría datos de otros talleres
// sin fallar — que es justamente el modo de falla silenciosa que queremos evitar.
//
// A medida que se migren más archivos, se agregan acá.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const RUTAS = path.join(__dirname, '../src/routes');

const YA_MIGRADOS = [
  'clientes.routes.js',
  'motos.routes.js',
];

test('los archivos migrados no usan el pool crudo', () => {
  for (const archivo of YA_MIGRADOS) {
    const src = fs.readFileSync(path.join(RUTAS, archivo), 'utf8');
    const crudas = src.match(/pool\.(query|getConnection)/g) || [];
    assert.deepStrictEqual(
      crudas, [],
      `${archivo} volvió a usar el pool crudo (${crudas.join(', ')}). Usá req.db.`
    );
    assert.ok(
      !/require\(['"]\.\.\/db\/pool['"]\)/.test(src),
      `${archivo} volvió a importar pool; el acceso debe ser solo por req.db.`
    );
  }
});

test('toda consulta a una tabla con tenant filtra por tenant_id', () => {
  const { TABLAS_CON_TENANT } = require('../src/db/tenant-db');
  for (const archivo of YA_MIGRADOS) {
    const src = fs.readFileSync(path.join(RUTAS, archivo), 'utf8');
    // Cada llamada a req.db.query / conn.query con su SQL en template o comillas.
    const llamadas = src.match(/(req\.db|conn)\.query\(\s*(`[^`]*`|'[^']*'|"[^"]*")/g) || [];
    assert.ok(llamadas.length > 0, `${archivo}: no se detectaron consultas`);
    for (const llamada of llamadas) {
      const sql = llamada.replace(/^.*?\.query\(\s*/s, '');
      const tablas = [...sql.matchAll(/\b(?:from|join|into|update)\s+`?([a-z_][a-z0-9_]*)`?/gi)]
        .map(m => m[1].toLowerCase())
        .filter(t => TABLAS_CON_TENANT.has(t));
      if (!tablas.length) continue;
      assert.ok(
        /tenant_id/i.test(sql),
        `${archivo}: consulta sobre ${tablas.join(', ')} sin tenant_id -> ${sql.slice(0, 100)}`
      );
    }
  }
});
