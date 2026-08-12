#!/usr/bin/env node
// Importa la base del repo en la MySQL local. Un solo comando:
//
//   npm run db:importar
//
// Existe para que levantar el proyecto no dependa de que alguien te pase un
// archivo por chat ni de recordar una secuencia de pasos. Clonás, corrés esto, y
// tenés la base igual que el resto del equipo.
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const DUMP = path.join(__dirname, 'sasstaller.sql');
const BASE = process.env.DB_NAME || 'sasstaller';
const USUARIO = process.env.DB_USER || 'root';
const CLAVE = process.env.DB_PASSWORD || '';
const HOST = process.env.DB_HOST || '127.0.0.1';
const PUERTO = process.env.DB_PORT || '3306';

// mysql.exe no suele estar en el PATH en Windows con Laragon o XAMPP, y pedirle a
// cada quien que lo agregue es una fricción evitable. Se buscan las rutas típicas
// antes de rendirse; MYSQL_BIN permite forzarla si está en otro lado.
function buscarMysql() {
  if (process.env.MYSQL_BIN) return process.env.MYSQL_BIN;

  const candidatos = [];
  if (process.platform === 'win32') {
    for (const raiz of ['C:\\laragon\\bin\\mysql', 'C:\\xampp\\mysql']) {
      if (!fs.existsSync(raiz)) continue;
      // Laragon guarda una carpeta por versión (mysql-8.4.3-winx64, etc.).
      const dentro = fs.statSync(raiz).isDirectory() ? fs.readdirSync(raiz) : [];
      for (const sub of [...dentro, '.']) {
        candidatos.push(path.join(raiz, sub, 'bin', 'mysql.exe'));
      }
    }
  }
  candidatos.push('mysql');   // Linux/macOS, o Windows con el PATH configurado

  for (const c of candidatos) {
    if (c === 'mysql') {
      const r = spawnSync(c, ['--version'], { shell: true });
      if (r.status === 0) return c;
    } else if (fs.existsSync(c)) {
      return c;
    }
  }
  return null;
}

function correr(mysql, args, entrada) {
  const base = ['-u', USUARIO, '-h', HOST, '-P', String(PUERTO), '--protocol=TCP'];
  if (CLAVE) base.push(`-p${CLAVE}`);
  return spawnSync(mysql, [...base, ...args], {
    input: entrada,
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,   // el volcado entra entero por stdin
  });
}

const mysql = buscarMysql();
if (!mysql) {
  console.error('✖ No se encontró mysql. Si lo tenés en otra ruta:');
  console.error('    MYSQL_BIN="C:\\ruta\\a\\mysql.exe" npm run db:importar');
  process.exit(1);
}
if (!fs.existsSync(DUMP)) {
  console.error(`✖ Falta ${path.basename(DUMP)}. ¿Hiciste git pull?`);
  process.exit(1);
}

const ping = correr(mysql, ['-e', 'SELECT 1']);
if (ping.status !== 0) {
  console.error('✖ No se pudo conectar a MySQL. ¿Está corriendo? (en Laragon: Start All)');
  console.error(String(ping.stderr || '').trim().split('\n')[0]);
  process.exit(1);
}

// El volcado trae DROP TABLE por tabla, así que reimportar sobre una base existente
// la deja igual que la del repo. Lo que NO borra son las tablas que ya no existen en
// el volcado, por eso se recrea la base entera: el resultado tiene que ser idéntico
// para todos, no "lo del repo encima de lo que ya tenías".
console.log(`→ Recreando la base "${BASE}"…`);
const recrear = correr(mysql, ['-e',
  `DROP DATABASE IF EXISTS \`${BASE}\`; CREATE DATABASE \`${BASE}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`]);
if (recrear.status !== 0) {
  console.error('✖ No se pudo recrear la base:', String(recrear.stderr).trim());
  process.exit(1);
}

console.log('→ Importando…');
const importar = correr(mysql, [BASE], fs.readFileSync(DUMP, 'utf8'));
if (importar.status !== 0) {
  console.error('✖ Falló la importación:', String(importar.stderr).trim());
  process.exit(1);
}

const conteo = correr(mysql, ['-N', '-B', BASE, '-e',
  'SELECT (SELECT COUNT(*) FROM tenants), (SELECT COUNT(*) FROM usuarios), (SELECT COUNT(*) FROM clientes)']);
const [talleres, usuarios, clientes] = String(conteo.stdout).trim().split(/\s+/);

console.log(`\n✔ Base "${BASE}" lista — ${talleres} talleres, ${usuarios} usuarios, ${clientes} clientes.`);
console.log('\n  Falta el archivo backend/.env (no está en el repo: lleva secretos).');
console.log('  Copiá backend/.env.example a backend/.env y pedile las claves a quien te pasó el proyecto.');
