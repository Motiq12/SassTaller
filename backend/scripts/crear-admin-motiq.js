#!/usr/bin/env node
// Crea (o recupera) un administrador de Motiq.
//
//   node scripts/crear-admin-motiq.js "Jefry" jefry@motiq.cr
//   node scripts/crear-admin-motiq.js "Jefry" jefry@motiq.cr --reiniciar-2fa
//
// La contraseña se genera y se imprime UNA vez, en vez de pedirla por argumento:
// lo que se escribe en la terminal queda en el historial del shell, y esta cuenta
// abre los datos de todos los talleres del SaaS. Se puede pasar una propia con
// --password si hace falta.
//
// El segundo factor es obligatorio (B-06): una cuenta nueva, o una a la que se le
// reinició, lo configura con un QR en su próximo ingreso al panel.
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const bcrypt = require('bcrypt');
const { pool } = require('../src/db/pool');
const { generarPassword } = require('../src/utils/password');
const { restablecerCuenta } = require('../src/utils/sesiones-plataforma');

const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
const nombre = args[0];
const email = (args[1] || '').trim().toLowerCase();
const propia = process.argv.find(a => a.startsWith('--password='))?.split('=')[1];
const reiniciar2fa = process.argv.includes('--reiniciar-2fa');

if (!nombre || !email) {
  console.error('Uso: node scripts/crear-admin-motiq.js "Nombre" correo@dominio [--password=...] [--reiniciar-2fa]');
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
    // vuelve a correr esto: recuperar el acceso, no que falle por duplicado. Al
    // recuperarla se cierran todas sus sesiones y sube la versión de credenciales
    // (B-06, QA34-02): un login con la contraseña vieja a medio terminar no entra.
    // El segundo factor se conserva; con --reiniciar-2fa se borra (teléfono y códigos
    // de respaldo perdidos) y el próximo ingreso lo vuelve a configurar.
    const r = await restablecerCuenta({ nombre, email, hash, reiniciar2fa });

    console.log(`\n✔ Admin de Motiq ${r.creado ? 'creado' : 'actualizado'}: ${email}`);
    if (!r.creado) console.log('  Se cerraron todas sus sesiones abiertas.');
    if (r.creado || reiniciar2fa) {
      console.log('  En el próximo ingreso al panel va a configurar la verificación en dos pasos (QR).');
    }
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
