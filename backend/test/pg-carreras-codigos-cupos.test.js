// B-09 y B-13: carreras de los códigos de un solo uso y del cupo de la agenda.
//
// Igual que pg-carreras.test.js, las carreras se fuerzan de forma determinista: la
// primera petición se detiene en un punto exacto (después de que bcrypt aceptó el
// código, o justo antes de mandar una consulta SQL concreta), con ella detenida corre
// la segunda, y recién después se suelta la primera. Routers, auth, sesiones y SQL son
// los reales contra Postgres; solo se sustituyen los envíos de correo.
//
// Cada caso corre en DOS talleres. Además hay pruebas de que el candado de un taller (o
// de una sede) no hace esperar a otro.
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');

const url = process.env.PG_TEST_URL;
if (url && !/\/\w+_test(\?|$)/.test(url)) throw new Error('PG_TEST_URL debe terminar en _test');
if (url) process.env.DATABASE_URL = url;
process.env.JWT_SECRET = 'solo-tests-carreras-t12-sin-secretos-reales';
process.env.RESEND_API_KEY = '';
delete process.env.TURNSTILE_SECRET;
const t = (nombre, fn) => test(nombre, { skip: !url && 'sin PG_TEST_URL' }, fn);

const totp = require('../src/utils/totp');
const { fechaLocalISO } = require('../src/utils/fecha');

const clave = 'UnaClaveSegura123';
const hash = bcrypt.hashSync(clave, 4);
const CODIGO = '482913';
const hashCodigo = bcrypt.hashSync(CODIGO, 4);
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

// Carrera de código: `primera` se detiene justo DESPUÉS de que bcrypt aceptó el código
// (ya lo comparó, todavía no lo canjeó); con ella detenida corre `segunda` completa.
const bcryptReal = bcrypt.compare;
async function carreraBcrypt(primera, segunda) {
  let llego, soltar;
  const llegada = new Promise(r => { llego = r; });
  const suelta = new Promise(r => { soltar = r; });
  bcrypt.compare = async function (...args) {
    const ok = await bcryptReal.apply(this, args);
    if (ok) { bcrypt.compare = bcryptReal; llego(); await suelta; }
    return ok;
  };
  try {
    const p1 = primera();
    await aTiempo(llegada, 'bcrypt del código');
    const r2 = await segunda();
    soltar();
    return { r1: await p1, r2 };
  } finally {
    bcrypt.compare = bcryptReal;
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
const exitos = (...rs) => rs.filter(r => r.status >= 200 && r.status < 300).length;

async function entrar(email, password = clave) {
  const r = await pedir('POST', '/api/auth/login', { email, password });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.data.token;
}
async function personal(tl, rol, extra = {}) {
  const email = `t12-${sello}-${rol}-${++secuencia}@prueba.test`;
  const [[u]] = await q(
    'INSERT INTO usuarios (tenant_id, nombre, email, password_hash, rol, email_verificado) VALUES (?, ?, ?, ?, ?, ?) RETURNING id',
    [tl.id, `Persona ${secuencia}`, email, hash, rol, extra.verificado === false ? 0 : 1]
  );
  return { id: u.id, email };
}
async function cliente(tl, extra = {}) {
  const email = `t12-cliente-${sello}-${++secuencia}@prueba.test`;
  const [[c]] = await q(
    `INSERT INTO clientes (tenant_id, nombre, apellido, telefono, email, password_hash, email_verificado, email_pendiente)
     VALUES (?, 'Ana', 'Mora', '88881111', ?, ?, ?, ?) RETURNING id`,
    [tl.id, email, extra.sinClave ? null : hash, extra.verificado === false ? 0 : 1, extra.pendiente || null]
  );
  const [[v]] = await q("INSERT INTO vehiculos (tenant_id, cliente_id, placa, marca, modelo, tipo) VALUES (?, ?, ?, 'Honda', 'Prueba', 'moto') RETURNING id",
    [tl.id, c.id, `T${process.pid % 1000}${secuencia}`]);
  const token = jwt.sign({ id: c.id, tipo: 'cliente', tenant_id: tl.id }, process.env.JWT_SECRET, { expiresIn: '1h' });
  return { id: c.id, email, vehiculoId: v.id, token };
}
async function codigo(tl, tabla, columna, id, extra = '') {
  await q(`INSERT INTO ${tabla} (tenant_id, ${columna}, code_hash, expires_at${extra ? ', proposito' : ''})
           VALUES (?, ?, ?, NOW() + INTERVAL '10 minutes'${extra ? ', ?' : ''})`,
  extra ? [tl.id, id, hashCodigo, extra] : [tl.id, id, hashCodigo]);
}

// Días hábiles futuros (lunes a viernes, de 8 a 17 con la configuración por defecto),
// dentro de la anticipación permitida. Cada caso de cupo usa su propio día.
const DIAS = [];
for (let n = 3; n <= 27; n++) {
  const f = fechaLocalISO(-6, n);
  const dow = new Date(`${f}T12:00:00Z`).getUTCDay();
  if (dow >= 1 && dow <= 5) DIAS.push(f);
}
let diaLibre = 0;
const otroDia = () => DIAS[diaLibre++ % DIAS.length];

async function nuevoTaller(nombre) {
  const slug = `t12-${nombre.toLowerCase()}-${sello}`;
  const r = await pedir('POST', '/api/onboarding', { nombre: `Taller ${nombre}`, slug, tipos: ['moto'], provincia: 'Guanacaste', canton: 'Liberia', admin: { nombre: 'Admin', email: `${slug}@prueba.test`, password: clave } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const tl = { nombre, slug, id: r.body.data.taller.id, admin: r.body.data.token };
  // Cupo de UNA cita por hora: la última plaza es la primera.
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
  tl.recepcion = await entrar(rec.email);
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
  for (const ruta of ['auth', 'onboarding', 'portal', 'citas']) {
    app.use(`/api/${ruta}`, require(`../src/routes/${ruta}.routes`));
  }
  server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  base = `http://127.0.0.1:${server.address().port}`;
  talleres.A = await nuevoTaller('A');
  talleres.B = await nuevoTaller('B');
});
test.after(async () => {
  Client.prototype.query = queryOriginal;
  bcrypt.compare = bcryptReal;
  if (server) await new Promise(resolve => server.close(resolve));
  if (pool) await pool.end();
});

// ═══════════════════════ B-09: códigos de un solo uso ═══════════════════════
const otraClave = 'OtraClaveSegura456';
const terceraClave = 'TerceraClaveSegura789';

for (const nombre of ['A', 'B']) {
  const tl = () => talleres[nombre];

  t(`B-09 [taller ${nombre}]: recuperar la contraseña del personal con el mismo código dos veces a la vez: vale una`, async () => {
    const u = await personal(tl(), 'admin');
    await codigo(tl(), 'usuario_reset_codes', 'usuario_id', u.id);
    const conf = password => pedir('POST', '/api/auth/recuperar/confirmar', { email: u.email, codigo: CODIGO, password });
    const { r1, r2 } = await carreraBcrypt(() => conf(otraClave), () => conf(terceraClave));
    assert.deepEqual(estados(r1, r2), [200, 400], `las dos usaron el código: ${r1.status} y ${r2.status}`);
    // La contraseña que quedó es la del pedido que ganó; la del otro no entra.
    const ganadora = r1.status === 200 ? otraClave : terceraClave;
    const perdedora = ganadora === otraClave ? terceraClave : otraClave;
    assert.equal((await pedir('POST', '/api/auth/login', { email: u.email, password: perdedora })).status, 401);
    assert.equal((await pedir('POST', '/api/auth/login', { email: u.email, password: ganadora })).status, 200);
  });

  t(`B-09 [taller ${nombre}]: recuperar la contraseña de un cliente (login unificado) con el mismo código a la vez: vale una`, async () => {
    const c = await cliente(tl());
    await codigo(tl(), 'password_reset_codes', 'cliente_id', c.id);
    const conf = password => pedir('POST', '/api/auth/recuperar/confirmar', { email: c.email, codigo: CODIGO, password });
    const { r1, r2 } = await carreraBcrypt(() => conf(otraClave), () => conf(terceraClave));
    assert.deepEqual(estados(r1, r2), [200, 400], `las dos usaron el código: ${r1.status} y ${r2.status}`);
  });

  t(`B-09 [taller ${nombre}]: portal: recuperar con el mismo código a la vez no abre dos sesiones`, async () => {
    const c = await cliente(tl());
    await codigo(tl(), 'password_reset_codes', 'cliente_id', c.id);
    const conf = password => pedir('POST', '/api/portal/recuperar/confirmar', { taller: tl().slug, email: c.email, codigo: CODIGO, password });
    const { r1, r2 } = await carreraBcrypt(() => conf(otraClave), () => conf(terceraClave));
    assert.deepEqual(estados(r1, r2), [200, 400], `las dos usaron el código: ${r1.status} y ${r2.status}`);
  });

  t(`B-09 [taller ${nombre}]: portal: el código de ingreso por correo usado dos veces a la vez da una sola sesión`, async () => {
    const c = await cliente(tl());
    await codigo(tl(), 'login_codes', 'cliente_id', c.id);
    const otp = () => pedir('POST', '/api/portal/otp/verificar', { taller: tl().slug, email: c.email, codigo: CODIGO });
    const { r1, r2 } = await carreraBcrypt(otp, otp);
    assert.deepEqual(estados(r1, r2), [200, 400], `las dos abrieron sesión: ${r1.status} y ${r2.status}`);
    const [[k]] = await q('SELECT used, attempts FROM login_codes WHERE tenant_id = ? AND cliente_id = ?', [tl().id, c.id]);
    assert.equal(Number(k.used), 1);
  });

  t(`B-09 [taller ${nombre}]: portal: confirmar el registro con el mismo código a la vez da una sola sesión`, async () => {
    const c = await cliente(tl(), { verificado: false });
    await codigo(tl(), 'email_verify_codes', 'cliente_id', c.id, 'registro');
    const verificar = () => pedir('POST', '/api/portal/registro/verificar', { taller: tl().slug, email: c.email, codigo: CODIGO });
    const { r1, r2 } = await carreraBcrypt(verificar, verificar);
    assert.deepEqual(estados(r1, r2), [200, 400], `las dos abrieron sesión: ${r1.status} y ${r2.status}`);
  });

  t(`B-09 [taller ${nombre}]: portal: confirmar el cambio de correo con el mismo código a la vez: vale una`, async () => {
    const nuevo = `t12-nuevo-${sello}-${++secuencia}@prueba.test`;
    const c = await cliente(tl(), { pendiente: nuevo });
    await codigo(tl(), 'email_verify_codes', 'cliente_id', c.id, 'cambio');
    const verificar = () => pedir('POST', '/api/portal/perfil/email/confirmar', { codigo: CODIGO }, c.token);
    const { r1, r2 } = await carreraBcrypt(verificar, verificar);
    assert.deepEqual(estados(r1, r2), [200, 400], `las dos usaron el código: ${r1.status} y ${r2.status}`);
    const [[fila]] = await q('SELECT email, email_pendiente FROM clientes WHERE tenant_id = ? AND id = ?', [tl().id, c.id]);
    assert.equal(fila.email, nuevo);
    assert.equal(fila.email_pendiente, null);
  });

  t(`B-09 [taller ${nombre}]: personal: confirmar el correo con el mismo código a la vez: vale una`, async () => {
    const u = await personal(tl(), 'recepcion', { verificado: false });
    const token = await entrar(u.email);
    await codigo(tl(), 'usuario_verify_codes', 'usuario_id', u.id);
    const verificar = () => pedir('POST', '/api/auth/verificar-correo', { codigo: CODIGO }, token);
    const { r1, r2 } = await carreraBcrypt(verificar, verificar);
    assert.deepEqual(estados(r1, r2), [200, 400], `las dos usaron el código: ${r1.status} y ${r2.status}`);
  });

  t(`B-09 [taller ${nombre}]: 2FA: el mismo código de la app usado dos veces a la vez da una sola sesión`, async () => {
    const u = await personal(tl(), 'admin');
    const secreto = totp.generarSecreto();
    await q('UPDATE usuarios SET totp_secret = ?, totp_activado = 1, totp_ultimo_contador = NULL WHERE id = ?', [secreto, u.id]);
    const parcial = jwt.sign({ id: u.id, tenant_id: tl().id, cv: 0, pend2fa: true }, process.env.JWT_SECRET, { expiresIn: '5m' });
    const cod = totp.codigoPara(secreto, Math.floor(Date.now() / 1000 / totp.PERIODO));
    const verificar = () => pedir('POST', '/api/auth/2fa/verificar', { token_parcial: parcial, codigo: cod });
    // La primera se detiene antes de guardar el período consumido.
    const { r1, r2 } = await carreraSql(/SET totp_ultimo_contador = /, verificar, verificar);
    assert.deepEqual(estados(r1, r2), [200, 401], `las dos abrieron sesión: ${r1.status} y ${r2.status}`);
  });

  t(`B-09 [taller ${nombre}]: 2FA: el mismo código de respaldo usado dos veces a la vez da una sola sesión`, async () => {
    const u = await personal(tl(), 'admin');
    const respaldos = totp.generarCodigosRespaldo();
    const hashes = respaldos.map(c => bcrypt.hashSync(totp.normalizarRespaldo(c), 4));
    await q('UPDATE usuarios SET totp_secret = ?, totp_activado = 1, totp_backup = ? WHERE id = ?', [totp.generarSecreto(), JSON.stringify(hashes), u.id]);
    const parcial = jwt.sign({ id: u.id, tenant_id: tl().id, cv: 0, pend2fa: true }, process.env.JWT_SECRET, { expiresIn: '5m' });
    const verificar = () => pedir('POST', '/api/auth/2fa/verificar', { token_parcial: parcial, codigo: respaldos[0] });
    const { r1, r2 } = await carreraBcrypt(verificar, verificar);
    assert.deepEqual(estados(r1, r2), [200, 401], `las dos abrieron sesión: ${r1.status} y ${r2.status}`);
    const [[fila]] = await q('SELECT totp_backup FROM usuarios WHERE id = ?', [u.id]);
    assert.equal(JSON.parse(fila.totp_backup).length, respaldos.length - 1, 'se quemó exactamente un código');
    // Otro código de respaldo, distinto, sigue sirviendo.
    const otro = await pedir('POST', '/api/auth/2fa/verificar', { token_parcial: parcial, codigo: respaldos[1] });
    assert.equal(otro.status, 200, JSON.stringify(otro.body));
  });
}

// ═══════════════════════ B-13: cupo de la agenda ═══════════════════════
const HORA = '10:00';
const reservaPortal = (tl, c, fecha, sede = tl.sede, hora = HORA) => pedir('POST', '/api/portal/citas',
  { vehiculo_id: c.vehiculoId, fecha, hora, servicios: [tl.servicio], sucursal_id: sede }, c.token);
const reservaRecepcion = (tl, c, fecha) => pedir('POST', '/api/citas',
  { cliente_id: c.id, vehiculo_id: c.vehiculoId, fecha, hora: HORA, motivo: 'Revisión', sucursal_id: tl.sede }, tl.recepcion);
async function citaExistente(tl, c, fecha, hora) {
  const [[ci]] = await q(`INSERT INTO citas (tenant_id, cliente_id, vehiculo_id, sucursal_id, fecha, hora, motivo, estado)
    VALUES (?, ?, ?, ?, ?, ?, 'Previa', 'agendado') RETURNING id`, [tl.id, c.id, c.vehiculoId, tl.sede, fecha, hora]);
  return ci.id;
}
// Lugares de 1 hora ocupados a las 10:00 en la sede, contando las citas largas.
async function ocupacion(tl, fecha, sede = tl.sede) {
  const { paraTenant } = require('../src/db/tenant-db');
  const { agendaDia } = require('../src/utils/agenda');
  const { getConfig } = require('../src/utils/configuracion');
  const db = paraTenant(tl.id);
  const dia = await agendaDia(fecha, sede, await getConfig(db), { db });
  return dia.ocupacion[HORA] || 0;
}
// Lo común a todas las carreras de cupo: entró uno solo y la segunda esperó al candado.
function unaSola({ fase, r1, r2 }, lugares) {
  assert.equal(exitos(r1, r2), 1, `pasaron las dos (${r1.status} y ${r2.status}): ${JSON.stringify(r2.body)}`);
  assert.equal(lugares, 1, `la franja quedó con ${lugares} citas y el cupo es 1`);
  assert.equal(fase, 'bloqueada', 'la segunda tiene que esperar el candado de la agenda');
}

for (const nombre of ['A', 'B']) {
  const tl = () => talleres[nombre];

  t(`B-13 [taller ${nombre}]: dos reservas del portal por la última plaza: entra una`, async () => {
    const fecha = otroDia();
    const [c1, c2] = [await cliente(tl()), await cliente(tl())];
    const res = await carreraSql(/INSERT INTO citas/, () => reservaPortal(tl(), c1, fecha), () => reservaPortal(tl(), c2, fecha));
    unaSola(res, await ocupacion(tl(), fecha));
    assert.equal(res.r1.status, 201, JSON.stringify(res.r1.body));
  });

  t(`B-13 [taller ${nombre}]: recepción agenda mientras el portal reserva la última plaza: entra una`, async () => {
    const fecha = otroDia();
    const [c1, c2] = [await cliente(tl()), await cliente(tl())];
    const res = await carreraSql(/INSERT INTO citas/, () => reservaPortal(tl(), c1, fecha), () => reservaRecepcion(tl(), c2, fecha));
    unaSola(res, await ocupacion(tl(), fecha));
    assert.equal(res.r2.status, 409, JSON.stringify(res.r2.body));
  });

  t(`B-13 [taller ${nombre}]: el portal reserva mientras recepción agenda la última plaza: entra una`, async () => {
    const fecha = otroDia();
    const [c1, c2] = [await cliente(tl()), await cliente(tl())];
    const res = await carreraSql(/INSERT INTO citas/, () => reservaRecepcion(tl(), c1, fecha), () => reservaPortal(tl(), c2, fecha));
    unaSola(res, await ocupacion(tl(), fecha));
    assert.equal(res.r1.status, 201, JSON.stringify(res.r1.body));
  });

  t(`B-13 [taller ${nombre}]: el cliente reprograma a la última plaza mientras otro la reserva: entra una`, async () => {
    const fecha = otroDia();
    const [c1, c2] = [await cliente(tl()), await cliente(tl())];
    const id = await citaExistente(tl(), c1, fecha, '09:00');
    const mover = () => pedir('PUT', `/api/portal/citas/${id}`, { vehiculo_id: c1.vehiculoId, fecha, hora: HORA, servicios: [tl().servicio], sucursal_id: tl().sede }, c1.token);
    const res = await carreraSql(/UPDATE citas SET vehiculo_id = /, mover, () => reservaPortal(tl(), c2, fecha));
    unaSola(res, await ocupacion(tl(), fecha));
    assert.equal(res.r1.status, 200, JSON.stringify(res.r1.body));
  });

  t(`B-13 [taller ${nombre}]: recepción mueve una cita a la última plaza mientras el portal la reserva: entra una`, async () => {
    const fecha = otroDia();
    const [c1, c2] = [await cliente(tl()), await cliente(tl())];
    const id = await citaExistente(tl(), c1, fecha, '09:00');
    const mover = () => pedir('PUT', `/api/citas/${id}`, { cliente_id: c1.id, vehiculo_id: c1.vehiculoId, fecha, hora: HORA, motivo: 'Movida', sucursal_id: tl().sede }, tl().recepcion);
    const res = await carreraSql(/UPDATE citas SET cliente_id=/, mover, () => reservaPortal(tl(), c2, fecha));
    unaSola(res, await ocupacion(tl(), fecha));
    assert.equal(res.r1.status, 200, JSON.stringify(res.r1.body));
  });

  t(`B-13 [taller ${nombre}]: administración alarga una cita sobre la última plaza mientras el portal la reserva: entra una`, async () => {
    const fecha = otroDia();
    const [c1, c2] = [await cliente(tl()), await cliente(tl())];
    const id = await citaExistente(tl(), c1, fecha, '09:00');
    const alargar = () => pedir('PATCH', `/api/citas/${id}/duracion`, { duracion_horas: 2 }, tl().admin);
    const res = await carreraSql(/SET duracion_horas = /, alargar, () => reservaPortal(tl(), c2, fecha));
    unaSola(res, await ocupacion(tl(), fecha));
    assert.equal(res.r1.status, 200, JSON.stringify(res.r1.body));
  });
}

// ── El candado no mezcla talleres ni sedes ──
t('B-13: con la agenda del taller A bloqueada, el taller B reserva el mismo día y hora sin esperar', async () => {
  const fecha = otroDia();
  const [a, b] = [await cliente(talleres.A), await cliente(talleres.B)];
  const res = await carreraSql(/INSERT INTO citas/, () => reservaPortal(talleres.A, a, fecha), () => reservaPortal(talleres.B, b, fecha));
  assert.equal(res.fase, 'respondio', 'el taller B esperó el candado del taller A');
  assert.equal(res.r1.status, 201, JSON.stringify(res.r1.body));
  assert.equal(res.r2.status, 201, JSON.stringify(res.r2.body));
  assert.equal(await ocupacion(talleres.A, fecha), 1);
  assert.equal(await ocupacion(talleres.B, fecha), 1);
});

t('B-13: con una sede bloqueada, otra sede del mismo taller reserva el mismo día sin esperar', async () => {
  const fecha = otroDia();
  const tl = talleres.A;
  const [a, b] = [await cliente(tl), await cliente(tl)];
  const res = await carreraSql(/INSERT INTO citas/, () => reservaPortal(tl, a, fecha), () => reservaPortal(tl, b, fecha, tl.sede2));
  assert.equal(res.fase, 'respondio', 'la otra sede esperó el candado');
  assert.equal(res.r1.status, 201, JSON.stringify(res.r1.body));
  assert.equal(res.r2.status, 201, JSON.stringify(res.r2.body));
  assert.equal(await ocupacion(tl, fecha), 1);
  assert.equal(await ocupacion(tl, fecha, tl.sede2), 1);
});
