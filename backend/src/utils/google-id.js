// Comprueba el "ID token" que entrega el botón "Continuar con Google" del portal.
//
// El botón (Google Identity Services, en el navegador) devuelve un JWT firmado por
// Google con el correo de la persona. Acá se verifica sin paquetes extra: la firma
// RS256 con las llaves públicas de Google (se cachean lo que dice su Cache-Control),
// quién lo emitió, para qué aplicación es (GOOGLE_CLIENT_ID), que no haya vencido y
// que Google haya verificado el correo. Si algo no cuadra, lanza un error.
//
// Variable (en el servicio del SISTEMA, en Railway):
//   GOOGLE_CLIENT_ID   el "ID de cliente" OAuth de tipo "Aplicación web" que se crea
//                      en Google Cloud Console. No es secreto: va también al navegador.
//                      Sin ella, el botón no aparece y la ruta responde que no está activo.

const crypto = require('node:crypto');

const LLAVES_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const EMISORES = ['accounts.google.com', 'https://accounts.google.com'];
// Diferencia de reloj tolerada con los servidores de Google.
const HOLGURA_MS = 60 * 1000;

let cache = { llaves: null, vence: 0 };

// Las llaves públicas de Google por `kid`, como objetos de llave de Node.
async function llavesDeGoogle({ forzar = false } = {}) {
  if (!forzar && cache.llaves && Date.now() < cache.vence) return cache.llaves;
  const r = await fetch(LLAVES_URL, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`Google respondió ${r.status} al pedir sus llaves`);
  const { keys = [] } = await r.json();
  const llaves = new Map(keys.map((jwk) => [jwk.kid, crypto.createPublicKey({ key: jwk, format: 'jwk' })]));
  const maxAge = Number((r.headers.get('cache-control') || '').match(/max-age=(\d+)/)?.[1]) || 3600;
  cache = { llaves, vence: Date.now() + maxAge * 1000 };
  return llaves;
}

const parte = (s) => JSON.parse(Buffer.from(s, 'base64url').toString('utf8'));

class TokenGoogleInvalido extends Error {}

// Devuelve { sub, email, nombre, apellido, foto } si el token es bueno.
// `obtenerLlaves` y `ahora` se pueden cambiar en las pruebas.
async function verificarIdToken(token, { clientId = process.env.GOOGLE_CLIENT_ID, obtenerLlaves = llavesDeGoogle, ahora = Date.now() } = {}) {
  if (!clientId) throw new TokenGoogleInvalido('El ingreso con Google no está configurado');
  const partes = String(token || '').split('.');
  if (partes.length !== 3) throw new TokenGoogleInvalido('Token con formato inválido');

  let cabecera, datos;
  try { cabecera = parte(partes[0]); datos = parte(partes[1]); } catch { throw new TokenGoogleInvalido('Token ilegible'); }
  if (cabecera.alg !== 'RS256' || !cabecera.kid) throw new TokenGoogleInvalido('Algoritmo no admitido');

  // Si la llave no está en el caché, Google pudo haberlas rotado: se piden de nuevo una vez.
  let llave = (await obtenerLlaves()).get(cabecera.kid);
  if (!llave) llave = (await obtenerLlaves({ forzar: true })).get(cabecera.kid);
  if (!llave) throw new TokenGoogleInvalido('Llave desconocida');

  const firmaOk = crypto.verify('RSA-SHA256', Buffer.from(`${partes[0]}.${partes[1]}`), llave, Buffer.from(partes[2], 'base64url'));
  if (!firmaOk) throw new TokenGoogleInvalido('Firma inválida');

  if (!EMISORES.includes(datos.iss)) throw new TokenGoogleInvalido('Emisor inválido');
  const audiencias = Array.isArray(datos.aud) ? datos.aud : [datos.aud];
  if (!audiencias.includes(clientId)) throw new TokenGoogleInvalido('El token es de otra aplicación');
  if (!datos.exp || datos.exp * 1000 < ahora - HOLGURA_MS) throw new TokenGoogleInvalido('Token vencido');
  if (datos.iat && datos.iat * 1000 > ahora + HOLGURA_MS) throw new TokenGoogleInvalido('Token emitido en el futuro');
  if (!datos.sub || !datos.email) throw new TokenGoogleInvalido('Falta la cuenta o el correo');
  // Sin esto, alguien podría crear una cuenta de Google con el correo de otro (sin
  // verificarlo) y entrar a su portal.
  if (datos.email_verified !== true && datos.email_verified !== 'true') throw new TokenGoogleInvalido('Google no verificó el correo');

  return {
    sub: String(datos.sub),
    email: String(datos.email).trim().toLowerCase(),
    nombre: String(datos.given_name || datos.name || '').trim(),
    apellido: String(datos.family_name || '').trim(),
    foto: datos.picture || null,
  };
}

const googleConfigurado = () => Boolean(process.env.GOOGLE_CLIENT_ID);

module.exports = { verificarIdToken, googleConfigurado, TokenGoogleInvalido };
