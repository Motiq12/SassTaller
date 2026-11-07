#!/usr/bin/env node
// Pasa el guard REAL (db/tenant-db → exigirScope) sobre las consultas de un archivo
// de rutas y dice cuáles todavía no filtran por taller.
//
// Existe porque convertir a mano 460 consultas sin una lista es adivinar. El guard
// ya sabe exactamente cuál está mal y por qué: esto solo lo pregunta archivo por
// archivo y lo imprime, en vez de esperar a que reviente en un request.
//
//   node scripts/revisar-scope.js                       → todos los routers
//   node scripts/revisar-scope.js clientes.routes.js    → uno solo, con el SQL
//
// No modifica nada. El arreglo es a mano, porque dónde va el filtro en un JOIN de
// cuatro tablas no es mecánico y meterlo con una expresión regular es como se
// cuelan las fugas que todo esto busca evitar.
const fs = require('fs');
const path = require('path');
const { exigirScope } = require('../src/db/tenant-db');

const RUTAS = path.join(__dirname, '../src/routes');

// Mismo extractor que usa test/tenant-scope.test.js, para que las dos herramientas
// vean lo mismo y no haya un archivo que pase acá y falle en la prueba.
function sqlDeArchivo(src) {
  const llamadas = src.match(/(?:req\.db|conn)\.(?:query|execute)\(\s*(?:`[^`]*`|'[^']*'|"[^"]*")/g) || [];
  return llamadas.map((l) => l.replace(/^[\s\S]*?\.(?:query|execute)\(\s*/, '').slice(1, -1));
}

function revisar(archivo, detallado) {
  const src = fs.readFileSync(path.join(RUTAS, archivo), 'utf8');
  const crudas = (src.match(/pool\.(query|getConnection)/g) || []).length;
  const consultas = sqlDeArchivo(src);
  const malas = [];

  for (const sql of consultas) {
    try { exigirScope(sql); } catch (err) { malas.push({ sql, motivo: err.message }); }
  }

  const listo = crudas === 0 && malas.length === 0;
  const estado = listo ? 'LISTO' : `pool: ${crudas}  sin filtrar: ${malas.length}`;
  console.log(`${listo ? '  ok  ' : '  --  '} ${archivo.padEnd(26)} ${consultas.length} consultas  ${estado}`);

  if (detallado) {
    for (const m of malas) {
      const tablas = m.motivo.match(/toca ([^.]+) sin filtrar/);
      console.log(`\n      falta filtrar: ${tablas ? tablas[1] : '?'}`);
      console.log('      ' + m.sql.replace(/\s+/g, ' ').trim().slice(0, 150));
    }
  }
  return listo;
}

const pedido = process.argv[2];
const archivos = pedido ? [pedido] : fs.readdirSync(RUTAS).filter((f) => f.endsWith('.routes.js')).sort();

let listos = 0;
for (const a of archivos) if (revisar(a, Boolean(pedido))) listos++;
if (!pedido) console.log(`\n  ${listos}/${archivos.length} routers scopeados.`);
