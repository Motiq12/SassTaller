// QA-POST3 (QP3-01 a QP3-06): las carreras y validaciones que quedaron abiertas
// después de T12 y de QA34-02.
//
// Igual que pg-carreras-codigos-cupos.test.js, las carreras se fuerzan de forma
// determinista: la primera petición se detiene justo antes de mandar una consulta SQL
// concreta, con ella detenida corre la segunda, y recién después se suelta la primera.
// Routers, auth, sesiones y SQL son los reales contra Postgres; solo se sustituyen los
// envíos de correo. Cada caso corre en DOS talleres.
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');

const url = process.env.PG_TEST_URL;
if (url && !/\/\w+_test(\?|$)/.test(url)) throw new Error('PG_TEST_URL debe terminar en _test');
if (url) process.env.DATABASE_URL = url;
process.env.JWT_SECRET = 'solo-tests-carreras-t15-sin-secretos-reales';
process.env.RESEND_API_KEY = '';
delete process.env.TURNSTILE_SECRET;
const t = (nombre, fn) => test(nombre, { skip: !url && 'sin PG_TEST_URL' }, fn);

const totp = require('../src/utils/totp');
const { fechaLocalISO } = require('../src/utils/fecha');

const clave = 'UnaClaveSegura123';
const otraClave = 'OtraClaveSegura456';
const hash = bcrypt.hashSync(clave, 4);
const sello = `${Date.now()}-${process.pid}`;
let pool, server, base, secuencia = 0;
const talleres = {};

// ── Trampa SQL: detiene la próxima consulta cuyo texto coincida con `patron` ──
const { Client } = require('pg');
const queryOriginal = Client.prototype.query;
let trampa = null;
Client.prototype.query = function (config, values, cb) {
  const texto = typeof config === 'string' ? config : config && config.text;
  const tr = trampa;
  if (tr && typeof texto === 'string' && tr.patron.test(texto)) {
    trampa = null;
    tr.llego();
    const seguir = () => queryOriginal.call(this, config, values, cb);
    if (typeof cb === 'function' || typeof values === 'function') { tr.suelta.then(seguir); return undefined; }
    return tr.suelta.then(seguir);
  }
  return queryOriginal.call(this, config, values, cb);
};

function aTiempo(promesa, que) {
  let reloj;
  return Promise.race([promesa, new Promise((_, rej) => { reloj = setTimeout(() => rej(new Error(`no llegó: ${que}`)), 5000); })])
    .finally(() => clearTimeout(reloj));
}

// Espera a que la petición responda o a que una consulta quede esperando un bloqueo.
async function respondeOBloquea(promesa) {
  let listo = false;
  promesa.then(() => { listo = true; }, () => { listo = true; });
  for (let i = 0; i < 400; i++) {
    if (listo) return 'respondio';
    const { rows } = await pool.nativo.query(
      "SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'"
    );
    if (rows[0].n > 0) return 'bloqueada';
    await new Promise(r => setTimeout(r, 10));
  }
  throw new Error('la segunda petición ni respondió ni quedó esperando un bloqueo');
}

// Carrera SQL: `primera` se detiene en `patron`; con ella detenida corre `segunda`.
async function carreraSql(patron, primera, segunda) {
  let llego, soltar;
  const llegada = new Promise(r => { llego = r; });
  const suelta = new Promise(r => { soltar = r; });
  trampa = { patron, llego, suelta };
  try {
    const p1 = primera();
    await aTiempo(llegada, String(patron));
    const p2 = segunda();
    const fase = await respondeOBloquea(p2);
    soltar();
    const [r1, r2] = await Promise.all([p1, p2]);
    return { fase, r1, r2 };
  } finally {
    trampa = null;
    soltar();
  }
}

async function pedir(method, ruta, body, token) {
  const r = await fetch(base + ruta, {
    method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: await r.json() };
}
const q = (...a) => pool.query(...a);
const estados = (...rs) => rs.map(r => r.status).sort((a, b) => a - b);
const ahora = () => Math.floor(Date.now() / 1000 / totp.PERIODO);

async function entrar(email, password = clave) {
  const r = await pedir('POST', '/api/auth/login', { email, password });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.data;
}
async function personal(tl, rol) {
  const email = `t15-${sello}-${rol}-${++secuencia}@prueba.test`;
  const [[u]] = await q(
    'INSERT INTO usuarios (tenant_id, nombre, email, password_hash, rol, email_verificado) VALUES (?, ?, ?, ?, ?, 1) RETURNING id',
    [tl.id, `Persona ${secuencia}`, email, hash, rol]
  );
  return { id: u.id, email };
}
async function cliente(tl) {
  const email = `t15-cliente-${sello}-${++secuencia}@prueba.test`;
  const [[c]] = await q(
    `INSERT INTO clientes (tenant_id, nombre, apellido, telefono, email, password_hash, email_verificado)
     VALUES (?, 'Ana', 'Mora', '88881111', ?, ?, 1) RETURNING id`,
    [tl.id, email, hash]
  );
  const [[v]] = await q("INSERT INTO vehiculos (tenant_id, cliente_id, placa, marca, modelo, tipo) VALUES (?, ?, ?, 'Honda', 'Prueba', 'moto') RETURNING id",
    [tl.id, c.id, `Q${process.pid % 1000}${secuencia}`]);
  const token = jwt.sign({ id: c.id, tipo: 'cliente', tenant_id: tl.id }, process.env.JWT_SECRET, { expiresIn: '1h' });
  return { id: c.id, email, vehiculoId: v.id, token };
}

// Días hábiles futuros (lunes a viernes, de 8 a 17 con la configuración por defecto),
// dentro de la anticipación permitida. Cada caso de cupo usa sus propios días.
const DIAS = [];
for (let n = 3; n <= 27; n++) {
  const f = fechaLocalISO(-6, n);
  const dow = new Date(`${f}T12:00:00Z`).getUTCDay();
  if (dow >= 1 && dow <= 5) DIAS.push(f);
}
let diaLibre = 0;
const otroDia = () => DIAS[diaLibre++ % DIAS.length];

async function nuevoTaller(nombre) {
  const slug = `t15-${nombre.toLowerCase()}-${sello}`;
  const r = await pedir('POST', '/api/onboarding', { nombre: `Taller ${nombre}`, slug, tipos: ['moto'], provincia: 'Guanacaste', canton: 'Liberia', admin: { nombre: 'Admin', email: `${slug}@prueba.test`, password: clave } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const tl = { nombre, slug, id: r.body.data.taller.id, admin: r.body.data.token };
  // Cupo de UNA cita por hora.
  const [[cfg]] = await q('SELECT id FROM configuracion WHERE tenant_id = ?', [tl.id]);
  if (cfg) await q('UPDATE configuracion SET max_citas_hora = 1 WHERE tenant_id = ?', [tl.id]);
  else await q('INSERT INTO configuracion (tenant_id, id, max_citas_hora) VALUES (?, 1, 1)', [tl.id]);
  require('../src/utils/configuracion').clearCache();
  const [[s]] = await q('SELECT id FROM sucursales WHERE tenant_id = ? ORDER BY id LIMIT 1', [tl.id]);
  tl.sede = s.id;
  const [[s2]] = await q("INSERT INTO sucursales (tenant_id, nombre, activa, orden) VALUES (?, 'Segunda', 1, 2) RETURNING id", [tl.id]);
  tl.sede2 = s2.id;
  const [[serv]] = await q('SELECT nombre FROM servicios WHERE tenant_id = ? AND activo = 1 ORDER BY orden LIMIT 1', [tl.id]);
  tl.servicio = serv.nombre;
  const rec = await personal(tl, 'recepcion');
  tl.recepcion = (await entrar(rec.email)).token;
  return tl;
}

test.before(async () => {
  if (!url) return;
  ({ pool } = require('../src/db/pool'));
  await require('../src/db/migrar').migrar({ log: () => {} });
  const mailer = require('../src/services/mailer');
  for (const key of Object.keys(mailer)) if (key.startsWith('enviar')) mailer[key] = async () => {};
  const app = express();
  app.use(express.json());
  for (const ruta of ['auth', 'onboarding', 'portal', 'citas', 'admin', 'motiq']) {
    app.use(`/api/${ruta}`, require(`../src/routes/${ruta}.routes`));
  }
  server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  base = `http://127.0.0.1:${server.address().port}`;
  talleres.A = await nuevoTaller('A');
  talleres.B = await nuevoTaller('B');
});
test.after(async () => {
  Client.prototype.query = queryOriginal;
  if (server) await new Promise(resolve => server.close(resolve));
  if (pool) await pool.end();
});

// ═══════════════════════ QP3-01: alta del 2FA del personal ═══════════════════════
for (const nombre of ['A', 'B']) {
  const tl = () => talleres[nombre];

  t(`QP3-01 [taller ${nombre}]: un setup tardío no apaga el 2FA que otra petición acaba de activar`, async () => {
    const u = await personal(tl(), 'admin');
    const { token } = await entrar(u.email);
    const setup = () => pedir('POST', '/api/auth/2fa/setup', {}, token);
    // La primera se detiene justo antes de su UPDATE (ya leyó "inactivo"); mientras
    // tanto, la misma cuenta configura y activa con el código correcto.
    const { r1, r2 } = await carreraSql(/SET totp_secret = /, setup, async () => {
      const s = await setup();
      assert.equal(s.status, 200, JSON.stringify(s.body));
      return pedir('POST', '/api/auth/2fa/activar', { codigo: totp.codigoPara(s.body.data.secreto, ahora()) }, token);
    });
    assert.equal(r2.status, 200, JSON.stringify(r2.body));
    assert.equal(r1.status, 409, `el setup tardío respondió ${r1.status}: ${JSON.stringify(r1.body)}`);
    const [[fila]] = await q('SELECT totp_activado FROM usuarios WHERE id = ?', [u.id]);
    assert.equal(Number(fila.totp_activado), 1, 'el 2FA quedó apagado');
    // La contraseña sola ya no abre sesión.
    const login = await entrar(u.email);
    assert.equal(login.requiere_2fa, true, JSON.stringify(login));
    assert.equal(login.token, undefined);
  });

  t(`QP3-01 [taller ${nombre}]: una activación que leyó la clave vieja no activa la clave que otro setup reemplazó`, async () => {
    const u = await personal(tl(), 'admin');
    const { token } = await entrar(u.email);
    const s1 = await pedir('POST', '/api/auth/2fa/setup', {}, token);
    assert.equal(s1.status, 200, JSON.stringify(s1.body));
    const activar = () => pedir('POST', '/api/auth/2fa/activar', { codigo: totp.codigoPara(s1.body.data.secreto, ahora()) }, token);
    // La activación se detiene antes de su UPDATE; en el medio, otro setup cambia la clave.
    const { r1, r2 } = await carreraSql(/SET totp_activado = 1/, activar, () => pedir('POST', '/api/auth/2fa/setup', {}, token));
    assert.equal(r2.status, 200, JSON.stringify(r2.body));
    assert.equal(r1.status, 400, JSON.stringify(r1.body));
    const [[fila]] = await q('SELECT totp_activado, totp_secret FROM usuarios WHERE id = ?', [u.id]);
    assert.equal(Number(fila.totp_activado), 0);
    assert.equal(fila.totp_secret, r2.body.data.secreto, 'queda pendiente la clave del último setup');
  });
}

// Plataforma (motiq.routes.js): ya tenía la condición en el UPDATE; se deja la carrera
// como control de que el setup tardío no apaga la activación.
t('QP3-01 plataforma: configurar tarde no apaga el segundo factor recién activado', async () => {
  const email = `t15-motiq-${sello}@prueba.test`;
  const [[a]] = await q("INSERT INTO plataforma_admins (nombre, email, password_hash, activo) VALUES ('Motiq', ?, ?, 1) RETURNING id", [email, hash]);
  const login = await pedir('POST', '/api/motiq/login', { email, password: clave });
  assert.equal(login.status, 200, JSON.stringify(login.body));
  const parcial = login.body.data.token_parcial;
  const configurar = () => pedir('POST', '/api/motiq/login/configurar', { token_parcial: parcial });
  const { r1, r2 } = await carreraSql(/UPDATE plataforma_admins SET totp_secret = /, configurar, async () => {
    const c = await configurar();
    assert.equal(c.status, 200, JSON.stringify(c.body));
    return pedir('POST', '/api/motiq/login/activar', { token_parcial: parcial, codigo: totp.codigoPara(c.body.data.secreto, ahora()) });
  });
  assert.equal(r2.status, 200, JSON.stringify(r2.body));
  assert.equal(r1.status, 400, JSON.stringify(r1.body));
  const [[fila]] = await q('SELECT totp_activado FROM plataforma_admins WHERE id = ?', [a.id]);
  assert.equal(Number(fila.totp_activado), 1);
});

// ═══════════════════════ QP3-06: versión de credenciales coherente ═══════════════════════
for (const nombre of ['A', 'B']) {
  const tl = () => talleres[nombre];

  t(`QP3-06 [taller ${nombre}]: un pedido concurrente con el cambio de contraseña propio no expulsa la sesión que lo hizo`, async () => {
    const u = await personal(tl(), 'admin');
    const { token } = await entrar(u.email);
    // El GET se detiene justo antes de leer la sesión (con la versión del usuario ya
    // leída, si se leen por separado); en el medio, la misma sesión cambia la contraseña,
    // lo que sube la versión del usuario y la de esa sesión juntas.
    const { r1, r2 } = await carreraSql(/^\s*SELECT\b[\s\S]*\bsesiones_personal\b/,
      () => pedir('GET', '/api/auth/perfil', null, token),
      () => pedir('PUT', '/api/admin/cuenta/password', { actual: clave, nueva: otraClave }, token));
    assert.equal(r2.status, 200, JSON.stringify(r2.body));
    assert.equal(r1.status, 200, `el pedido concurrente respondió ${r1.status}: ${JSON.stringify(r1.body)}`);
    // La sesión sigue valiendo; una sesión con la contraseña vieja, no.
    assert.equal((await pedir('GET', '/api/auth/perfil', null, token)).status, 200);
    assert.equal((await pedir('POST', '/api/auth/login', { email: u.email, password: clave })).status, 401);
  });
}

// ═══════════════════════ QP3-02 a QP3-05: agenda ═══════════════════════
async function cita(tl, c, fecha, hora, { sede = tl.sede, duracion = 1 } = {}) {
  const [[ci]] = await q(`INSERT INTO citas (tenant_id, cliente_id, vehiculo_id, sucursal_id, fecha, hora, motivo, estado, duracion_horas)
    VALUES (?, ?, ?, ?, ?, ?, 'Previa', 'agendado', ?) RETURNING id`, [tl.id, c.id, c.vehiculoId, sede, fecha, hora, duracion]);
  return ci.id;
}
const moverPortal = (tl, c, id, fecha, hora, sede = tl.sede) => pedir('PUT', `/api/portal/citas/${id}`,
  { vehiculo_id: c.vehiculoId, fecha, hora, servicios: [tl.servicio], sucursal_id: sede }, c.token);
const moverRecepcion = (tl, c, id, fecha, hora, sede = tl.sede) => pedir('PUT', `/api/citas/${id}`,
  { cliente_id: c.id, vehiculo_id: c.vehiculoId, fecha, hora, motivo: 'Movida', sucursal_id: sede }, tl.recepcion);
async function dondeEsta(id) {
  const [[c]] = await q("SELECT to_char(fecha, 'YYYY-MM-DD') AS fecha, to_char(hora, 'HH24:MI') AS hora, sucursal_id, duracion_horas FROM citas WHERE id = ?", [id]);
  return c;
}
// Lugares de 1 hora ocupados a esa hora en la sede, contando las citas largas.
async function ocupadas(tl, fecha, hora, sede = tl.sede) {
  const { paraTenant } = require('../src/db/tenant-db');
  const { agendaDia } = require('../src/utils/agenda');
  const { getConfig } = require('../src/utils/configuracion');
  const db = paraTenant(tl.id);
  const dia = await agendaDia(fecha, sede, await getConfig(db), { db });
  return dia.ocupacion[hora] || 0;
}

for (const nombre of ['A', 'B']) {
  const tl = () => talleres[nombre];

  t(`QP3-02 [taller ${nombre}]: dos reprogramaciones cruzadas entre días (A→B y B→A) no se traban: entran las dos`, async () => {
    const [diaA, diaB] = [otroDia(), otroDia()];
    const [c1, c2] = [await cliente(tl()), await cliente(tl())];
    const id1 = await cita(tl(), c1, diaA, '09:00');
    const id2 = await cita(tl(), c2, diaB, '09:00');
    // La primera se detiene después de contar el destino, justo antes de mover su cita.
    const res = await carreraSql(/UPDATE citas SET vehiculo_id = /,
      () => moverPortal(tl(), c1, id1, diaB, '11:00'),
      () => moverPortal(tl(), c2, id2, diaA, '11:00'));
    assert.deepEqual(estados(res.r1, res.r2), [200, 200], `respuestas ${res.r1.status} y ${res.r2.status}: ${JSON.stringify([res.r1.body, res.r2.body])}`);
    assert.equal(res.fase, 'bloqueada', 'la segunda tiene que esperar a la primera');
    assert.deepEqual([(await dondeEsta(id1)).fecha, (await dondeEsta(id2)).fecha], [diaB, diaA]);
  });

  t(`QP3-02 [taller ${nombre}]: dos reprogramaciones cruzadas entre sedes del mismo día no se traban: entran las dos`, async () => {
    const dia = otroDia();
    const [c1, c2] = [await cliente(tl()), await cliente(tl())];
    const id1 = await cita(tl(), c1, dia, '09:00', { sede: tl().sede });
    const id2 = await cita(tl(), c2, dia, '09:00', { sede: tl().sede2 });
    const res = await carreraSql(/UPDATE citas SET vehiculo_id = /,
      () => moverPortal(tl(), c1, id1, dia, '11:00', tl().sede2),
      () => moverPortal(tl(), c2, id2, dia, '11:00', tl().sede));
    assert.deepEqual(estados(res.r1, res.r2), [200, 200], `respuestas ${res.r1.status} y ${res.r2.status}: ${JSON.stringify([res.r1.body, res.r2.body])}`);
    assert.deepEqual([(await dondeEsta(id1)).sucursal_id, (await dondeEsta(id2)).sucursal_id], [tl().sede2, tl().sede]);
  });

  t(`QP3-03 [taller ${nombre}]: el portal mueve con la duración vigente si administración la alargó mientras tanto`, async () => {
    const [diaA, diaB] = [otroDia(), otroDia()];
    const [c1, c2] = [await cliente(tl()), await cliente(tl())];
    const id = await cita(tl(), c1, diaA, '09:00');
    await cita(tl(), c2, diaB, '10:00');
    // El portal ya leyó la cita (1 hora) y se detiene antes de tomar el primer candado;
    // administración la alarga a 2 horas en su día.
    const res = await carreraSql(/pg_advisory_xact_lock/,
      () => moverPortal(tl(), c1, id, diaB, '09:00'),
      () => pedir('PATCH', `/api/citas/${id}/duracion`, { duracion_horas: 2 }, tl().admin));
    assert.equal(res.r2.status, 200, JSON.stringify(res.r2.body));
    assert.equal(res.r1.status, 400, `el portal movió una cita de 2 horas sobre una hora llena: ${JSON.stringify(res.r1.body)}`);
    assert.equal(await ocupadas(tl(), diaB, '10:00'), 1, 'sobrecupo a las 10:00');
    assert.equal((await dondeEsta(id)).fecha, diaA);
  });

  t(`QP3-03 [taller ${nombre}]: alargar una cita que el portal movió mientras tanto cuenta su lugar nuevo`, async () => {
    const [diaA, diaB] = [otroDia(), otroDia()];
    const [c1, c2] = [await cliente(tl()), await cliente(tl())];
    const id = await cita(tl(), c1, diaA, '09:00');
    await cita(tl(), c2, diaB, '10:00');
    // Administración ya leyó la cita (día A) y se detiene antes del candado; el cliente
    // la mueve al día B a las 9:00.
    const res = await carreraSql(/pg_advisory_xact_lock/,
      () => pedir('PATCH', `/api/citas/${id}/duracion`, { duracion_horas: 2 }, tl().admin),
      () => moverPortal(tl(), c1, id, diaB, '09:00'));
    assert.equal(res.r2.status, 200, JSON.stringify(res.r2.body));
    assert.equal(res.r1.status, 409, `se alargó sobre una hora llena: ${JSON.stringify(res.r1.body)}`);
    assert.equal(res.r1.body.requiere_confirmacion, true);
    assert.equal(await ocupadas(tl(), diaB, '10:00'), 1, 'sobrecupo a las 10:00');
    assert.equal(Number((await dondeEsta(id)).duracion_horas), 1);
  });

  t(`QP3-04 [taller ${nombre}]: recepción no mueve una cita de 2 horas comprobando solo la primera`, async () => {
    const [diaA, diaB] = [otroDia(), otroDia()];
    const [c1, c2] = [await cliente(tl()), await cliente(tl())];
    const id = await cita(tl(), c1, diaA, '09:00', { duracion: 2 });
    await cita(tl(), c2, diaB, '10:00');
    const r = await moverRecepcion(tl(), c1, id, diaB, '09:00');
    assert.equal(r.status, 409, `recepción movió la cita larga sobre una hora llena: ${JSON.stringify(r.body)}`);
    assert.equal(await ocupadas(tl(), diaB, '10:00'), 1);
    assert.equal((await dondeEsta(id)).fecha, diaA);
    // Donde las dos horas están libres, sí la mueve (y conserva las 2 horas).
    const ok = await moverRecepcion(tl(), c1, id, diaB, '13:00');
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(Number((await dondeEsta(id)).duracion_horas), 2);
  });

  t(`QP3-05 [taller ${nombre}]: recepción no cambia solo la sede de una cita a una sede llena`, async () => {
    const dia = otroDia();
    const [c1, c2] = [await cliente(tl()), await cliente(tl())];
    const id = await cita(tl(), c1, dia, '09:00', { sede: tl().sede });
    await cita(tl(), c2, dia, '09:00', { sede: tl().sede2 });
    const r = await moverRecepcion(tl(), c1, id, dia, '09:00', tl().sede2);
    assert.equal(r.status, 409, `recepción pasó la cita a una sede llena: ${JSON.stringify(r.body)}`);
    assert.equal(await ocupadas(tl(), dia, '09:00', tl().sede2), 1);
    assert.equal((await dondeEsta(id)).sucursal_id, tl().sede);
    // Editar el motivo sin cambiar de lugar sigue sin validar el cupo.
    const motivo = await moverRecepcion(tl(), c1, id, dia, '09:00', tl().sede);
    assert.equal(motivo.status, 200, JSON.stringify(motivo.body));
  });
}
