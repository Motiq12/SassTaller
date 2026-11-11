// Dos empresas de verdad, con el servidor de verdad, contra una base que se crea para
// esto: se registran por la misma ruta que usa un taller, y después la empresa B intenta
// leer y escribir todo lo de la empresa A con cada papel (dueño, recepción, mecánico y
// cliente del portal). Al final los datos de A tienen que estar idénticos.
//
//   npm run test:empresas
//
// BORRA Y RECREA LA BASE sasstaller_e2e: por eso se niega a usar cualquier otro nombre, y
// por eso ignora la DATABASE_URL del .env. Nunca toca la base de trabajo ni producción.
// E2E_PG_URL: una conexión a Postgres con permiso de crear bases (por defecto, la local).
const { spawn, spawnSync } = require('child_process');
const path = require('path');
const B = path.join(__dirname, '..');
const { Client, types } = require('pg');
types.setTypeParser(20, Number); // COUNT(*) como número, para comparar
const BASE = process.argv[2] || 'sasstaller_e2e';
if (!/^sasstaller_e2e/.test(BASE)) throw new Error('Esta prueba borra la base: solo acepta nombres sasstaller_e2e*');
const URL_ADMIN = new URL(process.env.E2E_PG_URL || 'postgres://postgres@127.0.0.1:5432/postgres');
if (!['127.0.0.1', 'localhost'].includes(URL_ADMIN.hostname)) throw new Error('Esta prueba solo corre contra un Postgres local');
const URL_BASE = new URL(URL_ADMIN); URL_BASE.pathname = `/${BASE}`;
const ENV_BASE = {
  ...process.env, DATABASE_URL: URL_BASE.href, MIGRACION_DATABASE_URL: '', DATABASE_SSL: '', PGSSLMODE: 'disable',
  JWT_SECRET: process.env.JWT_SECRET || 'solo-para-esta-prueba',
};
// Mismo idioma que el resto del backend: `?` y `const [filas] = ...`.
async function abrir(url) {
  const c = new Client({ connectionString: url });
  await c.connect();
  return {
    query: async (sql, params = []) => {
      let n = 0;
      return [(await c.query(sql.replace(/\?/g, () => '$' + (++n)), params)).rows];
    },
    end: () => c.end(),
  };
}
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
  const raiz = await abrir(URL_ADMIN.href);
  await raiz.query(`DROP DATABASE IF EXISTS "${BASE}" WITH (FORCE)`);
  await raiz.query(`CREATE DATABASE "${BASE}"`);
  await raiz.end();
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

    const db = await abrir(URL_BASE.href);
    // Filas viejas de antes de la prueba: su usuario pudo borrarse y su id reutilizarse.
    const [[{ eventoInicial }]] = await db.query('SELECT COALESCE(MAX(id), 0) AS "eventoInicial" FROM eventos_seguridad');

    // ── Alta de dos empresas ──
    const alta = (slug, email, extra = {}) => pedir('POST', '/onboarding', { body: { nombre: `Taller ${slug}`, slug, admin: { nombre: `Dueño ${slug}`, email, password: 'ClaveSegura123' }, tipos: ['auto'], ...extra } });
    const sello = Date.now().toString(36);
    const LOGO = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEBgIApD5fRAAAAABJRU5ErkJggg==';
    const ra = await alta(`alfa-${sello}`, `alfa-${sello}@prueba.test`, { logo: LOGO, color_primario: '#15803d', razon_social: 'Alfa S.A.' });
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
      const [tablas] = await db.query("SELECT TABLE_NAME t FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = current_schema() AND COLUMN_NAME = 'tenant_id'");
      const foto = {};
      for (const { t } of tablas) {
        if (/^motiq_/.test(t)) continue;
        const [filas] = await db.query(`SELECT * FROM "${t}" WHERE tenant_id = ?`, [A.id]);
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
    const [cols] = await db.query("SELECT c.TABLE_NAME t, c.COLUMN_NAME col FROM information_schema.COLUMNS c JOIN information_schema.COLUMNS tn ON tn.TABLE_SCHEMA = c.TABLE_SCHEMA AND tn.TABLE_NAME = c.TABLE_NAME AND tn.COLUMN_NAME = 'tenant_id' WHERE c.TABLE_SCHEMA = current_schema()");
    let revisadas = 0;
    for (const { t, col } of cols) {
      if (!padres[col] || /^motiq_/.test(t)) continue;
      const [[{ n }]] = await db.query(`SELECT COUNT(*) n FROM "${t}" x JOIN "${padres[col]}" y ON y.id = x."${col}" WHERE x.tenant_id <> y.tenant_id ${t === 'eventos_seguridad' ? `AND x.id > ${eventoInicial}` : ''}`);
      revisadas++;
      if (n) ok(false, `${t}.${col} apunta a otro taller en ${n} filas`);
    }
    ok(true, `revisadas ${revisadas} referencias entre tablas`);

    // Y A sí lo ve: si el canario no aparece en ningún lado, la prueba no prueba nada.
    const propio = await pedir('GET', `/clientes/${clienteA}`, { token: A.token });
    ok(propio.status === 200 && propio.texto.includes(CANARIO), 'A sí ve su propio dato (la prueba es válida)', propio.status);

    // ── Errores y cuerpos enormes ──
    const malFormada = await fetch(url.slice(0, -4) + '/%E0%A4%A');
    const cuerpoError = await malFormada.text();
    ok(malFormada.status === 400 && !/node_modules|URIError|\.js:\d/.test(cuerpoError), 'una dirección mal formada no muestra la traza del servidor', cuerpoError.slice(0, 120));
    const enorme = await pedir('POST', '/auth/login', { body: { email: 'a@b.co', password: 'x'.repeat(300 * 1024) } });
    ok(enorme.status === 413, 'el login rechaza un cuerpo de 300 KB', enorme.status);

    // ── Portal público de cada una ──
    const pa = await pedir('GET', `/marca/publica?taller=${A.slug}`);
    const pb = await pedir('GET', `/marca/publica?taller=${Bb.slug}`);
    ok(pa.status === 200 && pa.json.data.logo === LOGO && pa.json.data.color_primario === '#15803d', 'A se ve con su logo y su color', pa.json);
    ok(pb.status === 200 && !pb.json.data.logo && pb.json.data.color_primario !== '#15803d', 'B no recibe la marca de A', pb.json);
    const logoMalo = await alta(`gamma-${sello}`, `gamma-${sello}@prueba.test`, { logo: 'data:image/svg+xml;base64,PHN2Zz4=' });
    ok(logoMalo.status === 400, 'un logo SVG se rechaza al registrarse', logoMalo.json);
    const sinTaller = await pedir('GET', '/portal/servicios');
    ok(sinTaller.status >= 400, 'el portal sin decir de qué taller no responde datos', sinTaller.status);

    // ── Buscador público ──
    const conZona = await alta(`delta-${sello}`, `delta-${sello}@prueba.test`, { provincia: 'Guanacaste', canton: 'Liberia', visible_buscador: true, logo: LOGO });
    ok(conZona.status === 201, 'se registra una empresa con ubicación', conZona.json);
    // B tiene ubicación pero no pidió aparecer. (El alta admite 3 por minuto: se reusa B.)
    const zonaB = await pedir('PUT', `/admin/sucursales/${sb.id}`, { token: Bb.token, body: { nombre: 'Sede B', provincia: 'Guanacaste', canton: 'Liberia' } });
    ok(zonaB.status === 200 && zonaB.json.data.canton === 'Liberia', 'B guarda la ubicación de su sucursal', zonaB.json);
    const zonaMala = await pedir('PUT', `/admin/sucursales/${sb.id}`, { token: Bb.token, body: { nombre: 'Sede B', provincia: 'Guanacaste', canton: 'Escazú' } });
    ok(zonaMala.status === 400, 'un cantón de otra provincia se rechaza', zonaMala.json);
    const halladas = await pedir('GET', '/directorio/talleres?provincia=Guanacaste&canton=Liberia');
    const slugs = (halladas.json.data || []).map((t) => t.slug);
    ok(halladas.status === 200 && slugs.includes(`delta-${sello}`), 'la empresa visible aparece en su cantón', halladas.json);
    ok(!slugs.includes(Bb.slug), 'la que no quiso aparecer no sale, aunque tenga ubicación', slugs);
    ok(!slugs.includes(A.slug), 'la que no indicó ubicación no sale', slugs);
    const publico = JSON.stringify(halladas.json);
    ok(!/prueba\.test|password|tenant_id|base64/.test(publico), 'el buscador solo devuelve datos públicos', publico.slice(0, 200));
    const otraZona = await pedir('GET', '/directorio/talleres?provincia=Lim%C3%B3n');
    ok(otraZona.status === 200 && !(otraZona.json.data || []).some((t) => t.slug === `delta-${sello}`), 'no aparece en otra provincia');
    const sinFiltro = await pedir('GET', '/directorio/talleres');
    ok(sinFiltro.status === 400, 'no se puede descargar el directorio sin filtrar', sinFiltro.status);
    const porNombre = await pedir('GET', `/directorio/talleres?q=${encodeURIComponent('delta-' + sello)}`);
    ok(porNombre.status === 200 && porNombre.json.data.length === 1, 'se encuentra por nombre', porNombre.json);
    const comodin = await pedir('GET', '/directorio/talleres?q=%25%25');
    ok(comodin.status === 200 && comodin.json.data.length === 0, 'un % no trae todos los talleres', comodin.json);

    const sinZona = await pedir('PATCH', '/admin/buscador', { token: A.token, body: { visible: true } });
    ok(sinZona.status === 400, 'sin ubicación no se puede activar', sinZona.json);
    const activar = await pedir('PATCH', '/admin/buscador', { token: Bb.token, body: { visible: true } });
    const conB = await pedir('GET', '/directorio/talleres?provincia=Guanacaste&canton=Liberia');
    ok(activar.status === 200 && conB.json.data.some((t) => t.slug === Bb.slug), 'al activarlo aparece', conB.json);
    await pedir('PATCH', '/admin/buscador', { token: Bb.token, body: { visible: false } });
    const sinB = await pedir('GET', '/directorio/talleres?provincia=Guanacaste&canton=Liberia');
    ok(!sinB.json.data.some((t) => t.slug === Bb.slug), 'al desactivarlo desaparece', sinB.json);

    // ── Mecánicos del mismo taller ──
    const creaMec = async (nombre) => {
      const r = await pedir('POST', '/usuarios', { token: A.token, body: { nombre, email: `${nombre}-${sello}@prueba.test`, password: 'ClaveSegura123', rol: 'tecnico', sucursal_id: sa.id, telefono: '88880002' } });
      ok(r.status < 300, `A crea al mecánico ${nombre}`, r.json);
      return { id: r.json.data.id, token: jwt.sign({ id: r.json.data.id, nombre, email: `${nombre}-${sello}@prueba.test`, rol: 'tecnico', tenant_id: A.id }, process.env.JWT_SECRET, { expiresIn: '2h' }) };
    };
    const m1 = await creaMec('mec1');
    const m2 = await creaMec('mec2');
    const asignar = await pedir('PATCH', `/ordenes/${ordenA}/tecnico`, { token: A.token, body: { tecnico_id: m1.id } });
    ok(asignar.status === 200, 'A le asigna la orden al mecánico 1', asignar.json);
    const suya = await pedir('GET', `/ordenes/${ordenA}`, { token: m1.token });
    ok(suya.status === 200, 'el mecánico 1 ve su orden', suya.status);
    const avanceSuyo = await pedir('POST', `/ordenes/${ordenA}/avances`, { token: m1.token, body: { descripcion: 'Revisado' } });
    ok(avanceSuyo.status < 300, 'el mecánico 1 anota un avance en su orden', avanceSuyo.json);
    const ajenas = [
      ['GET', ''], ['PUT', '', { diagnostico: 'AJENO' }], ['PATCH', '/estado', { estado: 'en_reparacion' }],
      ['POST', '/avances', { descripcion: 'AJENO' }], ['GET', '/avances'], ['GET', '/repuestos'], ['GET', '/tiempos'],
      ['GET', '/checklist'], ['POST', '/checklist', { lavado: 1 }], ['GET', '/fotos'], ['POST', '/fotos', { url: LOGO }],
      ['GET', '/mensajes'], ['POST', '/mensajes', { mensaje: 'AJENO' }],
    ];
    for (const [met, ruta, body] of ajenas) {
      const r = await pedir(met, `/ordenes/${ordenA}${ruta}`, { token: m2.token, body });
      ok(r.status === 404, `el mecánico 2 no puede ${met} /ordenes/:id${ruta}`, r.status);
    }
    const [[{ ajeno }]] = await db.query("SELECT COUNT(*) AS ajeno FROM orden_avances WHERE orden_id = ? AND descripcion = 'AJENO'", [ordenA]);
    ok(ajeno === 0, 'la orden no recibió nada del mecánico 2');
    const pasar = await pedir('PATCH', `/ordenes/${ordenA}/tecnico`, { token: A.token, body: { tecnico_id: m2.id } });
    ok(pasar.status === 200, 'A le pasa la orden al mecánico 2', pasar.json);
    const ahoraM1 = await pedir('GET', `/ordenes/${ordenA}`, { token: m1.token });
    const ahoraM2 = await pedir('GET', `/ordenes/${ordenA}`, { token: m2.token });
    ok(ahoraM1.status === 404 && ahoraM2.status === 200, 'al reasignarla cambia quién la ve', [ahoraM1.status, ahoraM2.status]);
    const recep = await pedir('GET', `/ordenes/${ordenA}`, { token: A.token });
    ok(recep.status === 200, 'el dueño sigue viendo todas', recep.status);

    // ── Tipos de vehículo y color desde Configuración ──
    const conf = (token, extra) => pedir('PUT', '/admin/configuracion', { token, body: { nombre_taller: CANARIO, ...extra } });
    ok((await conf(A.token, { tipos_vehiculo: [] })).status === 400, 'sin ningún tipo no se guarda');
    ok((await conf(A.token, { tipos_vehiculo: ['avion'] })).status === 400, 'un tipo inventado no se guarda');
    const claves = async (token) => (await pedir('GET', '/vehiculos/tipos', { token })).json.data.map((t) => t.clave).join();
    ok(await claves(A.token) === 'auto', 'una lista rechazada no cambió nada', await claves(A.token));
    const ponerTipos = await conf(A.token, { tipos_vehiculo: ['auto', 'bus'], color_primario: '#123456' });
    ok(ponerTipos.status === 200 && ponerTipos.json.data.color_primario === '#123456', 'A cambia su color', ponerTipos.json.data && ponerTipos.json.data.color_primario);
    ok(await claves(A.token) === 'auto,bus', 'A agrega buses', await claves(A.token));
    ok(await claves(Bb.token) === 'auto', 'los tipos de B no cambian', await claves(Bb.token));
    const colorB = await pedir('GET', '/admin/configuracion', { token: Bb.token });
    ok(colorB.json.data.color_primario !== '#123456', 'el color de A no le llega a B', colorB.json.data.color_primario);
    const clienteTok = jwt.sign({ id: clienteA, tipo: 'cliente', nombre: 'Ana', apellido: 'Mora', tenant_id: A.id }, process.env.JWT_SECRET, { expiresIn: '2h' });
    const portalTipos = await pedir('GET', '/portal/vehiculos/tipos', { token: clienteTok });
    ok(portalTipos.status === 200 && portalTipos.json.data.map((t) => t.clave).join() === 'auto,bus', 'el cliente ve los tipos de su taller', portalTipos.json);
    const placaBus = 'BUS' + Math.floor(1000 + Math.random() * 9000);
    const delCliente = { marca: 'Hino', modelo: 'AK', placa: placaBus };
    const busCliente = await pedir('POST', '/portal/vehiculos', { token: clienteTok, body: { ...delCliente, tipo: 'bus', atributos: { pasajeros: 40, inventado: 'x' } } });
    ok(busCliente.status === 201 && busCliente.json.data.tipo === 'bus', 'el cliente registra un bus', busCliente.json);
    ok(busCliente.json.data.atributos.pasajeros === 40 && busCliente.json.data.atributos.inventado === undefined, 'guarda solo los datos propios del tipo', busCliente.json.data.atributos);
    const noAtiende = await pedir('POST', '/portal/vehiculos', { token: clienteTok, body: { ...delCliente, placa: placaBus + 'X', tipo: 'camion' } });
    ok(noAtiende.status === 400, 'un tipo que el taller no atiende se rechaza', noAtiende.json);
    ok((await conf(A.token, { tipos_vehiculo: ['auto'] })).status === 200, 'A deja de atender buses');
    const rutaBus = `/portal/vehiculos/${busCliente.json.data.id}`;
    const sigueBus = await pedir('PUT', rutaBus, { token: clienteTok, body: { ...delCliente, color: 'Azul', tipo: 'bus', atributos: { pasajeros: 30 } } });
    ok(sigueBus.status === 200 && sigueBus.json.data.tipo === 'bus' && sigueBus.json.data.atributos.pasajeros === 30, 'el bus viejo se sigue pudiendo editar', sigueBus.json);
    const aCamion = await pedir('PUT', rutaBus, { token: clienteTok, body: { ...delCliente, color: 'NO', tipo: 'camion' } });
    const [[sinCambio]] = await db.query('SELECT tipo, color FROM vehiculos WHERE id = ?', [busCliente.json.data.id]);
    ok(aCamion.status === 400 && sinCambio.tipo === 'bus' && sinCambio.color === 'Azul', 'un cambio rechazado no guarda nada', [aCamion.status, sinCambio]);

    // ── Abrir la orden desde una cita sin vehículo ──
    const citaSinVeh = await pedir('POST', '/citas', { token: A.token, body: { ...datosCita(clienteA, null, sa.id), hora: '11:00', descripcion: 'x', motivo: 'Sin vehículo' } });
    ok(citaSinVeh.status < 300, 'A agenda una cita sin vehículo', citaSinVeh.json);
    const idSinVeh = citaSinVeh.json.data.id || citaSinVeh.json.data.citaId;
    const rutaOrden = `/recepcion/citas/${idSinVeh}/crear-orden`;
    const sinElegir = await pedir('POST', rutaOrden, { token: A.token, body: {} });
    ok(sinElegir.status === 400, 'sin vehículo pide uno', sinElegir.json);
    const ajena = await pedir('POST', rutaOrden, { token: Bb.token, body: { vehiculo_id: vehB } });
    ok(ajena.status === 404, 'B no puede abrir la orden de una cita de A', ajena.json);
    const desdeCita = await pedir('POST', rutaOrden, { token: A.token, body: { vehiculo_id: vehA } });
    ok(desdeCita.status === 201 && /^OT-/.test(desdeCita.json.data.numero_orden), 'A abre la orden desde la cita', desdeCita.json);
    const otraVez = await pedir('POST', rutaOrden, { token: A.token, body: { vehiculo_id: vehA } });
    ok(otraVez.status === 200 && otraVez.json.data.orden_id === desdeCita.json.data.orden_id, 'el segundo clic devuelve la misma orden', otraVez.json);
    const [[citaLista]] = await db.query('SELECT orden_id, vehiculo_id FROM citas WHERE id = ?', [idSinVeh]);
    ok(citaLista.orden_id === desdeCita.json.data.orden_id && citaLista.vehiculo_id === vehA, 'la cita queda ligada a la orden y al vehículo', citaLista);

    // ── Recorrido de una orden: repuestos, checklist y entrega ──
    const flujo = desdeCita.json.data.orden_id;
    const rutaCotiz = `/recepcion/cotizaciones/${flujo}`;
    const repuesto = await pedir('POST', `${rutaCotiz}/repuestos`, { token: A.token, body: { nombre: 'Pastillas', cantidad: 2, costo_unitario: 1000, estado: 'disponible' } });
    ok(repuesto.status < 300, 'recepción agrega un repuesto', repuesto.json);
    const editado = await pedir('PUT', `${rutaCotiz}/repuestos/${repuesto.json.data.id}`, { token: A.token, body: { nombre: 'Pastillas', cantidad: 1, costo_unitario: 3000, estado: 'disponible' } });
    ok(editado.status < 300, 'recepción edita el repuesto', editado.json);
    const [[conCostos]] = await db.query('SELECT costo_repuestos::float AS c FROM ordenes_trabajo WHERE id = ?', [flujo]);
    ok(conCostos.c === 3000, 'el total de repuestos se recalcula', conCostos);
    const lista1 = await pedir('POST', `/ordenes/${flujo}/checklist`, { token: A.token, body: { lavado: 1, calidad_revisada: 1 } });
    const lista2 = await pedir('POST', `/ordenes/${flujo}/checklist`, { token: A.token, body: { lavado: 0, calidad_revisada: 1 } });
    ok(lista1.status < 300 && lista2.status < 300, 'el checklist se guarda dos veces', [lista1.json, lista2.json]);
    const [[marcado]] = await db.query('SELECT lavado FROM orden_checklist WHERE orden_id = ?', [flujo]);
    ok(Number(marcado.lavado) === 0, 'la segunda vez actualiza la misma fila', marcado);
    await pedir('POST', `${rutaCotiz}/enviar`, { token: A.token, body: {} });
    const aprobada = await pedir('POST', `${rutaCotiz}/aprobar`, { token: A.token, body: {} });
    ok(aprobada.status < 300, 'recepción aprueba la cotización', aprobada.json);
    const paraEntrega = await pedir('PATCH', `/ordenes/${flujo}/estado`, { token: A.token, body: { estado: 'lista_entrega', confirmar: true } });
    ok(paraEntrega.status < 300, 'la orden queda lista', paraEntrega.json);
    const entrega = await pedir('POST', `/recepcion/ordenes/${flujo}/entregar`, { token: A.token, body: { metodo_pago: 'sinpe', garantia_dias: 45 } });
    ok(entrega.status < 300, 'recepción entrega la orden', entrega.json);
    const [[entregada]] = await db.query('SELECT estado, metodo_pago FROM ordenes_trabajo WHERE id = ?', [flujo]);
    ok(entregada.estado === 'entregada' && entregada.metodo_pago === 'sinpe', 'la entrega guarda estado y pago', entregada);

    // ── Reprogramar desde el portal, y borrar citas y órdenes ──
    const catalogo = await pedir('GET', '/portal/servicios', { token: clienteTok });
    const servicio = catalogo.json.data[0].nombre || catalogo.json.data[0];
    const delPortal = { vehiculo_id: vehA, sucursal_id: sa.id, fecha, servicios: [servicio] };
    const agendada = await pedir('POST', '/portal/citas', { token: clienteTok, body: { ...delPortal, hora: '09:00' } });
    ok(agendada.status < 300, 'el cliente agenda', agendada.json);
    const movida = await pedir('PUT', `/portal/citas/${agendada.json.data.id}`, { token: clienteTok, body: { ...delPortal, hora: '12:00' } });
    ok(movida.status < 300, 'el cliente reprograma', movida.json);
    const borrable = await pedir('POST', '/citas', { token: A.token, body: { ...datosCita(clienteA, vehA, sa.id), hora: '08:00', descripcion: 'x', motivo: 'Para borrar' } });
    const idBorrable = borrable.json.data.id || borrable.json.data.citaId;
    const sinCita = await pedir('DELETE', `/citas/${idBorrable}`, { token: A.token, body: { motivo: 'Prueba' } });
    ok(sinCita.status < 300, 'A borra una cita', sinCita.json);
    const paraBorrar = await pedir('POST', '/ordenes', { token: A.token, body: datosOrden(clienteA, vehA, sa.id) });
    const sinOrden = await pedir('DELETE', `/ordenes/${paraBorrar.json.data.id}`, { token: A.token, body: { motivo: 'Prueba' } });
    ok(sinOrden.status < 300, 'A borra una orden', sinOrden.json);
    const [[{ quedan }]] = await db.query('SELECT COUNT(*) AS quedan FROM ordenes_trabajo WHERE id = ?', [paraBorrar.json.data.id]);
    ok(quedan === 0, 'la orden ya no está');
    // ── Correo sin mayúsculas: el login lo compara igual que la recuperación ──
    const correoA = `alfa-${sello}@prueba.test`;
    const enMayus = await pedir('POST', '/auth/login', { body: { email: correoA.toUpperCase(), password: 'ClaveSegura123' } });
    ok(enMayus.status === 200 && enMayus.json.data.tipo === 'staff', 'entra con el correo escrito en mayúsculas', enMayus.json);
    await db.query('UPDATE usuarios SET email = ? WHERE tenant_id = ? AND LOWER(email) = ?', [`Alfa-${sello}@Prueba.Test`, A.id, correoA]);
    const guardadoMayus = await pedir('POST', '/auth/login', { body: { email: correoA, password: 'ClaveSegura123' } });
    ok(guardadoMayus.status === 200, 'entra aunque el correo se haya guardado con mayúsculas', guardadoMayus.json);
    await db.query('UPDATE usuarios SET email = ? WHERE tenant_id = ? AND LOWER(email) = ?', [correoA, A.id, correoA]);

    // ── Roles ──
    const rolesA = await pedir('GET', '/admin/roles', { token: A.token });
    const rolesB = await pedir('GET', '/admin/roles', { token: Bb.token });
    const lista = (r) => (r.json && r.json.data && (r.json.data.roles || r.json.data)) || [];
    const idsA = new Set([].concat(lista(rolesA)).map((x) => x.id));
    ok([].concat(lista(rolesB)).every((x) => !idsA.has(x.id)) && idsA.size > 0, `cada una ve solo sus roles (A=${idsA.size})`, rolesA.status);

    // ── Un taller suspendido no abre sesión ──
    const correoMotiq = `motiq-${sello}@prueba.test`;
    const [[plataforma]] = await db.query("INSERT INTO plataforma_admins (nombre, email, password_hash, activo) VALUES ('Prueba', ?, 'x', 1) RETURNING id", [correoMotiq]);
    const tokenMotiq = jwt.sign({ id: plataforma.id, tipo: 'plataforma', nombre: 'Prueba', email: correoMotiq }, process.env.JWT_SECRET, { expiresIn: '1h' });
    const entrarB = () => pedir('POST', '/auth/login', { body: { email: `beta-${sello}@prueba.test`, password: 'ClaveSegura123' } });
    ok((await entrarB()).status === 200, 'B entra mientras está activa');
    const suspender = await pedir('PATCH', `/motiq/talleres/${Bb.id}/estado`, { token: tokenMotiq, body: { estado: 'suspendido', motivo: 'Prueba' } });
    ok(suspender.status === 200, 'Motiq suspende a B', suspender.json);
    const negado = await entrarB();
    ok(negado.status === 403 && !negado.json.data, 'suspendida no abre sesión', negado.json);
    const reactivar = await pedir('PATCH', `/motiq/talleres/${Bb.id}/estado`, { token: tokenMotiq, body: { estado: 'activo' } });
    ok(reactivar.status === 200 && (await entrarB()).status === 200, 'reactivada vuelve a entrar', reactivar.json);

    // ── Cuadre de la base ──
    const hijos = [['vehiculos', 'cliente_id', 'clientes'], ['citas', 'cliente_id', 'clientes'], ['citas', 'sucursal_id', 'sucursales'], ['ordenes_trabajo', 'cliente_id', 'clientes'], ['ordenes_trabajo', 'sucursal_id', 'sucursales'], ['cita_servicios', 'cita_id', 'citas'], ['usuarios', 'sucursal_id', 'sucursales'], ['sesiones_personal', 'usuario_id', 'usuarios'], ['actividad_personal', 'usuario_id', 'usuarios']];
    for (const [h, col, p] of hijos) {
      const [[{ n }]] = await db.query(`SELECT COUNT(*) n FROM ${h} x JOIN ${p} y ON y.id = x.${col} WHERE x.tenant_id <> y.tenant_id`);
      ok(n === 0, `cuadre ${h}.${col} -> ${p}: ${n} cruzados`);
    }
    const [dflt] = await db.query(`SELECT TABLE_NAME t FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = current_schema() AND COLUMN_NAME = 'tenant_id' AND COLUMN_DEFAULT IS NOT NULL AND COLUMN_DEFAULT <> 'NULL'`);
    ok(dflt.length === 0, 'ninguna tabla le pone taller por defecto', dflt.map((x) => x.t));
    await db.end();

    const errores = salida.split('\n').filter((l) => /TypeError|ReferenceError|tenant-db:/.test(l));
    ok(errores.length === 0, 'el servidor no registró errores de programación', errores.slice(0, 10).map((l) => l.slice(0, 170)));
    if (fallos.length) console.log('--- registro del servidor ---\n' + salida.split('\n').filter((l) => /rror|⚠|Falló/.test(l) && !/Layer.handleError|HEADERS_SENT/.test(l)).slice(-60).join('\n').slice(-6000));
    console.log(fallos.length ? `\n${fallos.length} FALLOS` : '\nTODO BIEN');
    fin(fallos.length ? 1 : 0);
  } catch (e) {
    console.log('ERROR', e.stack);
    console.log(salida.slice(-2500));
    fin(2);
  }
})();
