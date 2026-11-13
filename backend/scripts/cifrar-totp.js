#!/usr/bin/env node
// Cifra los secretos TOTP que todavía estén en claro (QP3-07), del personal
// (usuarios) y de la plataforma (plataforma_admins).
//
//   node backend/scripts/cifrar-totp.js              → cifra lo que falte
//   node backend/scripts/cifrar-totp.js --simular    → solo cuenta, no escribe
//
// En producción, desde la carpeta del repo y con TOTP_CLAVE ya cargada en el servicio:
//   railway ssh --service SassTaller "node backend/scripts/cifrar-totp.js"
//
// Idempotente: lo que ya empieza con "v1:" no se toca (solo se comprueba que la clave
// actual lo descifre), así que correrlo dos veces no cambia nada la segunda vez. Cada
// fila se escribe condicionada al valor leído: si alguien configura su 2FA mientras
// corre, su valor nuevo no se pisa.
//
// No imprime ningún secreto, ni en claro ni cifrado: solo cantidades e ids.
// Sale con código 1 si falta la clave o si hay valores cifrados que la clave actual no
// descifra (se cargó otra clave: esos usuarios solo entran con códigos de respaldo).
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { hayClave, estaCifrado, cifrarSecreto, descifrarSecreto, ErrorTotpCifrado } = require('../src/utils/totp-cifrado');

const TABLAS = ['usuarios', 'plataforma_admins'];

async function cifrarTodo(db, { simular = false } = {}) {
  if (!hayClave()) {
    throw new ErrorTotpCifrado('Falta TOTP_CLAVE (o no son 32 bytes en base64): no hay con qué cifrar.');
  }
  const resumen = {};
  for (const tabla of TABLAS) {
    const r = { revisados: 0, cifrados: 0, ya_cifrados: 0, cambiaron: 0, ilegibles: [] };
    // Todas las filas, de todos los talleres: es mantenimiento de la base, no un pedido.
    const [filas] = await db.query(
      `SELECT id, totp_secret FROM ${tabla} WHERE totp_secret IS NOT NULL AND totp_secret <> '' ORDER BY id`
    );
    for (const fila of filas) {
      r.revisados++;
      if (estaCifrado(fila.totp_secret)) {
        try {
          descifrarSecreto(fila.totp_secret);
          r.ya_cifrados++;
        } catch (err) {
          if (!(err instanceof ErrorTotpCifrado)) throw err;
          r.ilegibles.push(fila.id);
        }
        continue;
      }
      const cifrado = cifrarSecreto(fila.totp_secret);
      // Antes de escribir, la vuelta completa: si no devuelve lo mismo, no se guarda.
      if (!estaCifrado(cifrado) || descifrarSecreto(cifrado) !== fila.totp_secret) {
        throw new Error(`El cifrado no dio la vuelta en ${tabla} ${fila.id}: no se escribió nada de esa fila.`);
      }
      if (simular) {
        r.cifrados++;
        continue;
      }
      const [res] = await db.query(
        `UPDATE ${tabla} SET totp_secret = ? WHERE id = ? AND totp_secret = ?`,
        [cifrado, fila.id, fila.totp_secret]
      );
      if (res.affectedRows === 1) r.cifrados++;
      else r.cambiaron++;
    }
    resumen[tabla] = r;
  }
  return resumen;
}

async function main() {
  const simular = process.argv.includes('--simular');
  const { pool } = require('../src/db/pool');
  try {
    const resumen = await cifrarTodo(pool, { simular });
    let ilegibles = 0;
    for (const [tabla, r] of Object.entries(resumen)) {
      console.log(`${tabla}: ${r.revisados} con secreto · ${r.cifrados} ${simular ? 'por cifrar' : 'cifrados ahora'}`
        + ` · ${r.ya_cifrados} ya estaban cifrados · ${r.cambiaron} cambiaron mientras corría`
        + (r.ilegibles.length ? ` · ${r.ilegibles.length} NO se pueden descifrar con esta clave (ids ${r.ilegibles.join(', ')})` : ''));
      ilegibles += r.ilegibles.length;
    }
    if (simular) console.log('Simulación: no se escribió nada.');
    if (ilegibles) {
      console.error('❌ Hay secretos cifrados con otra clave. Revisá que TOTP_CLAVE sea la misma con que se cifraron.');
      process.exitCode = 1;
    }
  } catch (err) {
    console.error(`❌ ${err.message}`);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

if (require.main === module) main();

module.exports = { cifrarTodo };
