// Evita el retroceso: los archivos de rutas ya migrados a multi-tenant no pueden
// volver a usar el pool crudo, y cada consulta suya tiene que filtrar por tenant.
// Sin esto, una consulta agregada más adelante con `pool.query` esquivaría el guard
// de tenant-db y filtraría datos de otros talleres sin fallar — que es justamente el
// modo de falla silenciosa que queremos evitar.
//
// A medida que se migren más archivos, se agregan acá.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { exigirScope } = require('../src/db/tenant-db');

const RUTAS = path.join(__dirname, '../src/routes');

const YA_MIGRADOS = [
  'clientes.routes.js',
  'motos.routes.js',
  'recepcion.routes.js',
  'portal.routes.js',
  'ordenes.routes.js',
  'mecanico.routes.js',
  'admin.routes.js',
  'usuarios.routes.js',
  'dashboard.routes.js',
  'mensajeria.routes.js',
  'garantias.routes.js',
  'citas.routes.js',
  'promos.routes.js',
  'metricas.routes.js',
];

// Extrae el SQL de cada llamada a req.db.query / conn.query. Solo mira literales
// (template, comilla simple o doble); el SQL armado por concatenación se revisa aparte.
function sqlDeArchivo(src) {
  const llamadas = src.match(/(?:req\.db|conn)\.(?:query|execute)\(\s*(?:`[^`]*`|'[^']*'|"[^"]*")/g) || [];
  return llamadas.map(l => l.replace(/^[\s\S]*?\.(?:query|execute)\(\s*/, ''));
}

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

// Usa el guard REAL (exigirScope), no una reimplementación: si las dos lógicas
// divergieran, el test aprobaría consultas que en runtime revientan, o al revés.
test('toda consulta de un archivo migrado filtra por tenant en cada tabla', () => {
  const fallos = [];
  for (const archivo of YA_MIGRADOS) {
    const src = fs.readFileSync(path.join(RUTAS, archivo), 'utf8');
    const consultas = sqlDeArchivo(src);
    assert.ok(consultas.length > 0, `${archivo}: no se detectaron consultas`);
    for (const sql of consultas) {
      // SQL con interpolación (`WHERE ${filtro}`): el filtro por tenant puede estar
      // dentro de la variable, y estáticamente no hay forma de saberlo. Estas quedan
      // cubiertas por el guard en runtime, que sí ve el SQL ya armado.
      if (/\$\{/.test(sql)) continue;
      try {
        exigirScope(sql);
      } catch (err) {
        fallos.push(`${archivo}: ${err.message.replace('tenant-db: ', '')}\n    -> ${sql.slice(1, 110).replace(/\s+/g, ' ')}`);
      }
    }
  }
  assert.deepStrictEqual(fallos, [], `\n${fallos.join('\n')}\n`);
});
