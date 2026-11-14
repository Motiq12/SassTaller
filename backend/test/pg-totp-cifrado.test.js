// QP3-07: los secretos TOTP del personal y de la plataforma se guardan cifrados, en
// todos los caminos (alta, activación y login con 2FA), los viejos en claro se siguen
// leyendo y se re-cifran, y scripts/cifrar-totp.js cifra lo existente sin repetir.
// Routers y SQL reales contra Postgres; solo se sustituyen los envíos de correo. Los
// casos del personal corren en DOS talleres.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcrypt');
const { spawnSync } = require('child_process');

const url = process.env.PG_TEST_URL;
if (url && !/\/\w+_test(\?|$)/.test(url)) throw new Error('PG_TEST_URL debe terminar en _test');
if (url) process.env.DATABASE_URL = url;
process.env.JWT_SECRET = 'solo-tests-totp-cifrado-t16';
process.env.RESEND_API_KEY = '';
delete process.env.TURNSTILE_SECRET;
// Claves de prueba generadas en cada corrida: nunca una real.
const CLAVE = crypto.randomBytes(32).toString('base64');
const OTRA_CLAVE = crypto.randomBytes(32).toString('base64');
process.env.TOTP_CLAVE = CLAVE;
const t = (nombre, fn) => test(nombre, { skip: !url && 'sin PG_TEST_URL' }, fn);

const totp = require('../src/utils/totp');
const { estaCifrado, descifrarSecreto } = require('../src/utils/totp-cifrado');
const { cifrarTodo } = require('../scripts/cifrar-totp');

const clave = 'UnaClaveSegura123';
const hash = bcrypt.hashSync(clave, 4);
const sello = `${Date.now()}-${process.pid}`;
let pool, server, base, secuencia = 0;
const talleres = {};
// Todo secreto en claro que pasa por la prueba: al final ninguno puede estar en la base.
const vistos = new Set();

async function pedir(method, ruta, body, token) {
  const r = await fetch(base + ruta, {
    method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: await r.json() };
}
const q = (...a) => pool.query(...a);
const ahora = () => Math.floor(Date.now() / 1000 / totp.PERIODO);
const guardado = async (tabla, id) => (await q(`SELECT totp_secret FROM ${tabla} WHERE id = ?`, [id]))[0][0].totp_secret;
const liberarPeriodo = (tabla, id) => q(`UPDATE ${tabla} SET totp_ultimo_contador = NULL WHERE id = ?`, [id]);

function cifradoDe(valor, secreto) {
  assert.ok(estaCifrado(valor), `quedó en claro: ${String(valor).slice(0, 3)}…`);
  assert.ok(!valor.includes(secreto), 'el secreto aparece dentro del valor guardado');
  assert.equal(descifrarSecreto(valor), secreto);
}

// ── Personal ──
async function personal(tl, extra = {}) {
  const email = `t16-${sello}-${++secuencia}@prueba.test`;
  const [[u]] = await q(
    `INSERT INTO usuarios (tenant_id, nombre, email, password_hash, rol, email_verificado, totp_secret, totp_activado)
     VALUES (?, ?, ?, ?, 'recepcion', 1, ?, ?) RETURNING id`,
    [tl.id, `Persona ${secuencia}`, email, hash, extra.secreto || null, extra.activado ? 1 : 0]
  );
  if (extra.secreto) vistos.add(extra.secreto);
  return { id: u.id, email };
}
async function loginStaff(email) {
  const r = await pedir('POST', '/api/auth/login', { email, password: clave });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.data;
}
async function staffCon2fa(tl) {
  const u = await personal(tl);
  const { token } = await loginStaff(u.email);
  const s = await pedir('POST', '/api/auth/2fa/setup', {}, token);
  assert.equal(s.status, 200, JSON.stringify(s.body));
  const secreto = s.body.data.secreto;
  vistos.add(secreto);
  // Ya en el alta, antes de activar, la clave pendiente se guarda cifrada.
  cifradoDe(await guardado('usuarios', u.id), secreto);
  const a = await pedir('POST', '/api/auth/2fa/activar', { codigo: totp.codigoPara(secreto, ahora()) }, token);
  assert.equal(a.status, 200, JSON.stringify(a.body));
  cifradoDe(await guardado('usuarios', u.id), secreto);
  return { ...u, secreto, respaldo: a.body.data.codigos_respaldo };
}
async function entrarStaff(u, codigo) {
  await liberarPeriodo('usuarios', u.id);
  const l = await loginStaff(u.email);
  assert.equal(l.requiere_2fa, true, JSON.stringify(l));
  return pedir('POST', '/api/auth/2fa/verificar', { token_parcial: l.token_parcial, codigo: codigo ?? totp.codigoPara(u.secreto, ahora()) });
}

// ── Plataforma ──
async function admin(extra = {}) {
  const email = `t16-motiq-${sello}-${++secuencia}@prueba.test`;
  const [[a]] = await q(
    `INSERT INTO plataforma_admins (nombre, email, password_hash, activo, totp_secret, totp_activado)
     VALUES ('Motiq', ?, ?, 1, ?, ?) RETURNING id`,
    [email, hash, extra.secreto || null, extra.activado ? 1 : 0]
  );
  if (extra.secreto) vistos.add(extra.secreto);
  return { id: a.id, email };
}
async function adminCon2fa() {
  const a = await admin();
  const l = await pedir('POST', '/api/motiq/login', { email: a.email, password: clave });
  assert.equal(l.body.data?.requiere_configurar_2fa, true, JSON.stringify(l.body));
  const conf = await pedir('POST', '/api/motiq/login/configurar', { token_parcial: l.body.data.token_parcial });
  assert.equal(conf.status, 200, JSON.stringify(conf.body));
  const secreto = conf.body.data.secreto;
  vistos.add(secreto);
  cifradoDe(await guardado('plataforma_admins', a.id), secreto);
  const act = await pedir('POST', '/api/motiq/login/activar', { token_parcial: l.body.data.token_parcial, codigo: totp.codigoPara(secreto, ahora()) });
  assert.equal(act.status, 200, JSON.stringify(act.body));
  cifradoDe(await guardado('plataforma_admins', a.id), secreto);
  return { ...a, secreto, respaldo: act.body.data.codigos_respaldo };
}
async function entrarAdmin(a, codigo) {
  await liberarPeriodo('plataforma_admins', a.id);
  const l = await pedir('POST', '/api/motiq/login', { email: a.email, password: clave });
  assert.equal(l.body.data?.requiere_2fa, true, JSON.stringify(l.body));
  return pedir('POST', '/api/motiq/login/verificar', { token_parcial: l.body.data.token_parcial, codigo: codigo ?? totp.codigoPara(a.secreto, ahora()) });
}

async function nuevoTaller(nombre) {
  const slug = `t16-${nombre.toLowerCase()}-${sello}`;
  const r = await pedir('POST', '/api/onboarding', { nombre: `Taller ${nombre}`, slug, tipos: ['moto'], provincia: 'Guanacaste', canton: 'Liberia', admin: { nombre: 'Admin', email: `${slug}@prueba.test`, password: clave } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return { nombre, id: r.body.data.taller.id };
}

test.before(async () => {
  if (!url) return;
  ({ pool } = require('../src/db/pool'));
  // Base limpia: el script recorre TODAS las filas y las cuentas tienen que ser exactas.
  await pool.nativo.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public');
  await require('../src/db/migrar').migrar({ log: () => {} });
  const mailer = require('../src/services/mailer');
  for (const key of Object.keys(mailer)) if (key.startsWith('enviar')) mailer[key] = async () => {};
  const app = express();
  app.use(express.json());
  for (const ruta of ['auth', 'onboarding', 'motiq']) app.use(`/api/${ruta}`, require(`../src/routes/${ruta}.routes`));
  server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  base = `http://127.0.0.1:${server.address().port}`;
  talleres.A = await nuevoTaller('A');
  talleres.B = await nuevoTaller('B');
});
test.beforeEach(() => { process.env.TOTP_CLAVE = CLAVE; });
test.after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  if (pool) await pool.end();
});

t('migración 0016: la columna admite el valor cifrado', async () => {
  const [filas] = await q(
    `SELECT table_name, character_maximum_length AS largo FROM information_schema.columns
      WHERE column_name = 'totp_secret' AND table_name IN ('usuarios', 'plataforma_admins') ORDER BY table_name`
  );
  assert.deepEqual(filas.map(f => [f.table_name, Number(f.largo)]), [['plataforma_admins', 255], ['usuarios', 255]]);
});

for (const nombre of ['A', 'B']) {
  const tl = () => talleres[nombre];

  t(`personal (${nombre}): alta, activación y login con 2FA sobre el secreto cifrado`, async () => {
    const u = await staffCon2fa(tl());
    const v = await entrarStaff(u);
    assert.equal(v.status, 200, JSON.stringify(v.body));
    assert.ok(v.body.data.token);
    // Un código equivocado sigue sin entrar.
    const malo = await entrarStaff(u, String((Number(totp.codigoPara(u.secreto, ahora())) + 1) % 1e6).padStart(6, '0'));
    assert.equal(malo.status, 401);
  });

  t(`personal (${nombre}): un secreto viejo en claro se sigue leyendo y se re-cifra al entrar`, async () => {
    const secreto = totp.generarSecreto();
    const u = { ...(await personal(tl(), { secreto, activado: true })), secreto };
    assert.equal(await guardado('usuarios', u.id), secreto);
    const v = await entrarStaff(u);
    assert.equal(v.status, 200, JSON.stringify(v.body));
    cifradoDe(await guardado('usuarios', u.id), secreto);
    // Y con el valor ya cifrado, el siguiente ingreso también entra.
    assert.equal((await entrarStaff(u)).status, 200);
  });

  t(`personal (${nombre}): una clave pendiente vieja en claro se activa y queda cifrada`, async () => {
    const secreto = totp.generarSecreto();
    const u = await personal(tl(), { secreto, activado: false });
    const { token } = await loginStaff(u.email);
    const a = await pedir('POST', '/api/auth/2fa/activar', { codigo: totp.codigoPara(secreto, ahora()) }, token);
    assert.equal(a.status, 200, JSON.stringify(a.body));
    cifradoDe(await guardado('usuarios', u.id), secreto);
  });

  t(`personal (${nombre}): con otra TOTP_CLAVE el código de la app no entra, el de respaldo sí`, async () => {
    const u = await staffCon2fa(tl());
    process.env.TOTP_CLAVE = OTRA_CLAVE;
    const errores = [];
    const original = console.error;
    console.error = (m) => errores.push(String(m));
    let app, respaldo;
    try {
      app = await entrarStaff(u);
      respaldo = await entrarStaff(u, u.respaldo[0]);
    } finally {
      console.error = original;
    }
    assert.equal(app.status, 401, JSON.stringify(app.body));
    assert.equal(respaldo.status, 200, JSON.stringify(respaldo.body));
    assert.ok(errores.some(m => /TOTP_CLAVE no es la que lo cifró/.test(m)), errores.join('\n'));
    // El valor guardado no se tocó: con la clave correcta vuelve a servir.
    process.env.TOTP_CLAVE = CLAVE;
    cifradoDe(await guardado('usuarios', u.id), u.secreto);
    assert.equal((await entrarStaff(u)).status, 200);
  });
}

t('plataforma: configurar, activar y login con 2FA sobre el secreto cifrado', async () => {
  const a = await adminCon2fa();
  const v = await entrarAdmin(a);
  assert.equal(v.status, 200, JSON.stringify(v.body));
  assert.ok(v.body.data.token);
});

t('plataforma: un secreto viejo en claro se sigue leyendo y se re-cifra al entrar', async () => {
  const secreto = totp.generarSecreto();
  const a = { ...(await admin({ secreto, activado: true })), secreto };
  const v = await entrarAdmin(a);
  assert.equal(v.status, 200, JSON.stringify(v.body));
  cifradoDe(await guardado('plataforma_admins', a.id), secreto);
  assert.equal((await entrarAdmin(a)).status, 200);
});

t('plataforma: una clave pendiente vieja en claro se activa y queda cifrada', async () => {
  const secreto = totp.generarSecreto();
  const a = await admin({ secreto, activado: false });
  const l = await pedir('POST', '/api/motiq/login', { email: a.email, password: clave });
  const act = await pedir('POST', '/api/motiq/login/activar', { token_parcial: l.body.data.token_parcial, codigo: totp.codigoPara(secreto, ahora()) });
  assert.equal(act.status, 200, JSON.stringify(act.body));
  cifradoDe(await guardado('plataforma_admins', a.id), secreto);
});

t('plataforma: con otra TOTP_CLAVE solo entra el código de respaldo', async () => {
  const a = await adminCon2fa();
  process.env.TOTP_CLAVE = OTRA_CLAVE;
  const original = console.error;
  console.error = () => {};
  let app, respaldo;
  try {
    app = await entrarAdmin(a);
    respaldo = await entrarAdmin(a, a.respaldo[0]);
  } finally {
    console.error = original;
  }
  assert.equal(app.status, 401, JSON.stringify(app.body));
  assert.equal(respaldo.status, 200, JSON.stringify(respaldo.body));
});

t('sin TOTP_CLAVE el alta sigue funcionando en claro (el merge no rompe el login)', async () => {
  delete process.env.TOTP_CLAVE;
  const u = await personal(talleres.A);
  const { token } = await loginStaff(u.email);
  const s = await pedir('POST', '/api/auth/2fa/setup', {}, token);
  assert.equal(s.status, 200, JSON.stringify(s.body));
  const secreto = s.body.data.secreto;
  vistos.add(secreto);
  assert.equal(await guardado('usuarios', u.id), secreto);
  const a = await pedir('POST', '/api/auth/2fa/activar', { codigo: totp.codigoPara(secreto, ahora()) }, token);
  assert.equal(a.status, 200, JSON.stringify(a.body));
  assert.equal((await entrarStaff({ ...u, secreto })).status, 200);
  // Cuando llega la clave, el siguiente ingreso lo cifra.
  process.env.TOTP_CLAVE = CLAVE;
  assert.equal((await entrarStaff({ ...u, secreto })).status, 200);
  cifradoDe(await guardado('usuarios', u.id), secreto);
});

t('script cifrar-totp: cifra todo lo que queda en claro y es idempotente', async () => {
  // Filas viejas en claro en las dos tablas y los dos talleres, activas y pendientes.
  const enClaro = [];
  for (const tl of [talleres.A, talleres.B]) {
    for (const activado of [true, false]) {
      const secreto = totp.generarSecreto();
      enClaro.push({ tabla: 'usuarios', id: (await personal(tl, { secreto, activado })).id, secreto });
    }
  }
  for (const activado of [true, false]) {
    const secreto = totp.generarSecreto();
    enClaro.push({ tabla: 'plataforma_admins', id: (await admin({ secreto, activado })).id, secreto });
  }
  const contar = async () => {
    const [[u]] = await q("SELECT COUNT(*) AS n FROM usuarios WHERE totp_secret IS NOT NULL AND totp_secret NOT LIKE 'v1:%'");
    const [[p]] = await q("SELECT COUNT(*) AS n FROM plataforma_admins WHERE totp_secret IS NOT NULL AND totp_secret NOT LIKE 'v1:%'");
    return { usuarios: Number(u.n), plataforma_admins: Number(p.n) };
  };
  const antes = await contar();
  assert.deepEqual(antes, { usuarios: 4, plataforma_admins: 2 });

  // Simular no escribe.
  const sim = await cifrarTodo(pool, { simular: true });
  assert.equal(sim.usuarios.cifrados, 4);
  assert.deepEqual(await contar(), antes);

  const primera = await cifrarTodo(pool);
  assert.equal(primera.usuarios.cifrados, 4);
  assert.equal(primera.plataforma_admins.cifrados, 2);
  assert.deepEqual(await contar(), { usuarios: 0, plataforma_admins: 0 });
  const valores = [];
  for (const f of enClaro) {
    const v = await guardado(f.tabla, f.id);
    cifradoDe(v, f.secreto);
    valores.push(v);
  }

  // Segunda corrida: no toca nada, ni siquiera re-cifra con otro iv.
  const segunda = await cifrarTodo(pool);
  for (const tabla of ['usuarios', 'plataforma_admins']) {
    assert.equal(segunda[tabla].cifrados, 0);
    assert.equal(segunda[tabla].ya_cifrados, primera[tabla].cifrados + primera[tabla].ya_cifrados);
    assert.deepEqual(segunda[tabla].ilegibles, []);
  }
  for (const [i, f] of enClaro.entries()) assert.equal(await guardado(f.tabla, f.id), valores[i]);

  // Y lo cifrado por el script entra por el login real.
  const u = enClaro.find(f => f.tabla === 'usuarios');
  const [[fila]] = await q('SELECT email, totp_activado FROM usuarios WHERE id = ?', [u.id]);
  if (Number(fila.totp_activado) === 1) {
    assert.equal((await entrarStaff({ id: u.id, email: fila.email, secreto: u.secreto })).status, 200);
  }
});

t('script cifrar-totp: por consola, sin clave sale con error y con otra clave avisa los ilegibles', async () => {
  const script = path.join(__dirname, '../scripts/cifrar-totp.js');
  const correr = (extra) => spawnSync(process.execPath, [script], {
    env: { ...process.env, DATABASE_URL: url, ...extra }, encoding: 'utf8',
  });
  const sinClave = correr({ TOTP_CLAVE: '' });
  assert.equal(sinClave.status, 1, sinClave.stdout + sinClave.stderr);
  assert.match(sinClave.stderr, /Falta TOTP_CLAVE/);

  const bien = correr({ TOTP_CLAVE: CLAVE });
  assert.equal(bien.status, 0, bien.stdout + bien.stderr);
  assert.match(bien.stdout, /usuarios: \d+ con secreto · 0 cifrados ahora/);
  assert.match(bien.stdout, /plataforma_admins: \d+ con secreto · 0 cifrados ahora/);

  const otra = correr({ TOTP_CLAVE: OTRA_CLAVE });
  assert.equal(otra.status, 1, otra.stdout + otra.stderr);
  assert.match(otra.stdout, /NO se pueden descifrar con esta clave/);
  // La salida nunca muestra un secreto.
  for (const s of vistos) assert.ok(!(bien.stdout + otra.stdout + otra.stderr).includes(s));
});

t('después de cifrar, ningún secreto queda en claro en la base', async () => {
  await cifrarTodo(pool);
  for (const tabla of ['usuarios', 'plataforma_admins']) {
    const [filas] = await q(`SELECT id, totp_secret FROM ${tabla} WHERE totp_secret IS NOT NULL`);
    assert.ok(filas.length > 0);
    for (const f of filas) assert.ok(estaCifrado(f.totp_secret), `${tabla} ${f.id} sigue en claro`);
  }
  assert.ok(vistos.size >= 10);
  for (const s of vistos) {
    const [[u]] = await q("SELECT COUNT(*) AS n FROM usuarios WHERE totp_secret LIKE ?", [`%${s}%`]);
    const [[p]] = await q("SELECT COUNT(*) AS n FROM plataforma_admins WHERE totp_secret LIKE ?", [`%${s}%`]);
    assert.equal(Number(u.n) + Number(p.n), 0, 'un secreto quedó en claro');
  }
});
