#!/usr/bin/env node
// Crea (o actualiza la contraseña de) un administrador de Motiq.
//
//   node scripts/crear-admin-motiq.js "Jefry" jefry@motiq.cr
//
// La contraseña se genera y se imprime UNA vez, en vez de pedirla por argumento:
// lo que se escribe en la terminal queda en el historial del shell, y esta cuenta
// abre los datos de todos los talleres del SaaS. Se puede pasar una propia con
// --password si hace falta.
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const bcrypt = require('bcrypt');
const { pool } = require('../src/db/pool');
const { generarPassword } = require('../src/utils/password');

const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
const nombre = args[0];
const email = (args[1] || '').trim().toLowerCase();
const propia = process.argv.find(a => a.startsWith('--password='))?.split('=')[1];

if (!nombre || !email) {
  console.error('Uso: node scripts/crear-admin-motiq.js "Nombre" correo@dominio [--password=...]');
  process.exit(1);
}
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error('✖ El correo no tiene un formato válido');
  process.exit(1);
}

(async () => {
  try {
    const password = propia || generarPassword();
    if (password.length < 12) {
      console.error('✖ La contraseña debe tener al menos 12 caracteres (esta cuenta ve todos los talleres)');
      process.exit(1);
    }
    const hash = await bcrypt.hash(password, 10);

    // Si ya existe se le cambia la contraseña, que es lo que se quiere cuando uno
    // vuelve a correr esto: recuperar el acceso, no que falle por duplicado.
    // `xmax = 0` distingue en Postgres una fila recién insertada de una que el
    // ON CONFLICT actualizó (en MySQL lo decía insertId).
    const [[r]] = await pool.query(
      `INSERT INTO plataforma_admins (nombre, email, password_hash, activo) VALUES (?, ?, ?, 1)
       ON CONFLICT (email) DO UPDATE SET nombre = EXCLUDED.nombre, password_hash = EXCLUDED.password_hash, activo = 1
       RETURNING (xmax = 0)::int AS creado`,
      [nombre, email, hash]
    );

    console.log(`\n✔ Admin de Motiq ${r.creado ? 'creado' : 'actualizado'}: ${email}`);
    if (!propia) {
      console.log(`\n  Contraseña: ${password}`);
      console.log('  Guardala ahora: no se vuelve a mostrar y en la base solo queda el hash.\n');
    }
    await pool.end();
  } catch (err) {
    console.error('✖ No se pudo crear el admin:', err.message);
    process.exit(1);
  }
})();
