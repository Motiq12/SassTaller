// El token de "Continuar con Google": solo vale si lo firmó Google, es para esta
// aplicación, no venció y el correo está verificado.
const { test } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const { verificarIdToken, TokenGoogleInvalido } = require('../src/utils/google-id');

const CLIENT_ID = 'prueba.apps.googleusercontent.com';
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const otra = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const llaves = async () => new Map([['k1', publicKey]]);
const ahora = Date.UTC(2026, 9, 28, 12, 0, 0);
const seg = Math.floor(ahora / 1000);

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function firmar(datos, { kid = 'k1', llave = privateKey, alg = 'RS256' } = {}) {
  const cab = b64({ alg, kid, typ: 'JWT' });
  const cuerpo = b64(datos);
  const firma = crypto.sign('RSA-SHA256', Buffer.from(`${cab}.${cuerpo}`), llave).toString('base64url');
  return `${cab}.${cuerpo}.${firma}`;
}
const bueno = (extra = {}) => ({
  iss: 'https://accounts.google.com', aud: CLIENT_ID, sub: '1234567890', email: 'Ana@Gmail.com',
  email_verified: true, given_name: 'Ana', family_name: 'Mora', iat: seg - 10, exp: seg + 3600, ...extra,
});
const opciones = { clientId: CLIENT_ID, obtenerLlaves: llaves, ahora };

test('un token bueno devuelve la cuenta, con el correo en minúsculas', async () => {
  const r = await verificarIdToken(firmar(bueno()), opciones);
  assert.deepEqual(r, { sub: '1234567890', email: 'ana@gmail.com', nombre: 'Ana', apellido: 'Mora', foto: null });
});

test('se rechaza si no lo firmó la llave de Google', async () => {
  await assert.rejects(verificarIdToken(firmar(bueno(), { llave: otra.privateKey }), opciones), TokenGoogleInvalido);
});

test('se rechaza si es de otra aplicación', async () => {
  await assert.rejects(verificarIdToken(firmar(bueno({ aud: 'otra.apps.googleusercontent.com' })), opciones), /otra aplicación/);
});

test('se rechaza si venció', async () => {
  await assert.rejects(verificarIdToken(firmar(bueno({ exp: seg - 3600 })), opciones), /vencido/);
});

test('se rechaza si el emisor no es Google', async () => {
  await assert.rejects(verificarIdToken(firmar(bueno({ iss: 'https://evil.example' })), opciones), /Emisor/);
});

test('se rechaza si Google no verificó el correo', async () => {
  await assert.rejects(verificarIdToken(firmar(bueno({ email_verified: false })), opciones), /verificó/);
});

test('se rechaza un algoritmo que no sea RS256 (ni "none")', async () => {
  await assert.rejects(verificarIdToken(firmar(bueno(), { alg: 'none' }), opciones), /Algoritmo/);
});

test('sin GOOGLE_CLIENT_ID no se acepta nada', async () => {
  await assert.rejects(verificarIdToken(firmar(bueno()), { ...opciones, clientId: '' }), /no está configurado/);
});

test('con una llave desconocida pide las llaves otra vez antes de rechazar', async () => {
  let pedidos = 0;
  const obtener = async ({ forzar } = {}) => { pedidos++; return forzar ? new Map([['k2', publicKey]]) : new Map([['k1', publicKey]]); };
  const r = await verificarIdToken(firmar(bueno(), { kid: 'k2' }), { ...opciones, obtenerLlaves: obtener });
  assert.equal(r.sub, '1234567890');
  assert.equal(pedidos, 2);
});
