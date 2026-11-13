// Regresiones B-06 y QA34-02 de la plataforma: la cuenta de Motiq, que ve todos los
// talleres, entra con contraseña y segundo factor, y sus sesiones se pueden revocar.
// Routers, middleware y SQL reales contra Postgres; solo se sustituye el correo.
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');

const url = process.env.PG_TEST_URL;
if (url && !/\/\w+_test(\?|$)/.test(url)) throw new Error('Se requiere una base propia terminada en _test');
if (url) process.env.DATABASE_URL = url;
process.env.JWT_SECRET = 'prueba-local-plataforma-t05';
const t = (nombre, fn) => test(nombre, { skip: !url && 'sin PG_TEST_URL' }, fn);

const totp = require('../src/utils/totp');
const clave = 'UnaClaveDePlataforma123';
const nuevaClave = 'OtraClaveDePlataforma456';
const hash = bcrypt.hashSync(clave, 4);
let pool, server, base, numero = 0;

async function pedir(method, ruta, body, token) {
  const r = await fetch(base + ruta, {
    method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: await r.json() };
}
const panel = token => pedir('GET', '/api/motiq/resumen', null, token);
const ahora = () => Math.floor(Date.now() / 1000 / totp.PERIODO);

// Una cuenta de plataforma nueva, sin segundo factor (como la que existe hoy).
async function cuenta() {
  const email = `motiq${++numero}@prueba.test`;
  const [[a]] = await pool.query("INSERT INTO plataforma_admins (nombre, email, password_hash, activo) VALUES ('Motiq', ?, ?, 1) RETURNING id", [email, hash]);
  return { id: a.id, email };
}
// La misma cuenta, ya con el segundo factor configurado de primera vez.
async function cuentaCon2fa() {
  const c = await cuenta();
  const r = await pedir('POST', '/api/motiq/login', { email: c.email, password: clave });
  const parcial = r.body.data.token_parcial;
  const conf = await pedir('POST', '/api/motiq/login/configurar', { token_parcial: parcial });
  const secreto = conf.body.data.secreto;
  const act = await pedir('POST', '/api/motiq/login/activar', { token_parcial: parcial, codigo: totp.codigoPara(secreto, ahora()) });
  assert.equal(act.status, 200, JSON.stringify(act.body));
  return { ...c, secreto, token: act.body.data.token, respaldo: act.body.data.codigos_respaldo };
}
// Login completo con el código de la app. El anti-replay no deja usar dos veces el
// mismo período: la prueba entra varias veces seguidas, así que se libera antes.
async function entrar(c, password = clave) {
  await pool.query('UPDATE plataforma_admins SET totp_ultimo_contador = NULL WHERE id = ?', [c.id]);
  const r = await pedir('POST', '/api/motiq/login', { email: c.email, password });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.data.requiere_2fa, true, JSON.stringify(r.body));
  const v = await pedir('POST', '/api/motiq/login/verificar', { token_parcial: r.body.data.token_parcial, codigo: totp.codigoPara(c.secreto, ahora()) });
  assert.equal(v.status, 200, JSON.stringify(v.body));
  return v.body.data.token;
}

test.before(async () => {
  if (!url) return;
  ({ pool } = require('../src/db/pool'));
  await pool.nativo.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public');
  await require('../src/db/migrar').migrar({ log: () => {} });
  const mailer = require('../src/services/mailer');
  for (const key of Object.keys(mailer)) if (key.startsWith('enviar')) mailer[key] = async () => {};
  const app = express();
  app.use(express.json());
  app.use('/api/motiq', require('../src/routes/motiq.routes'));
  server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  if (pool) await pool.end();
});

t('B-06: la contraseña sola no abre el panel y obliga a configurar el segundo factor', async () => {
  const c = await cuenta();
  const r = await pedir('POST', '/api/motiq/login', { email: c.email, password: clave });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.data.token, undefined, 'con la contraseña sola no hay sesión');
  assert.equal(r.body.data.requiere_configurar_2fa, true);
  const parcial = r.body.data.token_parcial;
  assert.ok(parcial);
  // El token parcial no vale como sesión del panel.
  assert.notEqual((await panel(parcial)).status, 200);
  // Tampoco sirve para canjear un código antes de configurar.
  assert.equal((await pedir('POST', '/api/motiq/login/verificar', { token_parcial: parcial, codigo: '000000' })).status, 401);

  const conf = await pedir('POST', '/api/motiq/login/configurar', { token_parcial: parcial });
  assert.equal(conf.status, 200, JSON.stringify(conf.body));
  assert.match(conf.body.data.uri, /^otpauth:\/\/totp\/Motiq/);
  assert.ok(conf.body.data.secreto_legible);
  const secreto = conf.body.data.secreto;
  assert.equal((await pedir('POST', '/api/motiq/login/activar', { token_parcial: parcial, codigo: '000000' })).status, 401);
  const act = await pedir('POST', '/api/motiq/login/activar', { token_parcial: parcial, codigo: totp.codigoPara(secreto, ahora()) });
  assert.equal(act.status, 200, JSON.stringify(act.body));
  assert.equal(act.body.data.codigos_respaldo.length, 8);
  assert.equal((await panel(act.body.data.token)).status, 200);
  // Ya activado, el token parcial no reconfigura (nadie con solo la contraseña le cambia la app).
  assert.equal((await pedir('POST', '/api/motiq/login/configurar', { token_parcial: parcial })).status, 400);
  const [[fila]] = await pool.query('SELECT totp_activado, totp_backup FROM plataforma_admins WHERE id = ?', [c.id]);
  assert.equal(Number(fila.totp_activado), 1);
  assert.ok(!String(fila.totp_backup).includes(act.body.data.codigos_respaldo[0]), 'en la base solo quedan hashes');
});

t('B-06: con el segundo factor activo, el código es obligatorio, de un solo uso, y vale el de respaldo', async () => {
  const c = await cuentaCon2fa();
  await pool.query('UPDATE plataforma_admins SET totp_ultimo_contador = NULL WHERE id = ?', [c.id]);
  const r = await pedir('POST', '/api/motiq/login', { email: c.email, password: clave });
  assert.equal(r.body.data.requiere_2fa, true);
  assert.equal(r.body.data.token, undefined);
  const parcial = r.body.data.token_parcial;
  // Un parcial de verificación no sirve para reconfigurar la app.
  assert.equal((await pedir('POST', '/api/motiq/login/configurar', { token_parcial: parcial })).status, 400);
  const malo = String((Number(totp.codigoPara(c.secreto, ahora())) + 1) % 1e6).padStart(6, '0');
  assert.equal((await pedir('POST', '/api/motiq/login/verificar', { token_parcial: parcial, codigo: malo })).status, 401);
  const codigo = totp.codigoPara(c.secreto, ahora());
  const v = await pedir('POST', '/api/motiq/login/verificar', { token_parcial: parcial, codigo });
  assert.equal(v.status, 200, JSON.stringify(v.body));
  assert.equal((await panel(v.body.data.token)).status, 200);
  // El mismo código no se reusa.
  assert.equal((await pedir('POST', '/api/motiq/login/verificar', { token_parcial: parcial, codigo })).status, 401);
  // Un código de respaldo entra una sola vez.
  const respaldo = c.respaldo[0];
  const b = await pedir('POST', '/api/motiq/login/verificar', { token_parcial: parcial, codigo: respaldo.toLowerCase() });
  assert.equal(b.status, 200, JSON.stringify(b.body));
  assert.equal((await pedir('POST', '/api/motiq/login/verificar', { token_parcial: parcial, codigo: respaldo })).status, 401);
  // Un parcial firmado a mano con otro tipo, o vencido, no vale.
  const vencido = jwt.sign({ id: c.id, tipo: 'plataforma_2fa', paso: 'verificar', cv: 0 }, process.env.JWT_SECRET, { expiresIn: -10 });
  assert.equal((await pedir('POST', '/api/motiq/login/verificar', { token_parcial: vencido, codigo: totp.codigoPara(c.secreto, ahora() + 1) })).status, 401);
});

t('B-06: un token de plataforma sin sesión persistida (el formato viejo) ya no entra', async () => {
  const c = await cuentaCon2fa();
  const viejo = jwt.sign({ id: c.id, tipo: 'plataforma', nombre: 'Motiq', email: c.email }, process.env.JWT_SECRET, { expiresIn: '8h' });
  assert.equal((await panel(viejo)).status, 401);
  const inventado = jwt.sign({ id: c.id, tipo: 'plataforma', nombre: 'Motiq', email: c.email, sid: 'a'.repeat(32) }, process.env.JWT_SECRET, { expiresIn: '8h' });
  assert.equal((await panel(inventado)).status, 401);
});

t('B-06: salir cierra esa sesión aunque alguien haya guardado el token', async () => {
  const c = await cuentaCon2fa();
  const otra = await entrar(c);
  const s = await pedir('POST', '/api/motiq/salir', null, c.token);
  assert.equal(s.status, 200, JSON.stringify(s.body));
  assert.equal((await panel(c.token)).status, 401);
  assert.equal((await panel(otra)).status, 200, 'las otras sesiones siguen');
});

t('B-06: cambiar la contraseña corta todas las demás sesiones y deja la del cambio', async () => {
  const c = await cuentaCon2fa();
  const otra = await entrar(c);
  const r = await pedir('POST', '/api/motiq/password', { actual: clave, nueva: nuevaClave }, c.token);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal((await panel(otra)).status, 401, 'la otra sesión sale');
  assert.equal((await panel(c.token)).status, 200, 'la sesión desde la que cambió sigue');
  assert.equal((await pedir('POST', '/api/motiq/login', { email: c.email, password: clave })).status, 401);
  assert.equal((await panel(await entrar(c, nuevaClave))).status, 200);
});

t('B-06: desactivar la cuenta corta sus sesiones al instante y reactivarla no las revive', async () => {
  const jefe = await cuentaCon2fa();
  const c = await cuentaCon2fa();
  assert.equal((await panel(c.token)).status, 200);
  assert.equal((await pedir('PATCH', `/api/motiq/admins/${c.id}`, { activo: false }, jefe.token)).status, 200);
  assert.equal((await panel(c.token)).status, 401);
  assert.equal((await pedir('PATCH', `/api/motiq/admins/${c.id}`, { activo: true }, jefe.token)).status, 200);
  assert.equal((await panel(c.token)).status, 401, 'la sesión de antes de desactivar no vuelve');
  assert.equal((await panel(await entrar(c))).status, 200);
});

// ── QA34-02: login con la contraseña vieja contra cambio o recuperación ──
// Detiene el login justo DESPUÉS de que bcrypt aceptó la contraseña.
const bcryptReal = bcrypt.compare;
function pausarTrasBcrypt() {
  let llego, soltar;
  const llegada = new Promise(r => { llego = r; });
  const suelta = new Promise(r => { soltar = r; });
  bcrypt.compare = async function (...args) {
    const ok = await bcryptReal.apply(this, args);
    if (ok) { bcrypt.compare = bcryptReal; llego(); await suelta; }
    return ok;
  };
  let tiempo;
  const aTiempo = Promise.race([llegada, new Promise((_, rej) => { tiempo = setTimeout(() => rej(new Error('no llegó: bcrypt del login')), 5000); })])
    .finally(() => clearTimeout(tiempo));
  return { llegada: aTiempo, soltar: () => { bcrypt.compare = bcryptReal; soltar(); } };
}
async function loginContraCambio(c, cambio) {
  await pool.query('UPDATE plataforma_admins SET totp_ultimo_contador = NULL WHERE id = ?', [c.id]);
  const { llegada, soltar } = pausarTrasBcrypt();
  try {
    const login = pedir('POST', '/api/motiq/login', { email: c.email, password: clave });
    await llegada;
    await cambio();
    soltar();
    const r = await login;
    assert.equal(r.status, 200, JSON.stringify(r.body));
    return pedir('POST', '/api/motiq/login/verificar', { token_parcial: r.body.data.token_parcial, codigo: totp.codigoPara(c.secreto, ahora()) });
  } finally { soltar(); }
}

t('QA34-02: plataforma: un login con la contraseña vieja que termina después del cambio no abre sesión', async () => {
  const c = await cuentaCon2fa();
  const tarde = await loginContraCambio(c, async () => {
    const r = await pedir('POST', '/api/motiq/password', { actual: clave, nueva: nuevaClave }, c.token);
    assert.equal(r.status, 200, JSON.stringify(r.body));
  });
  assert.equal(tarde.status, 401, JSON.stringify(tarde.body));
  assert.equal((await panel(c.token)).status, 200);
});

t('QA34-02: plataforma: un login con la contraseña vieja que termina después de la recuperación no abre sesión', async () => {
  const { restablecerCuenta } = require('../src/utils/sesiones-plataforma');
  const c = await cuentaCon2fa();
  const tarde = await loginContraCambio(c, () => restablecerCuenta({ nombre: 'Motiq', email: c.email, hash: bcrypt.hashSync(nuevaClave, 4) }));
  assert.equal(tarde.status, 401, JSON.stringify(tarde.body));
  assert.equal((await panel(c.token)).status, 401, 'recuperar la cuenta corta las sesiones abiertas');
  assert.equal((await panel(await entrar(c, nuevaClave))).status, 200, 'el segundo factor se conserva');
});

t('QA34-02: plataforma: una sesión abierta con la versión de credenciales vieja no autoriza', async () => {
  const c = await cuentaCon2fa();
  // Lo que deja un login que pasó todos los chequeos y abrió la sesión justo después
  // del cambio: la fila de la sesión con la versión que leyó junto con el hash.
  const [[s]] = await pool.query('SELECT sid FROM plataforma_sesiones WHERE admin_id = ? ORDER BY id DESC LIMIT 1', [c.id]);
  await pool.query('UPDATE plataforma_admins SET credenciales_version = credenciales_version + 1 WHERE id = ?', [c.id]);
  assert.ok(s.sid);
  assert.equal((await panel(c.token)).status, 401);
});

t('recuperar con reinicio del segundo factor obliga a configurarlo de nuevo', async () => {
  const { restablecerCuenta } = require('../src/utils/sesiones-plataforma');
  const c = await cuentaCon2fa();
  const r = await restablecerCuenta({ nombre: 'Motiq', email: c.email, hash: bcrypt.hashSync(nuevaClave, 4), reiniciar2fa: true });
  assert.equal(r.creado, false);
  const l = await pedir('POST', '/api/motiq/login', { email: c.email, password: nuevaClave });
  assert.equal(l.body.data.requiere_configurar_2fa, true, JSON.stringify(l.body));
  assert.equal((await panel(c.token)).status, 401);
});
