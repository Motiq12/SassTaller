// Dos empresas de verdad, con el servidor de verdad, contra una base que se crea para
// esto: se registran por la misma ruta que usa un taller, y después la empresa B intenta
// leer y escribir todo lo de la empresa A con cada papel (dueño, recepción, mecánico y
// cliente del portal). Al final los datos de A tienen que estar idénticos.
//
//   npm run test:empresas
//
// BORRA Y RECREA LA BASE sasstaller_e2e: por eso se niega a usar cualquier otro nombre,
// y por eso ignora el DB_NAME del .env. Nunca toca la base de trabajo ni producción.
// Conexión: E2E_DB_HOST, E2E_DB_PORT, E2E_DB_USER, E2E_DB_PASSWORD (por defecto, local).
const { spawn, spawnSync } = require('child_process');
const path = require('path');
const B = path.join(__dirname, '..');
const mysql = require('mysql2/promise');
const BASE = process.argv[2] || 'sasstaller_e2e';
if (!/^sasstaller_e2e/.test(BASE)) throw new Error('Esta prueba borra la base: solo acepta nombres sasstaller_e2e*');
const CONEXION = {
  host: process.env.E2E_DB_HOST || '127.0.0.1',
  port: Number(process.env.E2E_DB_PORT) || 3306,
  user: process.env.E2E_DB_USER || 'root',
  password: process.env.E2E_DB_PASSWORD || '',
};
const ENV_BASE = {
  ...process.env, MYSQL_URL: '', DB_NAME: BASE, DB_HOST: CONEXION.host, DB_PORT: String(CONEXION.port),
  DB_USER: CONEXION.user, DB_PASSWORD: CONEXION.password, JWT_SECRET: process.env.JWT_SECRET || 'solo-para-esta-prueba',
  SEED_ADMIN_PASSWORD: '', SEED_RECEP_PASSWORD: '',
};
Object.assign(process.env, { JWT_SECRET: ENV_BASE.JWT_SECRET });
const PORT = 3199;
const url = `http://127.0.0.1:${PORT}/api`;
const fallos = [];
const ok = (c, msg, extra) => { console.log(`${c ? 'ok  ' : 'MAL '} ${msg}${!c && extra !== undefined ? '  -> ' + JSON.stringify(extra).slice(0, 220) : ''}`); if (!c) fallos.push(msg); };

async function pedir(met, ruta, { token, body, taller } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  if (taller) headers['x-taller'] = taller;
  const r = await fetch(url + ruta, { method: met, headers, body: body ? JSON.stringify(body) : undefined });
  const texto = await r.text();
  let json = null; try { json = JSON.parse(texto); } catch { /* */ }
  return { status: r.status, json, texto };
}

(async () => {
  const raiz = await mysql.createConnection(CONEXION);
  await raiz.query(`DROP DATABASE IF EXISTS \`${BASE}\``);
  await raiz.query(`CREATE DATABASE \`${BASE}\` CHARACTER SET utf8mb4`);
  await raiz.end();
  const migracion = spawnSync('node', ['src/db/migrate.js'], { cwd: B, env: ENV_BASE, encoding: 'utf8' });
  if (migracion.status !== 0) throw new Error('schema.sql falló: ' + (migracion.stdout + migracion.stderr).slice(-1500));
  const server = spawn('node', ['src/server.js'], {
    cwd: B,
    env: { ...ENV_BASE, PORT: String(PORT), RESEND_API_KEY: '', TURNSTILE_SECRET: '', TURNSTILE_SECRET_KEY: '', MOTIQ_ADMIN_EMAIL: '', MOTIQ_ADMIN_PASSWORD: '', RATE_API_MAX: '1000000', RATE_ADMIN_MAX: '1000000', RATE_AUTH_MAX: '1000000', NODE_ENV: 'development' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let salida = '';
  server.stdout.on('data', (d) => { salida += d; });
  server.stderr.on('data', (d) => { salida += d; });
  const fin = (c) => { server.kill(); process.exit(c); };
  try {
    let listo = false;
    for (let i = 0; i < 90 && !listo; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      try { await fetch(url + '/health'); listo = true; } catch { /* */ }
    }
    if (!listo) { console.log(salida.slice(-3000)); throw new Error('el servidor no arrancó'); }
    const lineas = salida.split('\n').filter((l) => /⚠|❌|error|Error|falló|fallo/.test(l));
    console.log(`arranque: ${lineas.length} avisos`);
    lineas.slice(0, 30).forEach((l) => console.log('   ' + l.slice(0, 170)));

    const db = await mysql.createConnection({ ...CONEXION, database: BASE });
    // Filas viejas de antes de la prueba: su usuario pudo borrarse y su id reutilizarse.
    const [[{ eventoInicial }]] = await db.query('SELECT COALESCE(MAX(id), 0) eventoInicial FROM eventos_seguridad');

    // ── Alta de dos empresas ──
    const alta = (slug, email) => pedir('POST', '/onboarding', { body: { nombre: `Taller ${slug}`, slug, admin: { nombre: `Dueño ${slug}`, email, password: 'ClaveSegura123' }, tipos: ['auto'] } });
    const sello = Date.now().toString(36);
    const ra = await alta(`alfa-${sello}`, `alfa-${sello}@prueba.test`);
    const rb = await alta(`beta-${sello}`, `beta-${sello}@prueba.test`);
    ok(ra.status === 201, 'se registra la empresa A', ra.json);
    ok(rb.status === 201, 'se registra la empresa B', rb.json);
    if (ra.status !== 201 || rb.status !== 201) { console.log(salida.slice(-2500)); return fin(1); }
    const A = { token: ra.json.data.token, id: ra.json.data.taller.id, slug: ra.json.data.taller.slug };
    const Bb = { token: rb.json.data.token, id: rb.json.data.taller.id, slug: rb.json.data.taller.slug };
    ok(A.id !== Bb.id, 'tienen id distinto');

    for (const t of ['configuracion', 'sucursales', 'servicios', 'roles']) {
      const [[{ a }]] = await db.query(`SELECT COUNT(*) a FROM ${t} WHERE tenant_id = ?`, [A.id]);
      const [[{ b }]] = await db.query(`SELECT COUNT(*) b FROM ${t} WHERE tenant_id = ?`, [Bb.id]);
      ok(a > 0 && b > 0, `cada una nace con su ${t} (A=${a}, B=${b})`);
    }

    // ── Mismos datos en las dos: nada choca ──
    const CANARIO = `CANARIO${sello}`.toUpperCase();
    const placa = `E2E${sello.slice(-3).toUpperCase()}`;
    const emailCliente = `cliente-${sello}@prueba.test`;
    const datosCliente = (quien) => ({ nombre: quien === 'A' ? CANARIO : 'Ana', apellido: 'Mora', telefono: '88881234', email: emailCliente, cedula: '112340567', tipo_cedula: 'fisica' });
    const ca = await pedir('POST', '/clientes', { token: A.token, body: datosCliente('A') });
    const cb = await pedir('POST', '/clientes', { token: Bb.token, body: datosCliente('B') });
    ok(ca.status < 300, 'A crea un cliente', ca.json);
    ok(cb.status < 300, 'B crea un cliente con el MISMO correo', cb.json);
    const clienteA = ca.json && ca.json.data && (ca.json.data.id || ca.json.data.insertId);
    const clienteB = cb.json && cb.json.data && (cb.json.data.id || cb.json.data.insertId);
    const datosVeh = (cliente) => ({ cliente_id: cliente, placa, marca: 'Toyota', modelo: CANARIO, anio: 2020, tipo: 'auto', color: 'Rojo', cilindraje: 150 });
    const va = await pedir('POST', '/vehiculos', { token: A.token, body: datosVeh(clienteA) });
    const vb = await pedir('POST', '/vehiculos', { token: Bb.token, body: { ...datosVeh(clienteB), modelo: 'Corolla' } });
    ok(va.status < 300, 'A registra un vehículo', va.json);
    ok(vb.status < 300, 'B registra la MISMA placa', vb.json);
    const vehA = va.json && va.json.data && va.json.data.id;
    const vehB = vb.json && vb.json.data && vb.json.data.id;
    const mal = await pedir('POST', '/vehiculos', { token: Bb.token, body: { ...datosVeh(clienteA), placa: `X${placa}` } });
    ok(mal.status >= 400, 'B no puede colgarle un vehículo a un cliente de A', mal.json);

    // ── Citas y órdenes ──
    const manana = new Date(Date.now() + 3 * 864e5);
    while (manana.getDay() === 0) manana.setDate(manana.getDate() + 1);
    const fecha = manana.toISOString().slice(0, 10);
    const [[sa]] = await db.query('SELECT MIN(id) id FROM sucursales WHERE tenant_id = ?', [A.id]);
    const [[sb]] = await db.query('SELECT MIN(id) id FROM sucursales WHERE tenant_id = ?', [Bb.id]);
    const datosCita = (cliente, veh, suc) => ({ cliente_id: cliente, vehiculo_id: veh, moto_id: veh, sucursal_id: suc, fecha, hora: '10:00', servicios: ['Revisión general'], tipo_servicio: 'Revisión general', descripcion: CANARIO, motivo: CANARIO });
    const cita = await pedir('POST', '/citas', { token: A.token, body: datosCita(clienteA, vehA, sa.id) });
    ok(cita.status < 300, 'A agenda una cita', cita.json);
    const citaA = cita.json && cita.json.data && (cita.json.data.id || cita.json.data.citaId);
    const citaB = await pedir('POST', '/citas', { token: Bb.token, body: { ...datosCita(clienteB, vehB, sb.id), descripcion: 'x', motivo: 'x' } });
    ok(citaB.status < 300, 'B agenda a la misma hora: el cupo es de cada una', citaB.json);
    const citaCruzada = await pedir('POST', '/citas', { token: Bb.token, body: { ...datosCita(clienteB, vehB, sa.id), descripcion: 'x', motivo: 'x', hora: '11:00' } });
    ok(citaCruzada.status >= 400 || citaCruzada.json.data.sucursal_id !== sa.id, 'B no puede agendar en la sucursal de A', citaCruzada.json);
    const datosOrden = (cliente, veh, suc) => ({ cliente_id: cliente, vehiculo_id: veh, moto_id: veh, sucursal_id: suc, descripcion: CANARIO, diagnostico: CANARIO, trabajo_solicitado: CANARIO, problema_reportado: CANARIO, tipo_servicio: 'Revisión general', servicio: 'Revisión general' });
    const oa = await pedir('POST', '/ordenes', { token: A.token, body: datosOrden(clienteA, vehA, sa.id) });
    const ob = await pedir('POST', '/ordenes', { token: Bb.token, body: { ...datosOrden(clienteB, vehB, sb.id), descripcion: 'x', diagnostico: 'x', trabajo_solicitado: 'x', problema_reportado: 'x' } });
    ok(oa.status < 300, 'A abre una orden', oa.json);
    ok(ob.status < 300, 'B abre una orden', ob.json);
    const ordenA = oa.json && oa.json.data && oa.json.data.id;
    const [[na]] = await db.query('SELECT numero_orden n FROM ordenes_trabajo WHERE tenant_id = ? ORDER BY id DESC LIMIT 1', [A.id]);
    const [[nb]] = await db.query('SELECT numero_orden n FROM ordenes_trabajo WHERE tenant_id = ? ORDER BY id DESC LIMIT 1', [Bb.id]);
    ok(na && nb && na.n === nb.n, `cada una lleva su numeración (A=${na && na.n}, B=${nb && nb.n})`);

    // ── Configuración ──
    const cfg = await pedir('PUT', '/admin/configuracion', { token: A.token, body: { nombre_taller: CANARIO } });
    ok(cfg.status < 300, 'A cambia el nombre de su taller', cfg.json);
    const cfgB = await pedir('GET', '/admin/configuracion', { token: Bb.token });
    ok(cfgB.status === 200 && !cfgB.texto.includes(CANARIO), 'a B no le cambia', cfgB.status);

    // ── Acceso directo a lo de la otra ──
    const cruzados = [
      ['GET', `/clientes/${clienteA}`], ['PUT', `/clientes/${clienteA}`, { nombre: 'Hackeado', apellido: 'x', telefono: '1' }], ['DELETE', `/clientes/${clienteA}`],
      ['GET', `/vehiculos/${vehA}`], ['PUT', `/vehiculos/${vehA}`, { placa: 'HACK', marca: 'x', modelo: 'x' }], ['DELETE', `/vehiculos/${vehA}`],
      ['GET', `/citas/${citaA}`], ['DELETE', `/citas/${citaA}`], ['PATCH', `/citas/${citaA}/estado`, { estado: 'cancelado' }],
      ['GET', `/ordenes/${ordenA}`], ['DELETE', `/ordenes/${ordenA}`], ['PATCH', `/ordenes/${ordenA}/estado`, { estado: 'entregada' }],
      ['POST', `/ordenes/${ordenA}/avances`, { descripcion: 'HACK', mensaje: 'HACK' }],
      ['POST', `/ordenes/${ordenA}/repuestos`, { nombre: 'HACK', cantidad: 1, precio: 1 }],
      ['PUT', `/ordenes/${ordenA}/checklist`, { items: {} }],
    ];
    for (const [met, ruta, body] of cruzados) {
      const r = await pedir(met, ruta, { token: Bb.token, body });
      const tiene = r.texto.includes(CANARIO);
      ok(r.status >= 400 && r.status !== 500 && !tiene, `B ${met} ${ruta.replace(/\d+/g, ':id')} -> ${r.status}`, r.texto.slice(0, 160));
    }
    const [[cSigue]] = await db.query('SELECT nombre FROM clientes WHERE id = ?', [clienteA]);
    ok(cSigue && cSigue.nombre === CANARIO, 'el cliente de A sigue intacto');
    const [hack] = await db.query("SELECT 1 FROM orden_avances WHERE orden_id = ? AND tenant_id <> ?", [ordenA, A.id]).catch(() => [[]]);
    ok(hack.length === 0, 'B no le agregó avances a la orden de A');

    // ── Canario: B recorre TODOS los GET y nunca ve el dato de A ──
    const rutasGet = [];
    const mounts = { auth: 'auth', onboarding: 'onboarding', avisos: 'avisos', reportes: 'reportes', vehiculos: 'vehiculos', marca: 'marca', clientes: 'clientes', ordenes: 'ordenes', citas: 'citas', usuarios: 'usuarios', dashboard: 'dashboard', garantias: 'garantias', promos: 'promos', mecanico: 'mecanico', recepcion: 'recepcion', mensajeria: 'mensajeria', admin: 'admin', metricas: 'metricas' };
        for (const [m, f] of Object.entries(mounts)) {
      const r = require(path.join(B, 'src/routes', `${f}.routes`));
      for (const c of r.stack) if (c.route && c.route.methods.get) for (const p of [].concat(c.route.path)) rutasGet.push(`/${m}${p}`);
    }
    const ids = { id: [clienteA, vehA, citaA, ordenA] };
    let vistas = 0, quinientos = [], fugas = [], limite = 0;
    for (const r of rutasGet) {
      for (const id of /:/.test(r) ? ids.id : [0]) {
        const u = r.replace(/:[A-Za-z_]+/g, String(id));
        const x = await pedir('GET', u, { token: Bb.token });
        vistas++;
        if (x.status === 429) { limite++; await new Promise((s) => setTimeout(s, 1500)); }
        if (x.status >= 500) quinientos.push(`${x.status} ${u}`);
        if (x.texto.includes(CANARIO)) fugas.push(u);
      }
    }
    ok(fugas.length === 0, `canario: ${vistas} pedidos con la sesión de B, ninguno ve datos de A`, fugas);
    ok(quinientos.length === 0, 'ningún GET revienta con 500', [...new Set(quinientos)].slice(0, 15));
    if (limite) console.log(`   (${limite} respuestas 429 por el tope de peticiones)`);

    // ── B intenta ESCRIBIR sobre todo lo de A, por todas las rutas ──
    const fotoDeA = async () => {
      const [tablas] = await db.query("SELECT TABLE_NAME t FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND COLUMN_NAME = 'tenant_id'");
      const foto = {};
      for (const { t } of tablas) {
        if (/^motiq_/.test(t)) continue;
        const [filas] = await db.query(`SELECT * FROM \`${t}\` WHERE tenant_id = ?`, [A.id]);
        foto[t] = JSON.stringify(filas);
      }
      return foto;
    };
    const [[adminA]] = await db.query("SELECT id FROM usuarios WHERE tenant_id = ? AND rol = 'admin' LIMIT 1", [A.id]);
    const [[servA]] = await db.query('SELECT id FROM servicios WHERE tenant_id = ? LIMIT 1', [A.id]);
    const [[rolA]] = await db.query('SELECT id FROM roles WHERE tenant_id = ? LIMIT 1', [A.id]);
    const objetivos = [clienteA, vehA, citaA, ordenA, adminA.id, sa.id, servA.id, rolA.id];
    const cuerpo = {
      nombre: 'HACK', apellido: 'HACK', telefono: '88880000', email: `hack-${sello}@prueba.test`, cedula: '999999999', tipo_cedula: 'fisica', password: 'ClaveSegura123',
      cliente_id: clienteA, vehiculo_id: vehA, moto_id: vehA, cita_id: citaA, orden_id: ordenA, sucursal_id: sa.id, tecnico_id: adminA.id, usuario_id: adminA.id, destino_id: adminA.id, rol_id: rolA.id, rol: 'recepcion',
      placa: `H${sello.slice(-5)}`.toUpperCase(), marca: 'HACK', modelo: 'HACK', anio: 2020, fecha: fecha, hora: '12:00', motivo: 'HACK', problema_reportado: 'HACK', descripcion: 'HACK', mensaje: 'HACK', estado: 'cancelado', servicios: [], items: [], cantidad: 1, precio: 1, monto: 1, activo: 0, activa: 0, base: 'taller', permisos: [],
    };
    const antes = await fotoDeA();
    const rutasEscritura = [];
    for (const [m, f] of Object.entries(mounts)) {
      if (m === 'auth' || m === 'onboarding') continue;
      const r = require(path.join(B, 'src/routes', `${f}.routes`));
      for (const c of r.stack) if (c.route) for (const met of Object.keys(c.route.methods)) if (met !== 'get' && /:/.test(String(c.route.path))) rutasEscritura.push([met.toUpperCase(), `/${m}${c.route.path}`]);
    }
    let escrituras = 0; const exitos = []; const revientan = [];
    const jwt = require('jsonwebtoken');
    const creaUsuario = async (rol) => {
      const r = await pedir('POST', '/usuarios', { token: Bb.token, body: { nombre: rol, email: `${rol}-${sello}@prueba.test`, password: 'ClaveSegura123', rol, sucursal_id: sb.id, telefono: '88880001' } });
      ok(r.status < 300, `B crea un usuario ${rol}`, r.json);
      const id = r.json.data.id;
      return jwt.sign({ id, nombre: rol, email: `${rol}-${sello}@prueba.test`, rol, tenant_id: Bb.id }, process.env.JWT_SECRET, { expiresIn: '2h' });
    };
    const sesiones = {
      admin: Bb.token,
      recepcion: await creaUsuario('recepcion'),
      tecnico: await creaUsuario('tecnico'),
      cliente: jwt.sign({ id: clienteB, tipo: 'cliente', nombre: 'Ana', apellido: 'Mora', tenant_id: Bb.id }, process.env.JWT_SECRET, { expiresIn: '2h' }),
    };
    // Los mismos GET, ahora con cada papel y también los del portal.
    const portal = require(path.join(B, 'src/routes/portal.routes'));
    const getsPortal = [];
    for (const c of portal.stack) if (c.route && c.route.methods.get) getsPortal.push(`/portal${c.route.path}`);
    const fugas2 = [];
    for (const [quien, token] of Object.entries(sesiones)) {
      for (const r of [...rutasGet, ...getsPortal]) {
        for (const id of /:/.test(r) ? objetivos : [0]) {
          const x = await pedir('GET', r.replace(/:[A-Za-z_]+/g, String(id)), { token });
          if (x.texto.includes(CANARIO)) fugas2.push(`${quien} ${r}`);
          if (x.status >= 500) revientan.push(`${x.status} ${quien} GET ${r}`);
        }
      }
    }
    ok(fugas2.length === 0, 'canario con admin, recepción, mecánico y cliente del portal de B: nada de A', [...new Set(fugas2)]);
    for (const c of portal.stack) if (c.route) for (const met of Object.keys(c.route.methods)) if (met !== 'get' && /:/.test(String(c.route.path))) rutasEscritura.push([met.toUpperCase(), `/portal${c.route.path}`]);
    for (const [quien, token] of Object.entries(sesiones)) {
      for (const [met, r] of rutasEscritura) {
        for (const id of objetivos) {
          const x = await pedir(met, r.replace(/:[A-Za-z_]+/g, String(id)), { token, body: cuerpo });
          escrituras++;
          if (x.status >= 500) revientan.push(`${x.status} ${quien} ${met} ${r}`);
        }
      }
    }
    const despues = await fotoDeA();
    const cambiaron = Object.keys(antes).filter((t) => antes[t] !== despues[t]);
    ok(cambiaron.length === 0, `${escrituras} escrituras de B sobre ${rutasEscritura.length} rutas: A queda idéntica`, cambiaron);
    for (const t of cambiaron.slice(0, 5)) {
      const a = JSON.parse(antes[t]); const d = JSON.parse(despues[t]);
      console.log(`   ${t}: ${a.length} -> ${d.length} filas`);
      const dif = d.find((x, i) => JSON.stringify(x) !== JSON.stringify(a[i]));
      if (dif) console.log('     ' + JSON.stringify(dif).slice(0, 240));
    }
    ok(revientan.length === 0, 'ninguna escritura revienta con 500', [...new Set(revientan)].slice(0, 25));
    const sigue = await pedir('GET', '/clientes', { token: Bb.token });
    ok(sigue.status === 200, 'la sesión de B siguió viva durante toda la prueba', sigue.status);

    // Lo que B escribió nunca apunta a filas de A.
    const padres = { cliente_id: 'clientes', vehiculo_id: 'vehiculos', moto_id: 'vehiculos', cita_id: 'citas', orden_id: 'ordenes_trabajo', sucursal_id: 'sucursales', tecnico_id: 'usuarios', usuario_id: 'usuarios', remitente_id: 'usuarios', asignado_a: 'usuarios', rol_id: 'roles' };
    const [cols] = await db.query("SELECT c.TABLE_NAME t, c.COLUMN_NAME col FROM information_schema.COLUMNS c JOIN information_schema.COLUMNS tn ON tn.TABLE_SCHEMA = c.TABLE_SCHEMA AND tn.TABLE_NAME = c.TABLE_NAME AND tn.COLUMN_NAME = 'tenant_id' WHERE c.TABLE_SCHEMA = DATABASE()");
    let revisadas = 0;
    for (const { t, col } of cols) {
      if (!padres[col] || /^motiq_/.test(t)) continue;
      const [[{ n }]] = await db.query(`SELECT COUNT(*) n FROM \`${t}\` x JOIN \`${padres[col]}\` y ON y.id = x.\`${col}\` WHERE x.tenant_id <> y.tenant_id ${t === 'eventos_seguridad' ? `AND x.id > ${eventoInicial}` : ''}`);
      revisadas++;
      if (n) ok(false, `${t}.${col} apunta a otro taller en ${n} filas`);
    }
    ok(true, `revisadas ${revisadas} referencias entre tablas`);

    // Y A sí lo ve: si el canario no aparece en ningún lado, la prueba no prueba nada.
    const propio = await pedir('GET', `/clientes/${clienteA}`, { token: A.token });
    ok(propio.status === 200 && propio.texto.includes(CANARIO), 'A sí ve su propio dato (la prueba es válida)', propio.status);

    // ── Portal público de cada una ──
    const pa = await pedir('GET', `/marca/publica?taller=${A.slug}`);
    const pb = await pedir('GET', `/marca/publica?taller=${Bb.slug}`);
    console.log(`   marca pública A ${pa.status}, B ${pb.status}`);
    const sinTaller = await pedir('GET', '/portal/servicios');
    ok(sinTaller.status >= 400, 'el portal sin decir de qué taller no responde datos', sinTaller.status);

    // ── Roles ──
    const rolesA = await pedir('GET', '/admin/roles', { token: A.token });
    const rolesB = await pedir('GET', '/admin/roles', { token: Bb.token });
    const lista = (r) => (r.json && r.json.data && (r.json.data.roles || r.json.data)) || [];
    const idsA = new Set([].concat(lista(rolesA)).map((x) => x.id));
    ok([].concat(lista(rolesB)).every((x) => !idsA.has(x.id)) && idsA.size > 0, `cada una ve solo sus roles (A=${idsA.size})`, rolesA.status);

    // ── Cuadre de la base ──
    const hijos = [['vehiculos', 'cliente_id', 'clientes'], ['citas', 'cliente_id', 'clientes'], ['citas', 'sucursal_id', 'sucursales'], ['ordenes_trabajo', 'cliente_id', 'clientes'], ['ordenes_trabajo', 'sucursal_id', 'sucursales'], ['cita_servicios', 'cita_id', 'citas'], ['usuarios', 'sucursal_id', 'sucursales'], ['sesiones_personal', 'usuario_id', 'usuarios'], ['actividad_personal', 'usuario_id', 'usuarios']];
    for (const [h, col, p] of hijos) {
      const [[{ n }]] = await db.query(`SELECT COUNT(*) n FROM ${h} x JOIN ${p} y ON y.id = x.${col} WHERE x.tenant_id <> y.tenant_id`);
      ok(n === 0, `cuadre ${h}.${col} -> ${p}: ${n} cruzados`);
    }
    const [dflt] = await db.query(`SELECT TABLE_NAME t FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND COLUMN_NAME = 'tenant_id' AND COLUMN_DEFAULT IS NOT NULL AND COLUMN_DEFAULT <> 'NULL'`);
    ok(dflt.length === 0, 'ninguna tabla le pone taller por defecto', dflt.map((x) => x.t));
    await db.end();

    const errores = salida.split('\n').filter((l) => /TypeError|ReferenceError|tenant-db:/.test(l));
    ok(errores.length === 0, 'el servidor no registró errores de programación', errores.slice(0, 10).map((l) => l.slice(0, 170)));
    console.log(fallos.length ? `\n${fallos.length} FALLOS` : '\nTODO BIEN');
    fin(fallos.length ? 1 : 0);
  } catch (e) {
    console.log('ERROR', e.stack);
    console.log(salida.slice(-2500));
    fin(2);
  }
})();
