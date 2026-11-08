// Migraciones de Postgres: aplica en orden los archivos de db/migraciones/ que todavía
// no corrieron en esta base, y anota cada uno en `schema_migraciones`.
//
// Reemplaza a auto-migrate.js (MySQL), que en cada arranque revisaba information_schema
// y agregaba lo que faltara. Ese modelo no decía en qué estado estaba una base, y no
// servía para cambios que no fueran "agregar": renombrar, cambiar un tipo o mover datos.
// Acá cada cambio es un archivo numerado que corre una sola vez, y la base sabe cuáles
// tiene.
//
// Reglas para escribir una migración nueva:
//   • Nombre `NNNN_descripcion.sql`, con el número siguiente. Nunca editar una que ya
//     corrió en alguna base: se escribe otra que la corrija.
//   • Corre dentro de una transacción: si falla a la mitad, no queda nada a medias.
//   • Si agrega una tabla con tenant_id, sumarla a TABLAS_CON_TENANT (db/tenant-db.js);
//     el arranque avisa si no coinciden.
const fs = require('fs');
const path = require('path');
const { pool } = require('./pool');

const CARPETA = path.join(__dirname, '../../db/migraciones');

// Número arbitrario y fijo: identifica "la migración de Motiq" ante pg_advisory_lock.
// Con varios workers o dos deploys solapados, solo uno migra; los demás esperan y
// después ven que ya no queda nada pendiente.
const CANDADO = 4_812_007;

function pendientesEn(aplicadas) {
  return fs.readdirSync(CARPETA)
    .filter(f => /^\d{4}_[\w-]+\.sql$/.test(f))
    .sort()
    .filter(f => !aplicadas.has(f));
}

// Con quién se migra. En producción la app NO es dueña del esquema: se conecta como un
// rol que solo lee y escribe filas (scripts/crear-usuario-app.js), así una inyección
// SQL no puede borrar ni alterar tablas. Las migraciones, que sí cambian el esquema,
// usan entonces otra conexión: MIGRACION_DATABASE_URL, la del dueño. Sin esa variable
// (desarrollo, tests) se migra con la misma conexión de la app.
async function conexionDeMigracion() {
  if (!process.env.MIGRACION_DATABASE_URL) {
    const c = await pool.nativo.connect();
    return { cliente: c, soltar: () => c.release() };
  }
  const { Client } = require('pg');
  const c = new Client({ connectionString: process.env.MIGRACION_DATABASE_URL, options: '-c TimeZone=UTC' });
  await c.connect();
  return { cliente: c, soltar: () => c.end() };
}

async function migrar({ log = console.log } = {}) {
  const { cliente, soltar } = await conexionDeMigracion();
  try {
    await cliente.query('SELECT pg_advisory_lock($1)', [CANDADO]);
    await cliente.query(`CREATE TABLE IF NOT EXISTS schema_migraciones (
      nombre text PRIMARY KEY,
      aplicada_en timestamptz NOT NULL DEFAULT now()
    )`);

    const { rows } = await cliente.query('SELECT nombre FROM schema_migraciones');
    const aplicadas = new Set(rows.map(r => r.nombre));

    // Base que ya tenía el esquema antes de que existiera esta tabla (cargada a mano con
    // 0001_esquema_base.sql): se registra la base en vez de correrla y chocar con las
    // tablas que ya están.
    if (!aplicadas.size) {
      const { rows: [t] } = await cliente.query("SELECT to_regclass('public.tenants') IS NOT NULL AS hay");
      if (t.hay) {
        await cliente.query("INSERT INTO schema_migraciones (nombre) VALUES ('0001_esquema_base.sql')");
        aplicadas.add('0001_esquema_base.sql');
        log('🗂️  Base existente: se registró 0001_esquema_base.sql como aplicada.');
      }
    }

    const pendientes = pendientesEn(aplicadas);
    for (const archivo of pendientes) {
      const sql = fs.readFileSync(path.join(CARPETA, archivo), 'utf8');
      await cliente.query('BEGIN');
      try {
        await cliente.query(sql);
        await cliente.query('INSERT INTO schema_migraciones (nombre) VALUES ($1)', [archivo]);
        await cliente.query('COMMIT');
        log(`🗂️  Migración aplicada: ${archivo}`);
      } catch (err) {
        await cliente.query('ROLLBACK');
        err.message = `Migración ${archivo} falló: ${err.message}`;
        throw err;
      }
    }
    if (!pendientes.length) log('🗂️  Esquema al día.');
    return pendientes;
  } finally {
    await cliente.query('SELECT pg_advisory_unlock($1)', [CANDADO]).catch(() => {});
    await soltar();
  }
}

module.exports = { migrar };
