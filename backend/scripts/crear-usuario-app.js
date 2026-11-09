#!/usr/bin/env node
// Crea (o rota) el rol de Postgres con el que se conecta la aplicación.
//
// El usuario que trae el Postgres de Railway es SUPERUSUARIO. Si la app se conecta con
// él y algún día se cuela una inyección SQL, el atacante no solo lee y borra todo:
// en Postgres un superusuario ejecuta comandos en el servidor
// (`COPY … TO PROGRAM 'cualquier cosa'`). Este script crea un rol que solo puede
// leer y escribir FILAS de la base de la app — y lo comprueba intentando lo que no
// debería poder.
//
//   node scripts/crear-usuario-app.js            (lee las URLs del CLI de Railway)
//   node scripts/crear-usuario-app.js "postgres://dueño:clave@host:puerto/base"
//
// Dos roles, a propósito:
//   • motiq_app (este): SELECT/INSERT/UPDATE/DELETE y usar las secuencias. Nada de
//     CREATE/ALTER/DROP: no es dueño de nada.
//   • el dueño (el usuario de Railway): solo para las migraciones, que la app corre
//     al arrancar con MIGRACION_DATABASE_URL (ver src/db/migrar.js).
// Con ALTER DEFAULT PRIVILEGES las tablas que creen las migraciones futuras le llegan
// a motiq_app solas, sin volver a correr esto.
//
// No cambia nada en Railway. Al terminar deja las dos variables en un archivo local
// (ignorado por git) para pegarlas en el servicio del backend. Si algo sale mal, el
// usuario dueño sigue funcionando igual: esto no lo toca.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const { varRailway } = require('./railway-var');

const ROL = 'motiq_app';
const SALIDA = path.join(__dirname, '..', 'backups', 'nuevo-database-url.txt');

// ¿Falla por falta de permisos? Es lo que queremos comprobar.
async function debeFallar(c, sql, descripcion) {
  try {
    await c.query(sql);
    return `❌ ${descripcion}: NO fue bloqueado (el rol tiene más permisos de los esperados)`;
  } catch (e) {
    return /permission denied|must be (owner|superuser)|insufficient_privilege|only superusers/i.test(e.message)
      ? `   ✔ ${descripcion}: bloqueado`
      : `⚠️  ${descripcion}: falló con un error distinto → ${e.message}`;
  }
}

(async () => {
  console.log('🔎 Leyendo la configuración …');
  const publica = process.argv[2] || process.env.DATABASE_PUBLIC_URL || varRailway('Postgres', 'DATABASE_PUBLIC_URL');
  // La interna (postgres.railway.internal) es la que usa el backend desde dentro de
  // Railway; sin CLI, se asume la misma que se pasó.
  const interna = (!process.argv[2] && varRailway('Postgres', 'DATABASE_URL')) || publica;
  if (!publica) {
    console.error('❌ No se pudo obtener la URL de la base.');
    console.error('   Pasala como argumento: node scripts/crear-usuario-app.js "postgres://…"');
    process.exit(1);
  }

  const dueno = new Client({ connectionString: publica });
  await dueno.connect();
  const { rows: [yo] } = await dueno.query('SELECT current_user AS u, current_database() AS db');
  console.log(`✅ Conectado como ${yo.u} a ${new URL(publica).hostname}/${yo.db}`);

  const clave = crypto.randomBytes(24).toString('base64url');   // 32 caracteres, seguros para URL
  const id = (s) => `"${String(s).replace(/"/g, '""')}"`;
  // CREATE la primera vez, ALTER para rotar la clave. La clave va como literal porque
  // CREATE/ALTER ROLE no aceptan parámetros; es base64url, sin comillas posibles.
  const { rows: [existe] } = await dueno.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [ROL]);
  await dueno.query(`${existe ? 'ALTER' : 'CREATE'} ROLE ${ROL} WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${clave}'`);
  await dueno.query(`
    REVOKE ALL ON DATABASE ${id(yo.db)} FROM PUBLIC;
    GRANT CONNECT ON DATABASE ${id(yo.db)} TO ${ROL};
    -- Antes de Postgres 15 cualquiera podía crear tablas en public: se cierra explícito.
    REVOKE CREATE ON SCHEMA public FROM PUBLIC;
    GRANT USAGE ON SCHEMA public TO ${ROL};
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${ROL};
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${ROL};
    ALTER DEFAULT PRIVILEGES FOR ROLE ${id(yo.u)} IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${ROL};
    ALTER DEFAULT PRIVILEGES FOR ROLE ${id(yo.u)} IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ${ROL};
  `);
  console.log(`✅ Rol '${ROL}' listo: lee y escribe filas de "${yo.db}", nada más`);
  await dueno.end();

  // ── Comprobación real: conectarse COMO la app y probar qué puede y qué no.
  console.log('\n🧪 Probando el rol nuevo …');
  const urlApp = new URL(publica);
  urlApp.username = ROL;
  urlApp.password = clave;
  const app = new Client({ connectionString: urlApp.toString() });
  await app.connect();

  const { rows: [{ n }] } = await app.query('SELECT COUNT(*)::int AS n FROM usuarios');
  console.log(`   ✔ Puede leer la base (usuarios: ${n})`);
  await app.query('BEGIN');
  await app.query("UPDATE tenants SET nombre = nombre WHERE id = (SELECT MIN(id) FROM tenants)");
  await app.query('ROLLBACK');
  console.log('   ✔ Puede escribir filas');

  const pruebas = [
    await debeFallar(app, "COPY (SELECT 1) TO PROGRAM 'echo intruso'", 'Ejecutar comandos en el servidor'),
    await debeFallar(app, 'SELECT rolname, rolpassword FROM pg_authid LIMIT 1', 'Leer las contraseñas de los roles'),
    await debeFallar(app, 'CREATE ROLE prueba_intruso', 'Crear roles nuevos'),
    await debeFallar(app, 'CREATE TABLE zzz_intruso (x int)', 'Crear tablas'),
    await debeFallar(app, 'ALTER TABLE usuarios ADD COLUMN zzz_intruso int', 'Alterar tablas'),
    await debeFallar(app, 'DROP TABLE usuarios', 'Borrar tablas'),
  ];
  pruebas.forEach((p) => console.log(p));
  await app.end();

  if (pruebas.some((p) => !p.includes('✔'))) {
    console.error('\n❌ El rol no quedó como debería. No cambies nada en Railway todavía.');
    process.exit(1);
  }

  const u = new URL(interna);
  u.username = ROL;
  u.password = clave;
  fs.mkdirSync(path.dirname(SALIDA), { recursive: true });
  fs.writeFileSync(SALIDA,
    `# Servicio del backend en Railway → Variables\nDATABASE_URL=${u.toString()}\n` +
    '# Las migraciones siguen con el dueño (referencia al servicio Postgres):\n' +
    'MIGRACION_DATABASE_URL=${{Postgres.DATABASE_URL}}\n', { mode: 0o600 });

  console.log('\n✅ Todo en orden.');
  console.log(`   Las variables quedaron en: ${SALIDA}`);
  console.log('   (esa carpeta está ignorada por git — no se sube nunca)');
  console.log(`\n   Host: ${u.hostname}:${u.port || 5432}  ·  rol: ${ROL}  ·  clave: ${clave.length} caracteres`);
})().catch((e) => {
  console.error('❌ Error:', e.message);
  process.exit(1);
});
