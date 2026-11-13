const { test } = require('node:test');
const assert = require('node:assert');

// Modo degradado: sin RESEND_API_KEY no debe llamar a la red ni lanzar,
// solo loguear el código y devolver true (para que el flujo siga en desarrollo).
test('enviarCodigoReset sin API key devuelve true y no usa fetch', async () => {
  const prevKey = process.env.RESEND_API_KEY;
  delete process.env.RESEND_API_KEY;

  const fetchOriginal = global.fetch;
  let fetchLlamado = false;
  global.fetch = async () => { fetchLlamado = true; return { ok: true }; };

  const origLog = console.log;
  console.log = () => {};

  try {
    const { enviarCodigoReset } = require('../src/services/mailer');
    const ok = await enviarCodigoReset('user@correo.com', 'Ana', '123456');
    assert.equal(ok, true);
    assert.equal(fetchLlamado, false, 'no debe contactar a Resend sin API key');
  } finally {
    global.fetch = fetchOriginal;
    console.log = origLog;
    if (prevKey !== undefined) process.env.RESEND_API_KEY = prevKey;
  }
});

// Las plantillas nuevas (recordatorio de cita, aviso de estado) comparten el mismo
// núcleo de envío: en modo dev también degradan sin lanzar ni contactar la red.
test('enviarRecordatorioCita y enviarAvisoEstado degradan sin API key', async () => {
  const prevKey = process.env.RESEND_API_KEY;
  delete process.env.RESEND_API_KEY;

  const fetchOriginal = global.fetch;
  let fetchLlamado = false;
  global.fetch = async () => { fetchLlamado = true; return { ok: true }; };

  const origLog = console.log;
  console.log = () => {};

  try {
    const { enviarRecordatorioCita, enviarAvisoEstado } = require('../src/services/mailer');
    const ok1 = await enviarRecordatorioCita('cliente@correo.com', {
      nombre: 'Ana', hora: '10:00', servicio: 'Cambio de aceite', moto: 'Honda CB', sucursal: 'Liberia', taller: 'MS Motos',
    });
    const ok2 = await enviarAvisoEstado('cliente@correo.com', {
      nombre: 'Ana', titulo: 'Tu moto está lista', mensaje: 'Honda CB ya está lista.', taller: 'MS Motos',
    });
    assert.equal(ok1, true);
    assert.equal(ok2, true);
    assert.equal(fetchLlamado, false, 'no debe contactar a Resend sin API key');
  } finally {
    global.fetch = fetchOriginal;
    console.log = origLog;
    if (prevKey !== undefined) process.env.RESEND_API_KEY = prevKey;
  }
});

// Sin destinatario no se intenta enviar (guarda contra correos vacíos).
test('enviarCorreo sin destinatario devuelve false', async () => {
  const { enviarCorreo } = require('../src/services/mailer');
  const ok = await enviarCorreo({ to: '', subject: 'x', html: '<p>x</p>' });
  assert.equal(ok, false);
});

// Cambio de correo: el código va a la dirección NUEVA (recibirlo es la prueba de que
// existe) y el aviso a la ANTERIOR (para que el dueño real se entere si le robaron la
// sesión). Confundir los destinatarios rompería justamente la protección.
test('el codigo de cambio va al correo nuevo y el aviso al viejo', async () => {
  const prevKey = process.env.RESEND_API_KEY;
  process.env.RESEND_API_KEY = 'fake';
  process.env.RAILWAY_PUBLIC_DOMAIN = 'ejemplo.test';

  const fetchOriginal = global.fetch;
  const enviados = [];
  global.fetch = async (_url, opts) => { enviados.push(JSON.parse(opts.body)); return { ok: true }; };

  const origWarn = console.warn;
  console.warn = () => {};

  try {
    const { enviarCodigoCambioCorreo, enviarAvisoCambioCorreo } = require('../src/services/mailer');
    await enviarCodigoCambioCorreo('nuevo@correo.com', 'Ana', '482913');
    await enviarAvisoCambioCorreo('viejo@correo.com', 'Ana', 'nuevo@correo.com');

    const [codigo, aviso] = enviados;
    assert.deepEqual(codigo.to, ['nuevo@correo.com']);
    assert.ok(codigo.html.includes('482913'), 'el correo nuevo debe llevar el codigo');

    assert.deepEqual(aviso.to, ['viejo@correo.com']);
    assert.ok(!aviso.html.includes('482913'), 'el aviso al correo viejo NO debe llevar el codigo');
    assert.ok(aviso.html.includes('nuevo@correo.com'), 'el aviso debe decir a que direccion se muda');
  } finally {
    global.fetch = fetchOriginal;
    console.warn = origWarn;
    delete process.env.RAILWAY_PUBLIC_DOMAIN;
    if (prevKey !== undefined) process.env.RESEND_API_KEY = prevKey; else delete process.env.RESEND_API_KEY;
  }
});

// El logo se enlaza desde el dominio publico; sin dominio no se pone <img> para no
// dejar un hueco roto en la cabecera.
test('la cabecera usa el logo solo si hay dominio publico', async () => {
  const prevKey = process.env.RESEND_API_KEY;
  process.env.RESEND_API_KEY = 'fake';
  const fetchOriginal = global.fetch;
  let ultimo;
  global.fetch = async (_url, opts) => { ultimo = JSON.parse(opts.body); return { ok: true }; };
  const origWarn = console.warn;
  console.warn = () => {};

  try {
    const { enviarCodigoLogin } = require('../src/services/mailer');

    const marca = { nombre: 'Taller Pérez', slug: 'perez', color: '#0a7d4b' };

    delete process.env.RAILWAY_PUBLIC_DOMAIN;
    delete process.env.APP_URL;
    await enviarCodigoLogin('a@b.com', 'Ana', '111111', marca);
    assert.ok(!ultimo.html.includes('<img'), 'sin dominio publico no debe haber <img>');
    // El rotulo es el del taller que manda el correo. Antes acá decía "MS Motos":
    // el cliente de cualquier taller recibía el código firmado por otra empresa.
    assert.ok(ultimo.html.includes('Taller Pérez'), 'la cabecera lleva el nombre del taller');
    assert.ok(!ultimo.html.includes('MS Motos'), 'no debe aparecer la marca de otro taller');
    assert.ok(ultimo.html.includes('#0a7d4b'), 'el acento es el color del taller');

    process.env.APP_URL = 'https://ejemplo.test/';
    await enviarCodigoLogin('a@b.com', 'Ana', '111111', marca);
    assert.ok(ultimo.html.includes('<img'), 'con dominio publico debe llevar el logo');
    // Apunta al endpoint, no al archivo del bundle: sirve el logo configurado por el
    // taller (guardado como data URL, inservible dentro de un correo). Lleva el slug
    // porque el endpoint es publico y multi-taller: sin el no sabe de quien es.
    assert.ok(ultimo.html.includes('https://ejemplo.test/api/marca/logo?taller=perez'),
      'usa el endpoint de marca con el slug del taller, sin barra doble');

    // Sin slug no se pone logo: antes que mostrar el de otro taller, ninguno.
    await enviarCodigoLogin('a@b.com', 'Ana', '111111', { nombre: 'Taller Pérez' });
    assert.ok(!ultimo.html.includes('<img'), 'sin slug no se puede saber de que taller es el logo');
  } finally {
    global.fetch = fetchOriginal;
    console.warn = origWarn;
    delete process.env.APP_URL;
    if (prevKey !== undefined) process.env.RESEND_API_KEY = prevKey; else delete process.env.RESEND_API_KEY;
  }
});

// ── B-18: sin clave, la simulación (que escribe el código en el registro) es solo de desarrollo ──
async function conEntorno(env, fn) {
  const previo = { NODE_ENV: process.env.NODE_ENV, RESEND_API_KEY: process.env.RESEND_API_KEY };
  for (const [k, v] of Object.entries(env)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  const salida = [];
  const orig = { log: console.log, warn: console.warn, error: console.error, fetch: global.fetch };
  let fetchLlamado = false;
  global.fetch = async () => { fetchLlamado = true; return { ok: true }; };
  console.log = (...a) => salida.push(['log', a.join(' ')]);
  console.warn = (...a) => salida.push(['warn', a.join(' ')]);
  console.error = (...a) => salida.push(['error', a.join(' ')]);
  try {
    return await fn({ salida, fetchLlamado: () => fetchLlamado });
  } finally {
    Object.assign(console, { log: orig.log, warn: orig.warn, error: orig.error });
    global.fetch = orig.fetch;
    for (const [k, v] of Object.entries(previo)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}

test('en producción sin RESEND_API_KEY no simula: devuelve false y el código no va al registro', async () => {
  await conEntorno({ NODE_ENV: 'production', RESEND_API_KEY: undefined }, async ({ salida, fetchLlamado }) => {
    const { enviarCodigoReset, enviarCodigoLogin, enviarCodigoCorreoStaff } = require('../src/services/mailer');
    assert.equal(await enviarCodigoReset('user@correo.com', 'Ana', '918273'), false);
    assert.equal(await enviarCodigoLogin('user@correo.com', 'Ana', '918274'), false);
    assert.equal(await enviarCodigoCorreoStaff('staff@correo.com', { nombre: 'Ana', codigo: '918275', minutos: 10 }), false);
    assert.equal(fetchLlamado(), false);
    const todo = salida.map(([, t]) => t).join('\n');
    for (const codigo of ['918273', '918274', '918275']) assert.ok(!todo.includes(codigo), `el código ${codigo} no debe aparecer en el registro`);
    assert.ok(!todo.includes('user@correo.com'), 'tampoco el destinatario');
    assert.ok(salida.some(([nivel, t]) => nivel === 'error' && t.includes('RESEND_API_KEY')), 'tiene que haber un error claro que nombre la variable');
  });
});

test('fuera de producción sin RESEND_API_KEY sigue simulando el envío', async () => {
  await conEntorno({ NODE_ENV: 'development', RESEND_API_KEY: undefined }, async ({ salida }) => {
    const { enviarCodigoReset } = require('../src/services/mailer');
    assert.equal(await enviarCodigoReset('user@correo.com', 'Ana', '555111'), true);
    assert.ok(salida.some(([nivel, t]) => nivel === 'log' && t.includes('555111')), 'en desarrollo el código se ve en el registro');
  });
});

test('al arrancar en producción sin clave se avisa con un error', async () => {
  const { revisarConfiguracionCorreo } = require('../src/services/mailer');
  assert.equal(typeof revisarConfiguracionCorreo, 'function', 'el mailer expone la revisión de arranque');
  await conEntorno({ NODE_ENV: 'production', RESEND_API_KEY: undefined }, async ({ salida }) => {
    assert.equal(revisarConfiguracionCorreo(), false);
    assert.ok(salida.some(([nivel, t]) => nivel === 'error' && t.includes('RESEND_API_KEY')));
  });
  await conEntorno({ NODE_ENV: 'production', RESEND_API_KEY: 're_prueba' }, async () => assert.equal(revisarConfiguracionCorreo(), true));
  await conEntorno({ NODE_ENV: 'development', RESEND_API_KEY: undefined }, async () => assert.equal(revisarConfiguracionCorreo(), true));
});
