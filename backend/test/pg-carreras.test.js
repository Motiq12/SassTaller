// QP-01/03/04/07: carreras que evadían los bloqueos de B-04 y Q-03/Q-04/Q-08.
//
// Las carreras se fuerzan de forma determinista, sin depender del azar ni de esperas:
// una "trampa" detiene UNA consulta SQL concreta de la primera petición (la que va a
// escribir) justo antes de mandarla a Postgres; con esa petición detenida se lanza la
// segunda, se espera a que responda o a que quede esperando un bloqueo de la base
// (pg_stat_activity), y recién ahí se suelta la primera. Routers, auth, sesiones y SQL
// son los reales; solo se sustituyen los envíos de correo.
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');

const url = process.env.PG_TEST_URL;
if (url && !/\/\w+_test(\?|$)/.test(url)) throw new Error('PG_TEST_URL debe terminar en _test');
if (url) process.env.DATABASE_URL = url;
process.env.JWT_SECRET = 'solo-tests-carreras-sin-secretos-reales';
process.env.RESEND_API_KEY = '';
delete process.env.TURNSTILE_SECRET;
const t = (nombre, fn) => test(nombre, { skip: !url && 'sin PG_TEST_URL' }, fn);

const clave = 'UnaClaveSegura123';
const hash = bcrypt.hashSync(clave, 4);
let pool, server, base, admin, adminId, tenantId, clienteId, vehiculoId, clienteToken, secuencia = 0;
const sello = `${Date.now()}-${process.pid}`;

// ── Trampa: detiene la próxima consulta cuyo texto coincida con `patron` ──
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
    // pg-pool llama con callback; las conexiones dedicadas, sin él (promesa).
    if (typeof cb === 'function' || typeof values === 'function') { tr.suelta.then(seguir); return undefined; }
    return tr.suelta.then(seguir);
  }
  return queryOriginal.call(this, config, values, cb);
};
function armar(patron) {
  let llego, soltar;
  const llegada = new Promise(r => { llego = r; });
  const suelta = new Promise(r => { soltar = r; });
  trampa = { patron, llego, suelta };
  return { llegada, soltar };
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

// Carrera completa: `primera` se detiene en `patron`; con ella detenida corre `segunda`.
async function carrera(patron, primera, segunda) {
  const { llegada, soltar } = armar(patron);
  const p1 = primera();
  await llegada;
  const p2 = segunda();
  const fase = await respondeOBloquea(p2);
  soltar();
  const [r1, r2] = await Promise.all([p1, p2]);
  return { fase, r1, r2 };
}

async function pedir(method, ruta, body, token) {
  const r = await fetch(base + ruta, {
    method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: await r.json() };
}
const q = (...a) => pool.query(...a);
const fila = async id => (await q('SELECT * FROM ordenes_trabajo WHERE id = ?', [id]))[0][0];
const total = o => Number(o.costo_mano_obra) + Number(o.costo_repuestos) - Number(o.descuento);
async function entrar(email) {
  const r = await pedir('POST', '/api/auth/login', { email, password: clave });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.data.token;
}
async function personal(rol) {
  const email = `carrera-${sello}-${rol}-${++secuencia}@prueba.test`;
  const [u] = await q('INSERT INTO usuarios (tenant_id, nombre, email, password_hash, rol) VALUES (?, ?, ?, ?, ?)', [tenantId, `Persona ${secuencia}`, email, hash, rol]);
  return { id: u.insertId, email, nombre: `Persona ${secuencia}` };
}
async function nueva(estado, extra = {}) {
  const [[o]] = await q(`INSERT INTO ordenes_trabajo
    (tenant_id, cliente_id, vehiculo_id, recepcionista_id, numero_orden, problema_reportado, estado, costo_mano_obra, tecnico_id)
    VALUES (?, ?, ?, ?, ?, 'Prueba carreras', ?, ?, ?) RETURNING id`,
  [tenantId, clienteId, vehiculoId, adminId, `CAR-${Date.now()}-${++secuencia}`, estado, extra.mano ?? 100, extra.tecnico ?? null]);
  return o.id;
}
// Cierre y cancelación: las dos rutas que dejan una orden en un estado terminal.
const TERMINAR = {
  'el cierre': { patron: /SET estado='entregada'/, final: 'entregada', pedir: id => pedir('PATCH', `/api/ordenes/${id}/cerrar`, { confirmar: true, motivo: 'Retiro excepcional autorizado' }, admin) },
  'la cancelación': { patron: /UPDATE ordenes_trabajo SET estado = \$\d+ WHERE tenant_id/, final: 'cancelada', pedir: id => pedir('PATCH', `/api/ordenes/${id}/estado`, { estado: 'cancelada', confirmar: true, motivo: 'Cliente desiste' }, admin) },
};

test.before(async () => {
  if (!url) return;
  ({ pool } = require('../src/db/pool'));
  await require('../src/db/migrar').migrar({ log: () => {} });
  const mailer = require('../src/services/mailer');
  for (const key of Object.keys(mailer)) if (key.startsWith('enviar')) mailer[key] = async () => {};
  const app = express();
  app.use(express.json());
  for (const ruta of ['auth', 'onboarding', 'usuarios', 'ordenes', 'recepcion', 'portal', 'mecanico']) {
    app.use(`/api/${ruta}`, require(`../src/routes/${ruta}.routes`));
  }
  server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  base = `http://127.0.0.1:${server.address().port}`;
  const slug = `carreras-${sello}`;
  const r = await pedir('POST', '/api/onboarding', { nombre: 'Taller carreras', slug, tipos: ['moto'], provincia: 'Guanacaste', canton: 'Liberia', admin: { nombre: 'Admin', email: `${slug}@prueba.test`, password: clave } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  admin = r.body.data.token;
  tenantId = r.body.data.taller.id;
  adminId = jwt.decode(admin).id;
  const [c] = await q("INSERT INTO clientes (tenant_id, nombre, apellido, telefono) VALUES (?, 'Cliente', 'Carreras', '88884321')", [tenantId]);
  clienteId = c.insertId;
  const [v] = await q("INSERT INTO vehiculos (tenant_id, cliente_id, placa, marca, modelo, tipo) VALUES (?, ?, ?, 'Honda', 'Prueba', 'moto')", [tenantId, clienteId, `CAR${process.pid}`]);
  vehiculoId = v.insertId;
  clienteToken = jwt.sign({ id: clienteId, tipo: 'cliente', tenant_id: tenantId }, process.env.JWT_SECRET, { expiresIn: '1h' });
});
test.after(async () => {
  Client.prototype.query = queryOriginal;
  if (server) await new Promise(resolve => server.close(resolve));
  if (pool) await pool.end();
});

// ── QP-01 ──
t('QP-01: un login en curso mientras degradan a un admin no conserva el rol viejo', async () => {
  const otro = await personal('admin');
  const orden = await nueva('diagnostico');
  // El login se detiene después de comprobar la contraseña del personal (la consulta
  // siguiente es la de clientes); con él detenido, el admin principal lo degrada.
  const { llegada, soltar } = armar(/FROM clientes WHERE LOWER\(email\)/);
  const login = pedir('POST', '/api/auth/login', { email: otro.email, password: clave });
  await llegada;
  const cambio = await pedir('PUT', `/api/usuarios/${otro.id}`, { nombre: otro.nombre, email: otro.email, rol: 'tecnico' }, admin);
  assert.equal(cambio.status, 200, JSON.stringify(cambio.body));
  soltar();
  const r = await login;
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const viejo = r.body.data.token;
  assert.equal(jwt.decode(viejo).rol, 'admin', 'la carrera se dio: el token salió firmado con el rol anterior');
  // Esa sesión nueva no autoriza nada como admin: ni la lista de usuarios ni el dinero.
  assert.equal((await pedir('GET', '/api/usuarios', null, viejo)).status, 401);
  assert.equal((await pedir('PUT', `/api/ordenes/${orden}`, { costo_mano_obra: 9876 }, viejo)).status, 401);
  assert.equal(Number((await fila(orden)).costo_mano_obra), 100);
  // Volviendo a entrar recibe su rol vigente, y como técnico no administra usuarios.
  const nuevo = await entrar(otro.email);
  assert.equal(jwt.decode(nuevo).rol, 'tecnico');
  assert.equal((await pedir('GET', '/api/usuarios', null, nuevo)).status, 403);
  // Las sesiones con el rol al día siguen funcionando.
  assert.equal((await pedir('GET', '/api/usuarios', null, admin)).status, 200);
});

// ── QP-03 ──
for (const [nombre, fin] of Object.entries(TERMINAR)) {
  t(`QP-03: el rechazo inicial detenido antes de escribir no reabre una orden tras ${nombre}`, async () => {
    const id = await nueva('esperando_aprobacion');
    const { fase, r1, r2 } = await carrera(/SET aprobacion_cliente = 'rechazado'/,
      () => pedir('POST', `/api/portal/ordenes/${id}/rechazar`, { motivo: 'No autorizo' }, clienteToken),
      () => fin.pedir(id));
    const o = await fila(id);
    assert.equal(o.estado, fin.final, 'el rechazo no puede reabrir la orden ya cerrada');
    // El rechazo tenía la orden bloqueada: la entrega o cancelación espera y se aplica después.
    assert.equal(fase, 'bloqueada', 'la segunda petición tiene que esperar el bloqueo de la orden');
    assert.equal(r1.status, 200, JSON.stringify(r1.body));
    assert.equal(r2.status, 200, JSON.stringify(r2.body));
    assert.equal((await pedir('PUT', `/api/recepcion/cotizaciones/${id}/costos`, { costo_mano_obra: 555, descuento: 0 }, admin)).status, 409);
    assert.equal(Number((await fila(id)).costo_mano_obra), 100);
  });
  t(`QP-03: con ${nombre} en curso, el rechazo inicial espera y no reabre la orden`, async () => {
    const id = await nueva('esperando_aprobacion');
    const { r1, r2 } = await carrera(fin.patron,
      () => fin.pedir(id),
      () => pedir('POST', `/api/portal/ordenes/${id}/rechazar`, { motivo: 'No autorizo' }, clienteToken));
    assert.equal(r1.status, 200, JSON.stringify(r1.body));
    assert.equal(r2.status, 400, JSON.stringify(r2.body));
    const o = await fila(id);
    assert.equal(o.estado, fin.final);
    assert.notEqual(o.aprobacion_cliente, 'rechazado');
    if (fin.final === 'entregada') assert.ok(o.fecha_entrega_real);
    assert.equal((await pedir('PUT', `/api/recepcion/cotizaciones/${id}/costos`, { costo_mano_obra: 555, descuento: 0 }, admin)).status, 409);
  });
}
t('QP-03: avanzarEstadoOrden nunca saca una orden de un estado terminal', async () => {
  const { paraTenant } = require('../src/db/tenant-db');
  const { avanzarEstadoOrden } = require('../src/utils/ordenes');
  const db = paraTenant(tenantId);
  for (const estado of ['entregada', 'cancelada']) {
    const id = await nueva(estado);
    assert.equal(await avanzarEstadoOrden(db, id, 'diagnostico'), false);
    assert.equal((await fila(id)).estado, estado);
    const [[{ n }]] = await q('SELECT COUNT(*)::int AS n FROM orden_tiempos WHERE orden_id = ?', [id]);
    assert.equal(n, 0);
  }
  const abierta = await nueva('esperando_aprobacion');
  assert.equal(await avanzarEstadoOrden(db, abierta, 'diagnostico'), true);
  assert.equal((await fila(abierta)).estado, 'diagnostico');
});

// ── QP-04 ──
async function mecanicoAsignado() {
  const tec = await personal('tecnico');
  return { ...tec, token: await entrar(tec.email) };
}
const piezasDe = async id => (await q('SELECT id FROM orden_repuestos WHERE orden_id = ?', [id]))[0].length;
for (const [nombre, fin] of Object.entries(TERMINAR)) {
  t(`QP-04: con ${nombre} en curso, el mecánico espera y no agrega repuestos a la orden cerrada`, async () => {
    const tec = await mecanicoAsignado();
    const id = await nueva('lista_entrega', { tecnico: tec.id });
    const { r1, r2 } = await carrera(fin.patron,
      () => fin.pedir(id),
      () => pedir('POST', `/api/mecanico/ordenes/${id}/repuestos`, { nombre: 'Bujía', cantidad: 1 }, tec.token));
    assert.equal(r1.status, 200, JSON.stringify(r1.body));
    assert.equal(r2.status, 409, JSON.stringify(r2.body));
    assert.equal((await fila(id)).estado, fin.final);
    assert.equal(await piezasDe(id), 0);
  });
  t(`QP-04: una solicitud del mecánico ya en curso se aplica antes que ${nombre}`, async () => {
    const tec = await mecanicoAsignado();
    const id = await nueva('lista_entrega', { tecnico: tec.id });
    const { fase, r1, r2 } = await carrera(/INSERT INTO orden_repuestos/,
      () => pedir('POST', `/api/mecanico/ordenes/${id}/repuestos`, { nombre: 'Bujía', cantidad: 1 }, tec.token),
      () => fin.pedir(id));
    // La solicitud tenía la orden bloqueada: la entrega no pudo colarse en el medio.
    assert.equal(fase, 'bloqueada');
    assert.equal(r1.status, 201, JSON.stringify(r1.body));
    assert.equal(r2.status, 200, JSON.stringify(r2.body));
    assert.equal((await fila(id)).estado, fin.final);
    assert.equal(await piezasDe(id), 1);
    // Y una vez cerrada, ya no se pide nada más.
    assert.equal((await pedir('POST', `/api/mecanico/ordenes/${id}/repuestos`, { nombre: 'Otra', cantidad: 1 }, tec.token)).status, 409);
    assert.equal(await piezasDe(id), 1);
  });
}
t('QP-04: el mecánico no pide repuestos en una orden que no tiene asignada', async () => {
  const tec = await mecanicoAsignado();
  const otro = await personal('tecnico');
  const id = await nueva('en_reparacion', { tecnico: otro.id });
  assert.equal((await pedir('POST', `/api/mecanico/ordenes/${id}/repuestos`, { nombre: 'Bujía', cantidad: 1 }, tec.token)).status, 404);
  assert.equal(await piezasDe(id), 0);
});

// ── QP-07 ──
t('QP-07: rechazar un adicional de un presupuesto legado sin copia saca la pieza no aprobada', async () => {
  // Presupuesto aprobado antes de que existiera la copia: aprobó 150 (mano de obra 100
  // + pieza base 50) hace una hora; después se agregó un adicional de 70 que espera.
  const id = await nueva('esperando_aprobacion');
  const [[base1]] = await q(`INSERT INTO orden_repuestos (tenant_id, orden_id, nombre, cantidad, costo_unitario, estado, adicional, created_at)
    VALUES (?, ?, 'Pastillas', 1, 50, 'disponible', 0, NOW() - INTERVAL '2 hours') RETURNING id`, [tenantId, id]);
  const [[extra]] = await q(`INSERT INTO orden_repuestos (tenant_id, orden_id, nombre, cantidad, costo_unitario, estado, adicional)
    VALUES (?, ?, 'Disco', 1, 70, 'pendiente', 1) RETURNING id`, [tenantId, id]);
  await q(`UPDATE ordenes_trabajo SET costo_repuestos = 120, descuento = 0, total_aprobado = 150, presupuesto_aprobado = NULL,
    aprobacion_cliente = 'pendiente', fecha_aprobacion = NOW() - INTERVAL '1 hour' WHERE id = ?`, [id]);
  const r = await pedir('POST', `/api/portal/ordenes/${id}/rechazar`, { motivo: 'Solo lo aprobado' }, clienteToken);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const o = await fila(id);
  assert.equal(total(o), 150, 'se respeta el total aprobado');
  assert.equal(Number(o.costo_repuestos), 50);
  assert.equal(Number(o.descuento), 0);
  assert.equal(o.estado, 'en_reparacion', 'no queda esperando un repuesto que no se va a comprar');
  assert.equal(o.adicionales_rechazados.length, 1);
  const [piezas] = await q('SELECT id, rechazado FROM orden_repuestos WHERE orden_id = ? ORDER BY id', [id]);
  assert.deepEqual(piezas.map(p => [p.id, Number(p.rechazado)]), [[base1.id, 0], [extra.id, 1]]);
  const portal = await pedir('GET', `/api/portal/ordenes/${id}`, null, clienteToken);
  assert.equal(portal.status, 200, JSON.stringify(portal.body));
  assert.ok(!JSON.stringify(portal.body).includes('Disco'), 'el portal ya no muestra la pieza rechazada');
  assert.ok(JSON.stringify(portal.body).includes('Pastillas'));
});
t('QP-07: sin fecha de aprobación no se marca ninguna pieza y se compensa con descuento', async () => {
  const id = await nueva('esperando_aprobacion');
  await q(`INSERT INTO orden_repuestos (tenant_id, orden_id, nombre, cantidad, costo_unitario, estado, adicional)
    VALUES (?, ?, 'Disco', 1, 70, 'disponible', 1)`, [tenantId, id]);
  await q(`UPDATE ordenes_trabajo SET costo_repuestos = 70, descuento = 5, total_aprobado = 100, presupuesto_aprobado = NULL,
    aprobacion_cliente = 'pendiente', fecha_aprobacion = NULL WHERE id = ?`, [id]);
  const r = await pedir('POST', `/api/portal/ordenes/${id}/rechazar`, { motivo: 'No' }, clienteToken);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const o = await fila(id);
  assert.equal(total(o), 100);
  const [[p]] = await q('SELECT rechazado FROM orden_repuestos WHERE orden_id = ?', [id]);
  assert.equal(Number(p.rechazado), 0, 'sin saber cuándo aprobó, no se inventa qué piezas rechazó');
});
