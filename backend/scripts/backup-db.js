#!/usr/bin/env node
// Respaldo manual de la base de producción (Postgres).
//
// Un volcado completo con pg_dump en formato "custom" (-Fc): ya viene comprimido y se
// restaura con pg_restore, entero o por tabla. Con rotación (conserva los últimos N).
// Correlo cada tanto — y SIEMPRE antes de tocar algo delicado (migraciones, borrados
// masivos, cambios de esquema).
//
//   npm run backup
//
// La URL de la base se toma de (en este orden):
//   1. el argumento:            node scripts/backup-db.js "postgres://user:pass@host:puerto/base"
//   2. la variable BACKUP_DB_URL
//   3. la variable DATABASE_PUBLIC_URL   (la que expone Railway)
//   4. el CLI de Railway, si estás logueado (lo normal: no hay que pegar nada)
//
// pg_dump: el del PATH (o las rutas típicas de Windows) si su versión alcanza; si no,
// el de la imagen oficial de Docker con la MISMA versión mayor que el servidor
// (pg_dump no puede respaldar un servidor más nuevo que él).
//
// Restaurar:  pg_restore --clean --if-exists --no-owner -d "postgres://…" archivo.dump
//
// Los respaldos van a backend/backups/ (ignorada por git: contienen datos reales).
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const { varRailway } = require('./railway-var');

const CONSERVAR = 10;
const DIR = path.join(__dirname, '..', 'backups');

function versionMayorDe(bin) {
  const r = spawnSync(bin, ['--version'], { encoding: 'utf8' });
  const m = r.status === 0 && String(r.stdout).match(/(\d+)(?:\.\d+)?/);
  return m ? Number(m[1]) : null;
}

function pgDumpLocal(mayorServidor) {
  const candidatos = ['pg_dump'];
  for (const raiz of ['C:\\Program Files\\PostgreSQL']) {
    if (!fs.existsSync(raiz)) continue;
    for (const v of fs.readdirSync(raiz)) candidatos.push(path.join(raiz, v, 'bin', 'pg_dump.exe'));
  }
  for (const c of candidatos) {
    if (path.isAbsolute(c) && !fs.existsSync(c)) continue;
    const v = versionMayorDe(c);
    if (v && v >= mayorServidor) return c;
  }
  return null;
}

function hayDocker() {
  return spawnSync('docker', ['info'], { stdio: 'ignore' }).status === 0;
}

function rotar() {
  const archivos = fs.readdirSync(DIR)
    .filter((f) => f.endsWith('.dump'))
    .map((f) => ({ f, t: fs.statSync(path.join(DIR, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  for (const viejo of archivos.slice(CONSERVAR)) {
    fs.unlinkSync(path.join(DIR, viejo.f));
    console.log(`   (rotación) borrado ${viejo.f}`);
  }
}

(async () => {
  const url = process.argv[2] || process.env.BACKUP_DB_URL || process.env.DATABASE_PUBLIC_URL
    || varRailway('Postgres', 'DATABASE_PUBLIC_URL');
  if (!url) {
    console.error('❌ Falta la URL de la base.');
    console.error('   Lo normal es que la lea sola del CLI de Railway: probá `railway login` y `railway link`.');
    console.error('   Si no, pasala como argumento o definí BACKUP_DB_URL / DATABASE_PUBLIC_URL.');
    console.error('   La encontrás en Railway → servicio Postgres → Variables → DATABASE_PUBLIC_URL');
    process.exit(1);
  }
  const u = new URL(url);
  const base = decodeURIComponent(u.pathname.replace(/^\//, ''));

  // La versión del servidor decide qué pg_dump sirve.
  const cliente = new Client({ connectionString: url });
  let mayor;
  try {
    await cliente.connect();
    const { rows: [r] } = await cliente.query('SHOW server_version_num');
    mayor = Math.floor(Number(r.server_version_num) / 10000);
  } catch (err) {
    console.error('❌ No se pudo conectar a la base:', err.code || err.message);
    process.exit(1);
  } finally {
    await cliente.end().catch(() => {});
  }

  fs.mkdirSync(DIR, { recursive: true });
  const sello = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const destino = path.join(DIR, `${base}_${sello}.dump`);

  // La contraseña va por PGPASSWORD y no en la URL de los argumentos: los argumentos
  // son visibles en la lista de procesos del sistema.
  const clave = decodeURIComponent(u.password);
  const sinClave = new URL(url); sinClave.password = '';
  const argsDump = ['--format=custom', '--no-owner', '--no-privileges', `--dbname=${sinClave.toString()}`];

  let bin = pgDumpLocal(mayor), args = argsDump;
  if (!bin) {
    if (!hayDocker()) {
      console.error(`❌ No hay pg_dump ${mayor}+ ni Docker. Instalá las herramientas de PostgreSQL ${mayor} o abrí Docker Desktop.`);
      process.exit(1);
    }
    // Desde el contenedor, "localhost" es el contenedor: para una base local se usa el host.
    if (['localhost', '127.0.0.1'].includes(sinClave.hostname)) sinClave.hostname = 'host.docker.internal';
    bin = 'docker';
    // `-e PGPASSWORD` sin valor: Docker lo toma del entorno del proceso, no del argumento.
    args = ['run', '--rm', '-e', 'PGPASSWORD', `postgres:${mayor}-alpine`, 'pg_dump',
      '--format=custom', '--no-owner', '--no-privileges', `--dbname=${sinClave.toString()}`];
  }

  console.log(`📦 Respaldando ${base} desde ${u.hostname}:${u.port || 5432} (Postgres ${mayor}) …`);
  // Sin shell: los argumentos llevan la URL de la base, y un shell interpretaría sus
  // & o ? en vez de pasarlos tal cual. docker y pg_dump son ejecutables, no lo necesitan.
  const dump = spawn(bin, args, { env: { ...process.env, PGPASSWORD: clave } });
  const salida = fs.createWriteStream(destino);
  dump.stdout.pipe(salida);

  let errores = '';
  dump.stderr.on('data', (d) => { errores += d.toString(); });
  dump.on('error', (err) => { console.error('❌ No se pudo ejecutar pg_dump:', err.message); process.exit(1); });

  // Se espera a las DOS cosas: que pg_dump termine y que el archivo cierre (el orden
  // entre ambos eventos no está garantizado).
  let codigo = null, archivoListo = false;
  const finalizar = () => {
    if (codigo === null || !archivoListo) return;
    if (codigo !== 0) {
      console.error(`❌ pg_dump falló (código ${codigo}):\n${errores.trim()}`);
      if (fs.existsSync(destino)) fs.unlinkSync(destino);
      process.exit(1);
    }
    const bytes = fs.statSync(destino).size;
    const mb = (bytes / 1024 / 1024).toFixed(2);
    if (bytes < 1024) {
      console.error(`⚠️  El respaldo quedó sospechosamente chico (${mb} MB). Revisalo antes de confiar en él.`);
      if (errores.trim()) console.error(errores.trim());
      process.exit(1);
    }
    console.log(`✅ Listo: ${path.basename(destino)} (${mb} MB)`);
    rotar();
    console.log(`   Guardado en: ${DIR}`);
  };
  dump.on('close', (c) => { codigo = c; finalizar(); });
  salida.on('finish', () => { archivoListo = true; finalizar(); });
})();
