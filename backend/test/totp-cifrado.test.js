// QP3-07: cifrado de los secretos TOTP (utils/totp-cifrado.js), sin base.
// La clave de prueba se genera acá en cada corrida: nunca una real.
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const totp = require('../src/utils/totp');
const c = require('../src/utils/totp-cifrado');

const claveA = crypto.randomBytes(32).toString('base64');
const claveB = crypto.randomBytes(32).toString('base64');
const entornoOriginal = { TOTP_CLAVE: process.env.TOTP_CLAVE, NODE_ENV: process.env.NODE_ENV };

beforeEach(() => {
  process.env.TOTP_CLAVE = claveA;
  process.env.NODE_ENV = entornoOriginal.NODE_ENV || 'test';
});
test.after(() => {
  for (const [k, v] of Object.entries(entornoOriginal)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

test('cifra y descifra: ida y vuelta, formato v1 y sin el secreto a la vista', () => {
  const secreto = totp.generarSecreto();
  const guardado = c.cifrarSecreto(secreto);
  assert.match(guardado, /^v1:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);
  assert.equal(guardado.split(':').length, 4);
  assert.ok(!guardado.includes(secreto), 'el secreto no puede aparecer dentro del valor cifrado');
  assert.ok(guardado.length <= 255, 'entra en la columna varchar(255) de la migración 0016');
  assert.equal(c.estaCifrado(guardado), true);
  assert.equal(c.descifrarSecreto(guardado), secreto);
  // Lo descifrado sigue generando los mismos códigos que el secreto original.
  const ahora = Math.floor(Date.now() / 1000 / totp.PERIODO);
  assert.equal(totp.codigoPara(c.descifrarSecreto(guardado), ahora), totp.codigoPara(secreto, ahora));
});

test('cada cifrado usa un iv nuevo: el mismo secreto no da dos veces el mismo valor', () => {
  const secreto = totp.generarSecreto();
  const a = c.cifrarSecreto(secreto);
  const b = c.cifrarSecreto(secreto);
  assert.notEqual(a, b);
  assert.notEqual(a.split(':')[1], b.split(':')[1]);
  assert.equal(c.descifrarSecreto(a), c.descifrarSecreto(b));
});

test('con otra clave falla claro, no devuelve basura', () => {
  const guardado = c.cifrarSecreto(totp.generarSecreto());
  process.env.TOTP_CLAVE = claveB;
  assert.throws(() => c.descifrarSecreto(guardado), (err) => {
    assert.ok(err instanceof c.ErrorTotpCifrado);
    assert.equal(err.code, 'TOTP_CIFRADO');
    assert.match(err.message, /TOTP_CLAVE no es la que lo cifró/);
    return true;
  });
  // En los caminos de login, null (solo entran los códigos de respaldo), sin tirar.
  const errores = [];
  const original = console.error;
  console.error = (m) => errores.push(m);
  try {
    assert.equal(c.secretoParaVerificar(guardado, 'usuario 7'), null);
  } finally {
    console.error = original;
  }
  assert.match(errores.join('\n'), /usuario 7.*TOTP_CLAVE no es la que lo cifró/);
});

test('un valor alterado no pasa la autenticación de GCM', () => {
  const guardado = c.cifrarSecreto(totp.generarSecreto());
  const [v, iv, tag, cifrado] = guardado.split(':');
  const bytes = Buffer.from(cifrado, 'base64');
  bytes[0] ^= 1;
  assert.throws(() => c.descifrarSecreto([v, iv, tag, bytes.toString('base64')].join(':')), c.ErrorTotpCifrado);
  assert.throws(() => c.descifrarSecreto(`${v}:${iv}:${tag}`), /formato inválido/);
  assert.throws(() => c.descifrarSecreto(`v9:${iv}:${tag}:${cifrado}`), /versión de cifrado desconocida/);
});

test('un valor viejo en claro se sigue leyendo tal cual', () => {
  const secreto = totp.generarSecreto();
  assert.equal(c.estaCifrado(secreto), false);
  assert.equal(c.descifrarSecreto(secreto), secreto);
  assert.equal(c.descifrarSecreto(null), null);
  assert.equal(c.descifrarSecreto(''), null);
  // Hasta sin clave: un valor en claro no la necesita.
  delete process.env.TOTP_CLAVE;
  assert.equal(c.descifrarSecreto(secreto), secreto);
});

test('recifrado: solo para un valor en claro y con clave', () => {
  const secreto = totp.generarSecreto();
  const nuevo = c.recifrado(secreto);
  assert.equal(c.estaCifrado(nuevo), true);
  assert.equal(c.descifrarSecreto(nuevo), secreto);
  assert.equal(c.recifrado(nuevo), null, 'lo ya cifrado no se vuelve a cifrar');
  assert.equal(c.recifrado(null), null);
  delete process.env.TOTP_CLAVE;
  assert.equal(c.recifrado(secreto), null, 'sin clave no hay con qué');
});

test('sin TOTP_CLAVE en producción: no se cae, avisa claro y guarda en claro', () => {
  delete process.env.TOTP_CLAVE;
  process.env.NODE_ENV = 'production';
  const errores = [];
  const original = console.error;
  console.error = (m) => errores.push(m);
  try {
    assert.equal(c.revisarClaveTotp(), false);
    const secreto = totp.generarSecreto();
    assert.equal(c.cifrarSecreto(secreto), secreto, 'sigue en claro, como antes del cambio');
  } finally {
    console.error = original;
  }
  assert.match(errores[0], /Falta TOTP_CLAVE/);
  assert.match(errores[0], /cifrar-totp\.js/);
  // Lo que ya se cifró con la clave no se puede leer sin ella: error claro.
  process.env.TOTP_CLAVE = claveA;
  const guardado = c.cifrarSecreto(totp.generarSecreto());
  delete process.env.TOTP_CLAVE;
  assert.throws(() => c.descifrarSecreto(guardado), /Falta TOTP_CLAVE/);
});

test('una TOTP_CLAVE mal formada se trata como ausente, con su propio aviso', () => {
  const errores = [];
  const original = console.error;
  console.error = (m) => errores.push(m);
  try {
    for (const mala of [crypto.randomBytes(16).toString('base64'), 'no es base64 !!', crypto.randomBytes(32).toString('hex')]) {
      process.env.TOTP_CLAVE = mala;
      assert.equal(c.hayClave(), false, mala);
      assert.equal(c.revisarClaveTotp(), false);
    }
  } finally {
    console.error = original;
  }
  assert.ok(errores.every(m => /TOTP_CLAVE no es válida/.test(m)), errores.join('\n'));
  process.env.TOTP_CLAVE = claveA;
  assert.equal(c.revisarClaveTotp(), true);
});
