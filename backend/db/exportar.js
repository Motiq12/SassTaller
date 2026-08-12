#!/usr/bin/env node
// Regenera db/sasstaller.sql desde la base local, para commitear el cambio.
//
//   npm run db:exportar
//
// ANTES DE CORRERLO: mirá qué hay en la base. Este archivo va al repo, y lo que se
// commitea queda en el historial de git para siempre aunque después lo borres. Hoy
// solo hay datos de prueba; el día que haya talleres reales usando el sistema, esto
// subiría nombres, teléfonos, cédulas y correos de sus clientes. Para ese caso está
// la opción --solo-estructura.
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const DESTINO = path.join(__dirname, 'sasstaller.sql');
const BASE = process.env.DB_NAME || 'sasstaller';
const USUARIO = process.env.DB_USER || 'root';
const CLAVE = process.env.DB_PASSWORD || '';
const HOST = process.env.DB_HOST || '127.0.0.1';
const PUERTO = process.env.DB_PORT || '3306';
const SOLO_ESTRUCTURA = process.argv.includes('--solo-estructura');

// Misma búsqueda que importar.js: mysqldump vive junto a mysql.
function buscarMysqldump() {
  if (process.env.MYSQLDUMP_BIN) return process.env.MYSQLDUMP_BIN;
  const candidatos = [];
  if (process.platform === 'win32') {
    for (const raiz of ['C:\\laragon\\bin\\mysql', 'C:\\xampp\\mysql']) {
      if (!fs.existsSync(raiz)) continue;
      const dentro = fs.statSync(raiz).isDirectory() ? fs.readdirSync(raiz) : [];
      for (const sub of [...dentro, '.']) {
        candidatos.push(path.join(raiz, sub, 'bin', 'mysqldump.exe'));
      }
    }
  }
  candidatos.push('mysqldump');
  for (const c of candidatos) {
    if (c === 'mysqldump') {
      if (spawnSync(c, ['--version'], { shell: true }).status === 0) return c;
    } else if (fs.existsSync(c)) {
      return c;
    }
  }
  return null;
}

const mysqldump = buscarMysqldump();
if (!mysqldump) {
  console.error('✖ No se encontró mysqldump. Forzá la ruta con MYSQLDUMP_BIN.');
  process.exit(1);
}

const args = [
  '-u', USUARIO, '-h', HOST, '-P', String(PUERTO), '--protocol=TCP',
  '--single-transaction', '--routines', '--add-drop-table', '--complete-insert',
  `--result-file=${DESTINO}`,
];
if (CLAVE) args.push(`-p${CLAVE}`);
if (SOLO_ESTRUCTURA) args.push('--no-data');
args.push(BASE);

console.log(`→ Exportando "${BASE}"${SOLO_ESTRUCTURA ? ' (solo estructura)' : ' con datos'}…`);
const r = spawnSync(mysqldump, args, { encoding: 'utf8' });
if (r.status !== 0) {
  console.error('✖ Falló la exportación:', String(r.stderr).trim());
  process.exit(1);
}

const kb = (fs.statSync(DESTINO).size / 1024).toFixed(1);
console.log(`✔ ${path.relative(process.cwd(), DESTINO)} — ${kb} KB`);
if (!SOLO_ESTRUCTURA) {
  console.log('\n  Revisá el diff antes de commitear: este archivo va al repo con los datos adentro.');
  console.log('  Si ya hay talleres reales usando el sistema, exportá con --solo-estructura.');
}
