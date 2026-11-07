const { test } = require('node:test');
const assert = require('node:assert');

// Configuración → Correo de envío: qué remitente usa el sistema y si Resend tiene el
// dominio verificado. Se prueba contra un fetch falso: nunca contacta a Resend.
const { estadoCorreo, partesDelRemitente } = require('../src/services/mailer');

async function conEntorno(env, respuesta, fn) {
  const previo = { RESEND_API_KEY: process.env.RESEND_API_KEY, MAIL_FROM: process.env.MAIL_FROM };
  const fetchOriginal = global.fetch;
  const llamadas = [];
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  global.fetch = async (url, opciones) => {
    llamadas.push({ url, opciones });
    if (respuesta instanceof Error) throw respuesta;
    return { ok: respuesta.status === 200, status: respuesta.status, json: async () => respuesta.cuerpo };
  };
  const errorOriginal = console.error;
  console.error = () => {};
  try {
    return await fn(llamadas);
  } finally {
    global.fetch = fetchOriginal;
    console.error = errorOriginal;
    for (const [k, v] of Object.entries(previo)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
}

const dominios = (status) => ({ status: 200, cuerpo: { object: 'list', data: [{ name: 'msmotos.com', status }] } });

test('partesDelRemitente saca la dirección y el dominio', () => {
  assert.deepStrictEqual(partesDelRemitente('MS Motos <Avisos@MSMotos.com>'), { direccion: 'avisos@msmotos.com', dominio: 'msmotos.com' });
  assert.deepStrictEqual(partesDelRemitente('avisos@msmotos.com'), { direccion: 'avisos@msmotos.com', dominio: 'msmotos.com' });
  assert.strictEqual(partesDelRemitente('').dominio, null);
});

test('sin clave de Resend no consulta nada', async () => {
  await conEntorno({ RESEND_API_KEY: undefined, MAIL_FROM: 'MS Motos <avisos@msmotos.com>' }, dominios('verified'), async (llamadas) => {
    const e = await estadoCorreo();
    assert.strictEqual(e.configurado, false);
    assert.strictEqual(e.verificacion, null);
    assert.strictEqual(llamadas.length, 0);
  });
});

test('con el remitente de prueba avisa y no consulta', async () => {
  await conEntorno({ RESEND_API_KEY: 'clave-falsa', MAIL_FROM: undefined }, dominios('verified'), async (llamadas) => {
    const e = await estadoCorreo();
    assert.strictEqual(e.de_prueba, true);
    assert.strictEqual(e.con_mail_from, false);
    assert.strictEqual(llamadas.length, 0);
  });
});

test('traduce el estado del dominio de Resend', async () => {
  const casos = [['verified', 'verificado'], ['pending', 'pendiente'], ['not_started', 'pendiente'], ['failed', 'fallido']];
  for (const [status, esperado] of casos) {
    await conEntorno({ RESEND_API_KEY: 'clave-falsa', MAIL_FROM: 'MS Motos <avisos@msmotos.com>' }, dominios(status), async (llamadas) => {
      assert.strictEqual((await estadoCorreo()).verificacion, esperado, status);
      assert.strictEqual(llamadas[0].url, 'https://api.resend.com/domains');
    });
  }
});

test('dominio que no está en la cuenta de Resend', async () => {
  await conEntorno({ RESEND_API_KEY: 'clave-falsa', MAIL_FROM: 'avisos@otro.com' }, dominios('verified'), async () => {
    assert.strictEqual((await estadoCorreo()).verificacion, 'no_agregado');
  });
});

test('una clave que solo envía no puede ver el dominio', async () => {
  const restringida = { status: 401, cuerpo: { statusCode: 401, name: 'restricted_api_key', message: 'This API key is restricted to only send emails' } };
  await conEntorno({ RESEND_API_KEY: 'clave-falsa', MAIL_FROM: 'avisos@msmotos.com' }, restringida, async () => {
    assert.strictEqual((await estadoCorreo()).verificacion, 'sin_permiso');
  });
});

test('si Resend no responde, error sin lanzar ni mostrar la clave', async () => {
  await conEntorno({ RESEND_API_KEY: 'clave-secreta-123', MAIL_FROM: 'avisos@msmotos.com' }, new Error('timeout'), async () => {
    const e = await estadoCorreo();
    assert.strictEqual(e.verificacion, 'error');
    assert.ok(!JSON.stringify(e).includes('clave-secreta-123'));
  });
});
