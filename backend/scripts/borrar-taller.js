#!/usr/bin/env node
// Borra un taller y TODO lo suyo. Es definitivo: no hay papelera.
//
//   node scripts/borrar-taller.js taller-prueba-314640          (muestra qué borraría)
//   node scripts/borrar-taller.js taller-prueba-314640 --si     (lo borra)
//   node scripts/borrar-taller.js --patron="taller-prueba-%" --si
//
// Existe por dos motivos: limpiar los talleres que dejan las pruebas end-to-end en la
// base de desarrollo, y poder atender de verdad a un cliente que se da de baja y pide
// que se borren sus datos. Suspender desde el panel NO borra nada — es reversible a
// propósito —, así que esto es lo otro.
//
// Corre sin la red de seguridad del scope por taller (usa el pool crudo): es su
// trabajo, borra un taller entero. Por eso pide el --si y por eso, sin él, solo mira.
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { pool } = require('../src/db/pool');
const { TABLAS_CON_TENANT } = require('../src/db/tenant-db');
const { ordenDeBorrado } = require('../src/utils/orden-borrado');

const args = process.argv.slice(2);
const EN_SERIO = args.includes('--si');
const patron = args.find(a => a.startsWith('--patron='))?.split('=')[1];
const slug = args.find(a => !a.startsWith('--'));

if (!slug && !patron) {
  console.error('Uso: node scripts/borrar-taller.js <slug> [--si]');
  console.error('     node scripts/borrar-taller.js --patron="taller-prueba-%" --si');
  process.exit(1);
}

(async () => {
  // El orden se calcula una vez, antes de tocar nada: si el esquema tuviera un ciclo de
  // claves foráneas, es mejor enterarse acá que con medio taller borrado.
  const orden = await ordenDeBorrado(pool, TABLAS_CON_TENANT);

  const conn = await pool.getConnection();
  try {
    const [talleres] = patron
      ? await conn.query('SELECT id, nombre, slug FROM tenants WHERE slug LIKE ?', [patron])
      : await conn.query('SELECT id, nombre, slug FROM tenants WHERE slug = ?', [slug]);

    if (!talleres.length) {
      console.log('No hay ningún taller que coincida.');
      return;
    }

    for (const t of talleres) {
      // Qué se va a perder, antes de perderlo. Sin esto es demasiado fácil borrar el
      // taller equivocado y enterarse después.
      const [[cuenta]] = await conn.query(
        `SELECT (SELECT COUNT(*) FROM usuarios        WHERE tenant_id = ?) AS usuarios,
                (SELECT COUNT(*) FROM clientes        WHERE tenant_id = ?) AS clientes,
                (SELECT COUNT(*) FROM vehiculos       WHERE tenant_id = ?) AS vehiculos,
                (SELECT COUNT(*) FROM ordenes_trabajo WHERE tenant_id = ?) AS ordenes`,
        [t.id, t.id, t.id, t.id]
      );
      console.log(`\n${EN_SERIO ? '🗑' : '·'}  ${t.nombre} (${t.slug}) — ` +
        `${cuenta.usuarios} usuarios, ${cuenta.clientes} clientes, ` +
        `${cuenta.vehiculos} vehículos, ${cuenta.ordenes} órdenes`);

      if (!EN_SERIO) continue;

      // Todo o nada: un borrado a medias dejaría filas huérfanas apuntando a un taller
      // que ya no existe, y esas filas no las alcanza ninguna consulta con scope.
      await conn.beginTransaction();
      try {
        // Se borra en orden de dependencias, con las claves foráneas ENCENDIDAS.
        //
        // Antes esto hacía `SET FOREIGN_KEY_CHECKS = 0` porque mantener el orden a mano
        // se rompía al agregar una tabla. El orden ahora se deduce del esquema real en
        // cada corrida (ver utils/orden-borrado), así que una tabla nueva entra sola —y
        // sin tener que apagar la única red que avisa si algo quedó colgando.
        let filas = 0;
        for (const tabla of orden) {
          const [r] = await conn.query(`DELETE FROM \`${tabla}\` WHERE tenant_id = ?`, [t.id]);
          filas += r.affectedRows;
        }
        const [r] = await conn.query('DELETE FROM tenants WHERE id = ?', [t.id]);
        filas += r.affectedRows;
        await conn.commit();
        console.log(`   borradas ${filas} filas`);
      } catch (err) {
        await conn.rollback();
        throw err;
      }
    }

    if (!EN_SERIO) {
      console.log(`\n(${talleres.length} taller${talleres.length === 1 ? '' : 'es'}) — nada se borró. Agregá --si para hacerlo de verdad.`);
    }
  } catch (err) {
    console.error('✖ Falló el borrado:', err.message);
    process.exitCode = 1;
  } finally {
    conn.release();
    await pool.end();
  }
})();
