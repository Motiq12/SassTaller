#!/usr/bin/env node
// Guarda los DATOS de la base local en db/datos-prueba.sql, para que el resto del
// equipo los cargue con `npm run db:importar`.
//
//   npm run db:exportar
//
// Solo datos: el esquema no viaja acá porque vive en db/migraciones/ y lo aplica el
// import. Así un cambio de esquema es siempre una migración nueva y nunca "lo que
// tenía mi base el día que exporté".
//
// Lo que NO sale, y por qué:
//   • plataforma_admins: son cuentas que ven todos los talleres. Cada quien crea la
//     suya con `npm run motiq:admin`.
//   • Contraseñas del personal y de clientes: la fila sí (hace falta con quién entrar),
//     el hash no. Se reemplaza por el centinela de db/credenciales.js y el import
//     genera contraseñas nuevas. Un hash commiteado queda en el historial para siempre.
//   • Códigos de un solo uso (verificación, login, recuperación): basura vencida, y un
//     hash de 6 dígitos se revierte por fuerza bruta.
//   • schema_migraciones: la escribe el import al migrar.
const fs = require('fs');
const path = require('path');

const DESTINO = path.join(__dirname, 'datos-prueba.sql');
const FUERA = new Set([
  'schema_migraciones', 'plataforma_admins',
  'email_verify_codes', 'login_codes', 'password_reset_codes', 'usuario_verify_codes',
]);
const CON_PASSWORD = new Set(['usuarios', 'clientes']);

// Valor de Postgres (en su forma de texto) → literal SQL.
const literal = (v) => (v === null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);
const q = (id) => `"${id}"`;

(async () => {
  require('dotenv').config({ path: path.join(__dirname, '../.env') });
  const { pool } = require('../src/db/pool');
  const { SIN_PASSWORD } = require('./credenciales');
  try {
    // Columnas insertables de cada tabla (las GENERATED, como placa_norm, se recalculan
    // solas) y cuál es la identidad, para dejar la secuencia después del último id.
    const { rows: columnas } = await pool.nativo.query(
      `SELECT table_name, column_name, is_identity = 'YES' AS identidad
         FROM information_schema.columns
        WHERE table_schema = current_schema() AND is_generated = 'NEVER'
        ORDER BY table_name, ordinal_position`
    );
    const tablas = {};
    for (const c of columnas) {
      if (FUERA.has(c.table_name)) continue;
      (tablas[c.table_name] ||= { cols: [], identidad: null }).cols.push(c.column_name);
      if (c.identidad) tablas[c.table_name].identidad = c.column_name;
    }

    const salida = [`-- Datos de prueba de Motiq. Generado por \`npm run db:exportar\` el ${new Date().toISOString().slice(0, 10)}.
-- Se carga sobre una base recién migrada (npm run db:importar). Sin contraseñas que
-- funcionen ni cuentas de plataforma: ver db/exportar.js.

SET TIME ZONE 'UTC';
BEGIN;
SET CONSTRAINTS ALL DEFERRED;
`];
    let filasTotal = 0;
    for (const [tabla, { cols, identidad }] of Object.entries(tablas)) {
      // Todo como texto crudo de Postgres (sin los parsers de pg): una fecha no se
      // corre por la zona del proceso, un numeric no pierde decimales y un jsonb
      // vuelve tal cual.
      const { rows } = await pool.nativo.query({
        text: `SELECT ${cols.map(q).join(', ')} FROM ${q(tabla)} ORDER BY 1`,
        rowMode: 'array',
        types: { getTypeParser: () => (v) => v },
      });
      if (!rows.length) continue;
      const iHash = CON_PASSWORD.has(tabla) ? cols.indexOf('password_hash') : -1;
      const tuplas = rows.map((fila) => `  (${fila.map((v, k) => literal(k === iHash && v !== null ? SIN_PASSWORD : v)).join(', ')})`);
      salida.push(`INSERT INTO ${q(tabla)} (${cols.map(q).join(', ')}) VALUES\n${tuplas.join(',\n')};`);
      filasTotal += rows.length;
      if (identidad) {
        salida.push(`SELECT setval(pg_get_serial_sequence('${tabla}', '${identidad}'), (SELECT MAX(${q(identidad)}) FROM ${q(tabla)}));`);
      }
    }
    salida.push('COMMIT;');
    fs.writeFileSync(DESTINO, salida.join('\n') + '\n');
    console.log(`✔ ${filasTotal} filas de ${Object.keys(tablas).length} tablas → db/${path.basename(DESTINO)}`);
    console.log('  · sin cuentas de plataforma, sin contraseñas y sin códigos de un solo uso');
  } catch (err) {
    console.error('✖ Falló la exportación:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
