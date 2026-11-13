// Crea la base de la suite si todavía no existe. Corre ANTES de levantar el
// backend (ver webServer en playwright.config.ts): Playwright arranca los
// webServer antes del globalSetup, y el backend necesita la base para migrarla
// al arrancar. La base es persistente entre corridas: cada worker crea su propio
// taller con sello único, así que no hace falta vaciarla.
import pg from 'pg';

const URL_DB = process.env.E2E_DATABASE_URL || 'postgres://motiq:motiq_dev@127.0.0.1:5433/motiq_t11_e2e';
const destino = new URL(URL_DB);
const nombre = decodeURIComponent(destino.pathname.replace(/^\//, ''));

// Regla de las bases de prueba: nunca contra una que no sea de pruebas.
if (!/_(e2e|test)$/.test(nombre)) {
  console.error(`[e2e] la base "${nombre}" no termina en _e2e ni _test: no la toco`);
  process.exit(1);
}

// Para crear la base hay que conectarse a otra (la de mantenimiento).
const mantenimiento = new URL(URL_DB);
mantenimiento.pathname = '/postgres';

const cliente = new pg.Client({ connectionString: mantenimiento.toString() });
await cliente.connect();
try {
  const { rows } = await cliente.query('SELECT 1 FROM pg_database WHERE datname = $1', [nombre]);
  if (rows.length) {
    console.log(`[e2e] base ${nombre} ya existe (el backend la migra al arrancar)`);
  } else {
    await cliente.query(`CREATE DATABASE "${nombre.replace(/"/g, '""')}"`);
    console.log(`[e2e] base ${nombre} creada (el backend la migra al arrancar)`);
  }
} finally {
  await cliente.end();
}
