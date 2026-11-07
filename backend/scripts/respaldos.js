#!/usr/bin/env node
// Respaldos automáticos de la base: operarlos a mano.
//
//   node scripts/respaldos.js lista                     qué respaldos hay guardados
//   node scripts/respaldos.js bajar <clave> [carpeta]   baja uno (y lo descifra si hace falta)
//   node scripts/respaldos.js abrir <archivo.enc>       descifra uno ya bajado
//   node scripts/respaldos.js ahora                     hace un respaldo en este momento
//
// "lista", "bajar" y "abrir" se corren desde la computadora, con las variables
// del sistema:
//   railway run --service Proyecto-taller node backend/scripts/respaldos.js lista
// "ahora" necesita llegar a la base por la red privada, así que se corre DENTRO
// del servicio:
//   railway ssh --service Proyecto-taller "node backend/scripts/respaldos.js ahora"
//
// Los archivos bajados van a backend/backups/ (ignorada por git: son datos reales).
// Para restaurar uno: ver docs/RESPALDOS.md.

const fs = require('node:fs');
const path = require('node:path');
const { configRespaldo, respaldar } = require('../src/services/respaldo');
const { crearS3 } = require('../src/utils/s3');
const { descifrarArchivo, estaCifrado } = require('../src/utils/cifrado-archivo');

const megas = (bytes) => (bytes / 1024 / 1024).toFixed(1).padStart(7) + ' MB';
const [orden, ...args] = process.argv.slice(2);

function configuracion() {
  const c = configRespaldo();
  if (!c.activo) {
    console.error(`❌ El respaldo no está configurado: faltan ${c.faltan.join(', ')}.`);
    process.exit(1);
  }
  return c;
}

async function lista() {
  const c = configuracion();
  const objetos = (await crearS3(c).listar(c.prefijo)).sort((a, b) => a.clave.localeCompare(b.clave));
  if (!objetos.length) return console.log('No hay ningún respaldo guardado todavía.');
  for (const o of objetos) console.log(`${megas(o.bytes)}  ${o.fecha}  ${o.clave}`);
  console.log(`\n${objetos.length} respaldos (se conservan ${c.conservar}).`);
}

async function abrir(archivo, frase) {
  if (!estaCifrado(archivo)) return archivo;
  if (!frase) {
    console.error('❌ El respaldo está cifrado y falta RESPALDO_CLAVE para abrirlo.');
    process.exit(1);
  }
  const destino = archivo.replace(/\.enc$/, '') + (archivo.endsWith('.enc') ? '' : '.descifrado');
  await descifrarArchivo(archivo, destino, frase);
  return destino;
}

async function bajar(clave, carpeta) {
  if (!clave) {
    console.error('Falta la clave. Mirá cuáles hay con: node scripts/respaldos.js lista');
    process.exit(1);
  }
  const c = configuracion();
  const dir = path.resolve(carpeta || path.join(__dirname, '..', 'backups'));
  fs.mkdirSync(dir, { recursive: true });
  const destino = path.join(dir, path.basename(clave));
  await crearS3(c).bajar(clave, destino);
  console.log(`✅ Bajado: ${destino} (${megas(fs.statSync(destino).size).trim()})`);
  const abierto = await abrir(destino, c.frase);
  if (abierto !== destino) console.log(`🔓 Descifrado: ${abierto}`);
  console.log('   Contiene datos reales de clientes: no lo compartas ni lo subas a ningún lado.');
}

async function ahora() {
  const { pool } = require('../src/db/pool'); // solo acá: lo demás no toca la base
  try {
    const r = await respaldar({ pool, config: configuracion() });
    console.log(`✅ Respaldo subido: ${r.clave}`);
    console.log(`   ${megas(r.bytes).trim()} · ${r.tablas} tablas, ${r.filas} filas · ${r.segundos} s${r.cifrado ? ' · cifrado' : ' · SIN cifrar'}${r.borrados ? ` · ${r.borrados} viejos borrados` : ''}`);
  } finally {
    await pool.end();
  }
}

(async () => {
  if (orden === 'lista') return lista();
  if (orden === 'bajar') return bajar(args[0], args[1]);
  if (orden === 'ahora') return ahora();
  if (orden === 'abrir') {
    if (!args[0]) { console.error('Falta el archivo.'); process.exit(1); }
    const abierto = await abrir(path.resolve(args[0]), process.env.RESPALDO_CLAVE || '');
    return console.log(abierto === path.resolve(args[0]) ? 'Ese archivo no está cifrado.' : `🔓 Descifrado: ${abierto}`);
  }
  console.error('Uso: node scripts/respaldos.js lista | bajar <clave> [carpeta] | abrir <archivo> | ahora');
  process.exit(1);
})().catch((err) => {
  console.error('❌', err.message);
  process.exit(1);
});
