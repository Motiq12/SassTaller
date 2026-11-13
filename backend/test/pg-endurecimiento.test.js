// T13: endurecimiento (B-10, B-11, B-12, B-14), con PostgreSQL y HTTP reales.
// Cada caso reproduce el hallazgo: falla con el código de antes y pasa con el arreglo.
const test = require('node:test');
const assert = require('node:assert');
const img = require('./imagenes');

const url = process.env.PG_TEST_URL;
if (url && !/\/\w+_test(\?|$)/.test(url)) throw new Error('PG_TEST_URL debe terminar en _test');
if (url) process.env.DATABASE_URL = url;
process.env.JWT_SECRET = process.env.JWT_SECRET || 'solo-tests-endurecimiento-sin-secretos-reales';
process.env.RESEND_API_KEY = '';
const sinPg = !url && 'sin PG_TEST_URL';
const T = {};
let pool, server;

const pedir = async (met, ruta, { token, body } = {}) => {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  const r = await fetch(`http://127.0.0.1:${server.address().port}/api${ruta}`, {
    method: met, headers, body: body ? JSON.stringify(body) : undefined,
  });
  const texto = await r.text();
  let json = null; try { json = JSON.parse(texto); } catch { /* */ }
  return { status: r.status, json };
};

test.before(async () => {
  if (!url) return;
  ({ pool } = require('../src/db/pool'));
  await require('../src/db/migrar').migrar({ log: () => {} });
  const jwt = require('jsonwebtoken');
  const { abrirSesion, nuevoSid } = require('../src/utils/sesiones');
  const uno = async (sql, params) => (await pool.query(sql, params))[0][0];
  const sello = `${Date.now().toString(36)}${process.pid}`;
  const sesion = async (usuarioId, rol) => {
    const sid = nuevoSid();
    const token = jwt.sign({ id: usuarioId, rol, tenant_id: T.tenantId, sid }, process.env.JWT_SECRET, { expiresIn: '1h' });
    if (!(await abrirSesion(usuarioId, { headers: {}, ip: '127.0.0.1' }, jwt.decode(token).exp, sid))) throw new Error('no se pudo abrir la sesión de prueba');
    return token;
  };

  T.slug = `endu-${sello}`;
  T.tenantId = (await uno("INSERT INTO tenants (nombre, slug) VALUES ('Endurecimiento', ?) RETURNING id", [T.slug])).id;
  const sede = async (nombre) => (await uno('INSERT INTO sucursales (tenant_id, nombre, activa) VALUES (?, ?, 1) RETURNING id', [T.tenantId, nombre])).id;
  T.sedeA = await sede('Sede A');
  T.sedeB = await sede('Sede B');
  const usuario = async (rol, nombre, sucursal) => (await uno(
    "INSERT INTO usuarios (tenant_id, nombre, email, password_hash, rol, sucursal_id) VALUES (?, ?, ?, 'no-es-clave-real', ?, ?) RETURNING id",
    [T.tenantId, nombre, `${nombre}-${sello}@prueba.test`, rol, sucursal])).id;
  T.adminId = await usuario('admin', 'admin', null);
  T.recepcionId = await usuario('recepcion', 'recepcion', T.sedeA);
  T.tecnicoId = await usuario('tecnico', 'tecnico', T.sedeA);
  T.otroTecnicoId = await usuario('tecnico', 'otro-tecnico', T.sedeA);
  T.tokens = {
    admin: await sesion(T.adminId, 'admin'),
    recepcion: await sesion(T.recepcionId, 'recepcion'),
    tecnico: await sesion(T.tecnicoId, 'tecnico'),
  };
  T.clienteId = (await uno("INSERT INTO clientes (tenant_id, nombre, apellido, telefono) VALUES (?, 'Cliente', 'Prueba', '88881234') RETURNING id", [T.tenantId])).id;
  T.vehiculoId = (await uno(
    "INSERT INTO vehiculos (tenant_id, cliente_id, placa, marca, modelo, tipo) VALUES (?, ?, ?, 'Toyota', 'Prueba', 'auto') RETURNING id",
    [T.tenantId, T.clienteId, `EN${Date.now().toString(36)}`.slice(0, 10).toUpperCase()])).id;

  // Órdenes del mismo vehículo repartidas entre sedes y mecánicos.
  const orden = async (numero, sucursal, tecnico) => (await uno(
    "INSERT INTO ordenes_trabajo (tenant_id, numero_orden, vehiculo_id, cliente_id, problema_reportado, sucursal_id, tecnico_id) VALUES (?, ?, ?, ?, 'prueba', ?, ?) RETURNING id",
    [T.tenantId, numero, T.vehiculoId, T.clienteId, sucursal, tecnico])).id;
  T.ordenes = {
    propiaSedeA: await orden('EN-1', T.sedeA, T.tecnicoId),
    deOtroSedeA: await orden('EN-2', T.sedeA, T.otroTecnicoId),
    propiaSedeB: await orden('EN-3', T.sedeB, T.tecnicoId),
    deOtroSinSede: await orden('EN-4', null, T.otroTecnicoId),
    porCitaSedeA: await orden('EN-5', T.sedeA, null),
  };
  // EN-5 le llega al mecánico por la cita, no por la orden.
  await pool.query(
    "INSERT INTO citas (tenant_id, cliente_id, vehiculo_id, fecha, hora, motivo, tecnico_id, orden_id, sucursal_id) VALUES (?, ?, ?, CURRENT_DATE + 30, '09:00', 'prueba', ?, ?, ?)",
    [T.tenantId, T.clienteId, T.vehiculoId, T.tecnicoId, T.ordenes.porCitaSedeA, T.sedeA]);

  const express = require('express');
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  for (const ruta of ['auth', 'vehiculos', 'ordenes', 'recepcion', 'mecanico', 'promos', 'portal']) app.use(`/api/${ruta}`, require(`../src/routes/${ruta}.routes`));
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
});

test.after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (pool) await pool.end();
});

// ── B-10: vehículos ──

test('B-10: el mecánico no registra ni edita vehículos', { skip: sinPg }, async () => {
  const editar = await pedir('PUT', `/vehiculos/${T.vehiculoId}`, { token: T.tokens.tecnico, body: { marca: 'Hackeada', modelo: 'X' } });
  assert.equal(editar.status, 403, `editar: ${JSON.stringify(editar.json)}`);
  const crear = await pedir('POST', '/vehiculos', { token: T.tokens.tecnico, body: { cliente_id: T.clienteId, marca: 'Nueva', modelo: 'Y' } });
  assert.equal(crear.status, 403, `crear: ${JSON.stringify(crear.json)}`);
  const [[v]] = await pool.query('SELECT marca FROM vehiculos WHERE id = ?', [T.vehiculoId]);
  assert.equal(v.marca, 'Toyota', 'el vehículo no cambió');
});

test('B-10: recepción y administración sí editan vehículos', { skip: sinPg }, async () => {
  const r = await pedir('PUT', `/vehiculos/${T.vehiculoId}`, { token: T.tokens.recepcion, body: { marca: 'Toyota', modelo: 'Editado' } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const a = await pedir('PUT', `/vehiculos/${T.vehiculoId}`, { token: T.tokens.admin, body: { marca: 'Toyota', modelo: 'Prueba' } });
  assert.equal(a.status, 200, JSON.stringify(a.json));
});

const numeros = (r) => r.json.data.map((o) => o.numero_orden).sort();

test('B-10: el historial del mecánico trae solo sus órdenes de su sede', { skip: sinPg }, async () => {
  const r = await pedir('GET', `/vehiculos/${T.vehiculoId}/historial`, { token: T.tokens.tecnico });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(numeros(r), ['EN-1', 'EN-5'], 'la suya por la orden y la suya por la cita, sin las de otro mecánico ni la de la otra sede');
});

test('B-10: el historial de recepción respeta su sede', { skip: sinPg }, async () => {
  const r = await pedir('GET', `/vehiculos/${T.vehiculoId}/historial`, { token: T.tokens.recepcion });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(numeros(r), ['EN-1', 'EN-2', 'EN-4', 'EN-5'], 'las de su sede y las sin sede, no la de la sede B');
});

test('B-10: administración ve el historial completo', { skip: sinPg }, async () => {
  const r = await pedir('GET', `/vehiculos/${T.vehiculoId}/historial`, { token: T.tokens.admin });
  assert.deepEqual(numeros(r), ['EN-1', 'EN-2', 'EN-3', 'EN-4', 'EN-5']);
});

// ── B-11: imágenes en todas las rutas que las reciben ──

const rutasConImagen = () => [
  ['mensaje del mecánico', 'POST', '/mecanico/mensajes', T.tokens.tecnico, (f) => ({ mensaje: 'hola', foto: f })],
  ['mensaje de una orden', 'POST', `/ordenes/${T.ordenes.propiaSedeA}/mensajes`, T.tokens.tecnico, (f) => ({ mensaje: 'hola', foto: f })],
  ['foto de orden (recepción)', 'POST', `/recepcion/ordenes/${T.ordenes.propiaSedeA}/fotos`, T.tokens.recepcion, (f) => ({ url: f })],
  ['foto de orden', 'POST', `/ordenes/${T.ordenes.propiaSedeA}/fotos`, T.tokens.recepcion, (f) => ({ url: f })],
  ['promoción', 'POST', '/promos', T.tokens.admin, (f) => ({ titulo: 'Promo', descripcion: 'Desc', imagen: f })],
  ['foto del vehículo', 'POST', '/vehiculos', T.tokens.recepcion, (f) => ({ cliente_id: T.clienteId, marca: 'Foto', modelo: 'Z', foto_url: f })],
  ['foto de perfil', 'PUT', '/mecanico/perfil/foto', T.tokens.tecnico, (f) => ({ foto: f })],
];

test('B-11: ninguna ruta guarda un HTML o un SVG con prefijo de imagen', { skip: sinPg }, async () => {
  for (const [nombre, met, ruta, token, cuerpo] of rutasConImagen()) {
    for (const [disfraz, valor] of [['HTML', img.htmlDisfrazado], ['SVG', img.svgDisfrazado], ['tipo cruzado', img.tipoCruzado]]) {
      const r = await pedir(met, ruta, { token, body: cuerpo(valor) });
      assert.equal(r.status, 400, `${nombre} con ${disfraz}: ${r.status} ${JSON.stringify(r.json)}`);
    }
  }
});

test('B-11: las mismas rutas aceptan una imagen real', { skip: sinPg }, async () => {
  for (const [nombre, met, ruta, token, cuerpo] of rutasConImagen()) {
    const r = await pedir(met, ruta, { token, body: cuerpo(img.png) });
    assert.ok(r.status === 200 || r.status === 201, `${nombre}: ${r.status} ${JSON.stringify(r.json)}`);
  }
});

test('B-11: la foto de la promoción tiene tope propio', { skip: sinPg }, async () => {
  const r = await pedir('POST', '/promos', { token: T.tokens.admin, body: { titulo: 'Grande', descripcion: 'x', imagen: img.pngDe(3 * 1024 * 1024 + 1) } });
  assert.equal(r.status, 400, JSON.stringify(r.json));
});

test('B-11: una foto vieja que ya estaba se puede reenviar al editar', { skip: sinPg }, async () => {
  // Guardada antes de esta validación (un GIF), la pantalla la reenvía sin tocarla.
  await pool.query('UPDATE vehiculos SET foto_url = ? WHERE id = ?', [img.gif, T.vehiculoId]);
  const igual = await pedir('PUT', `/vehiculos/${T.vehiculoId}`, { token: T.tokens.recepcion, body: { marca: 'Toyota', modelo: 'Prueba', foto_url: img.gif } });
  assert.equal(igual.status, 200, JSON.stringify(igual.json));
  const nueva = await pedir('PUT', `/vehiculos/${T.vehiculoId}`, { token: T.tokens.recepcion, body: { marca: 'Toyota', modelo: 'Prueba', foto_url: img.htmlDisfrazado } });
  assert.equal(nueva.status, 400, 'una foto nueva sí se revisa');
});

// ── B-12: límite por cuenta en el login del portal ──

test('B-12: el login del portal corta por cuenta, con el mismo cupo que el login principal', { skip: sinPg }, async () => {
  const email = `atacado-${Date.now()}@prueba.test`;
  for (let i = 1; i <= 10; i++) {
    const r = await pedir('POST', '/portal/login', { body: { taller: T.slug, email, password: `mala-${i}` } });
    assert.equal(r.status, 401, `intento ${i}: ${r.status}`);
  }
  const once = await pedir('POST', '/portal/login', { body: { taller: T.slug, email, password: 'mala-11' } });
  assert.equal(once.status, 429, `el intento 11 en el minuto se corta: ${once.status} ${JSON.stringify(once.json)}`);
  // La cuenta es la misma: cambiar de entrada no da intentos nuevos.
  const principal = await pedir('POST', '/auth/login', { body: { email, password: 'mala-12' } });
  assert.equal(principal.status, 429, `el login principal comparte el cupo: ${principal.status}`);
});

// ── B-14: índice para los listados de órdenes ──

test('B-14: existe el índice (tenant_id, fecha_ingreso DESC) y el listado lo usa', { skip: sinPg }, async () => {
  const [[idx]] = await pool.query("SELECT indexdef FROM pg_indexes WHERE tablename = 'ordenes_trabajo' AND indexname = 'idx_ordenes_tenant_fecha_ingreso'");
  assert.ok(idx, 'falta el índice');
  assert.match(idx.indexdef, /\(tenant_id, fecha_ingreso DESC\)/);
  const conn = await pool.getConnection();
  try {
    await conn.query('BEGIN');
    // Con pocas filas el planificador puede preferir otro camino, así que se le quita el
    // ordenamiento en memoria: sin un índice que ya venga en ese orden, el plan igual
    // lleva Sort (penalizado) y la prueba falla. El EXPLAIN con datos está en el PR.
    await conn.query('SET LOCAL enable_seqscan = off');
    await conn.query('SET LOCAL enable_sort = off');
    const [plan] = await conn.query(
      'EXPLAIN SELECT id FROM ordenes_trabajo WHERE tenant_id = ? ORDER BY fecha_ingreso DESC LIMIT 50', [T.tenantId]);
    const texto = plan.map((f) => f['QUERY PLAN']).join('\n');
    assert.match(texto, /idx_ordenes_tenant_fecha_ingreso/, texto);
    assert.doesNotMatch(texto, /Sort/, `no debería ordenar en memoria:\n${texto}`);
  } finally {
    await conn.query('ROLLBACK');
    conn.release();
  }
});
