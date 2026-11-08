#!/usr/bin/env node
// Deja la base de desarrollo igual que la del resto del equipo. Un solo comando:
//
//   npm run db:importar
//
// Recrea el esquema `public` desde cero, aplica las migraciones de db/migraciones/,
// carga los dos talleres de prueba (db/datos-prueba.sql) y genera contraseñas nuevas
// para el personal, que imprime una sola vez (el repo no lleva ninguna que funcione:
// ver db/credenciales.js).
//
// BORRA TODO lo que haya en la base. Por eso se niega a correr contra un servidor que
// no sea local: el script anterior a este (migrate.js) borraba la base entera si
// alguien lo apuntaba a Railway siguiendo el README. Para una base remota de pruebas,
// y solo sabiendo lo que se hace: `npm run db:importar -- --remota`.
//
// Postgres local de desarrollo (Docker):
//   docker run -d --name motiq-pg -e POSTGRES_USER=motiq -e POSTGRES_PASSWORD=motiq_dev \
//     -e POSTGRES_DB=sasstaller -p 5432:5432 -v motiq-pg-data:/var/lib/postgresql/data postgres:16-alpine
const fs = require('fs');
const path = require('path');

const DATOS = path.join(__dirname, 'datos-prueba.sql');
const LOCALES = new Set(['localhost', '127.0.0.1', '::1', '']);

function hostDestino() {
  if (process.env.DATABASE_URL) {
    try { return new URL(process.env.DATABASE_URL).hostname; } catch { return '(DATABASE_URL inválida)'; }
  }
  return process.env.DB_HOST || 'localhost';
}

(async () => {
  // El pool lee backend/.env al cargarse; se requiere recién acá para poder dar antes
  // nuestro propio mensaje si algo falta.
  require('dotenv').config({ path: path.join(__dirname, '../.env') });
  const host = hostDestino();
  if (!LOCALES.has(host) && !process.argv.includes('--remota')) {
    console.error(`✖ La base apunta a "${host}", que no es local. Este script BORRA TODO lo que tiene.`);
    console.error('  Si de verdad es una base de pruebas: npm run db:importar -- --remota');
    process.exit(1);
  }
  if (!fs.existsSync(DATOS)) {
    console.error(`✖ Falta ${path.basename(DATOS)}. ¿Hiciste git pull?`);
    process.exit(1);
  }

  const { pool } = require('../src/db/pool');
  const { migrar } = require('../src/db/migrar');
  let base;
  try {
    ({ rows: [{ base }] } = await pool.nativo.query('SELECT current_database() AS base'));
  } catch (err) {
    console.error('✖ No se pudo conectar a Postgres:', err.code || err.message);
    console.error('  ¿Está corriendo? Revisá DB_HOST/DB_PORT/DB_USER/DB_PASSWORD en backend/.env');
    console.error('  (el comando del contenedor de desarrollo está al principio de este archivo).');
    process.exit(1);
  }

  try {
    console.log(`→ Recreando el esquema de "${base}" en ${host}…`);
    // Se recrea el esquema entero, no tabla por tabla: el resultado tiene que ser
    // idéntico para todos, no "lo del repo encima de lo que ya tenías".
    await pool.nativo.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');

    console.log('→ Aplicando migraciones…');
    await migrar({ log: (m) => console.log('  ' + m) });

    console.log('→ Cargando los datos de prueba…');
    await pool.nativo.query(fs.readFileSync(DATOS, 'utf8'));

    const { rows: [n] } = await pool.nativo.query(
      'SELECT (SELECT COUNT(*) FROM tenants) AS talleres, (SELECT COUNT(*) FROM usuarios) AS usuarios, (SELECT COUNT(*) FROM clientes) AS clientes'
    );
    console.log(`\n✔ Base "${base}" lista — ${n.talleres} talleres, ${n.usuarios} usuarios, ${n.clientes} clientes.`);

    await repartirPasswords(pool);

    console.log('\n  Para el backend/.env: copiá backend/.env.example y completá JWT_SECRET');
    console.log('  (cualquier texto largo sirve en desarrollo).');
  } catch (err) {
    console.error('✖ Falló la importación:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();

// El personal llega con la contraseña neutralizada (db/credenciales.js). Acá se le
// genera una nueva a cada uno y se imprime UNA vez: es la única forma de que el repo no
// cargue una credencial que funcione y que, aun así, después de importar se pueda
// entrar sin pedirle nada a nadie.
async function repartirPasswords(pool) {
  const bcrypt = require('bcrypt');
  const { SIN_PASSWORD } = require('./credenciales');
  const { generarPassword } = require('../src/utils/password');

  const [filas] = await pool.query(
    `SELECT u.id, u.email, u.rol, t.slug FROM usuarios u JOIN tenants t ON t.id = u.tenant_id
      WHERE u.password_hash = ? ORDER BY t.slug, u.id`,
    [SIN_PASSWORD]
  );
  if (!filas.length) return;

  console.log('\n  Cuentas de prueba (contraseñas generadas ahora, no vuelven a mostrarse):\n');
  for (const u of filas) {
    // 12 caracteres y no 20: estas se escriben a mano en un formulario de desarrollo
    // muchas veces al día. Las de plataforma, que abren los datos de todos los
    // talleres, siguen siendo de 20 (scripts/crear-admin-motiq).
    const password = generarPassword(12);
    await pool.query('UPDATE usuarios SET password_hash = ? WHERE id = ?', [await bcrypt.hash(password, 10), u.id]);
    console.log(`    ${u.slug.padEnd(11)} ${String(u.email).padEnd(26)} ${password}   (${u.rol})`);
  }
  console.log('\n  Si las perdés, volvé a correr `npm run db:importar`.');
  console.log('  Los clientes de prueba no tienen contraseña: entran con el código al correo.');
}
