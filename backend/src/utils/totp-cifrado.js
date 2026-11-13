// Cifrado en reposo de los secretos TOTP (QP3-07).
//
// Con el secreto de la app de autenticación se generan los códigos del segundo factor.
// Guardarlo en claro hacía que leer una columna (un respaldo, una consulta filtrada,
// una réplica) alcanzara para saltarse el 2FA de cualquier cuenta, también la de la
// plataforma. Acá se cifra con AES-256-GCM (cifrado autenticado: además de ocultarlo,
// detecta si alguien alteró el valor guardado).
//
// Formato guardado:  v1:<iv>:<tag>:<cifrado>   (los tres en base64)
//   • v1  = AES-256-GCM con la clave de TOTP_CLAVE. El prefijo de versión es lo que
//           permite rotar la clave o cambiar el algoritmo más adelante: se agrega un v2
//           y los valores viejos se siguen leyendo hasta re-cifrarlos.
//   • iv  = 12 bytes aleatorios, nuevos en cada cifrado.
//   • tag = 16 bytes de autenticación de GCM.
// Un secreto en base32 (A-Z, 2-7) nunca empieza con "v1:", así que un valor sin
// prefijo es uno viejo en claro: se sigue leyendo y se re-cifra en la próxima
// escritura o con scripts/cifrar-totp.js.
//
// La clave: TOTP_CLAVE, 32 bytes en base64 (`openssl rand -base64 32`). Vive solo en las
// variables del servidor, nunca en la base ni en el repo. Si falta, el servidor NO se
// cae (el merge no puede romper el login si la variable llega tarde): avisa fuerte en
// el registro y sigue guardando en claro, como antes.
const crypto = require('crypto');

const VERSION = 'v1';
const PREFIJO = `${VERSION}:`;
const ALGORITMO = 'aes-256-gcm';
const LARGO_IV = 12;
const LARGO_TAG = 16;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

const enProduccion = () => process.env.NODE_ENV === 'production';

class ErrorTotpCifrado extends Error {
  constructor(mensaje) {
    super(mensaje);
    this.name = 'ErrorTotpCifrado';
    this.code = 'TOTP_CIFRADO';
  }
}

// La clave se relee de la variable en cada uso (barato: un base64 de 44 caracteres),
// con caché por valor. Así un cambio de variable en las pruebas no queda pegado.
let cache = { crudo: undefined, clave: null, problema: null };
function leerClave() {
  const crudo = String(process.env.TOTP_CLAVE || '').trim();
  if (crudo === cache.crudo) return cache;
  let clave = null;
  let problema = null;
  if (!crudo) {
    problema = 'falta';
  } else {
    const bytes = BASE64.test(crudo) ? Buffer.from(crudo, 'base64') : null;
    if (!bytes || bytes.length !== 32) problema = 'invalida';
    else clave = bytes;
  }
  cache = { crudo, clave, problema };
  return cache;
}

const MENSAJES = {
  falta: '❌ Falta TOTP_CLAVE: los secretos del segundo factor (2FA) se están guardando EN CLARO. '
    + 'Definila en las variables del servidor (32 bytes en base64: `openssl rand -base64 32`) '
    + 'y después corré `node backend/scripts/cifrar-totp.js`.',
  invalida: '❌ TOTP_CLAVE no es válida: tienen que ser 32 bytes en base64 (`openssl rand -base64 32`). '
    + 'Mientras tanto los secretos del segundo factor (2FA) se guardan EN CLARO.',
};

// Hay clave usable para cifrar y descifrar.
function hayClave() {
  return !!leerClave().clave;
}

// Al arrancar: dice una vez si la clave falta o está mal. No corta el arranque.
// En desarrollo, sin clave, solo un aviso: los secretos de prueba quedan en claro.
// Devuelve true si se puede cifrar.
function revisarClaveTotp({ error = console.error, aviso = console.warn } = {}) {
  const { clave, problema } = leerClave();
  if (clave) return true;
  if (problema === 'invalida' || enProduccion()) error(MENSAJES[problema]);
  else aviso('⚠️  TOTP_CLAVE no definida: en desarrollo los secretos del 2FA se guardan en claro.');
  return false;
}

// En una escritura sin clave el aviso se repite como mucho una vez por hora: que se vea
// en el registro sin taparlo.
let ultimoAviso = 0;
function avisarSinClave() {
  const { problema } = leerClave();
  if (!enProduccion() && problema !== 'invalida') return;
  const ahora = Date.now();
  if (ahora - ultimoAviso < 3600_000) return;
  ultimoAviso = ahora;
  console.error(MENSAJES[problema]);
}

const estaCifrado = (valor) => typeof valor === 'string' && /^v\d+:/.test(valor);

// Devuelve el valor a guardar. Sin clave, el mismo secreto en claro (ver arriba).
function cifrarSecreto(secreto) {
  if (secreto == null || secreto === '') return secreto;
  const { clave } = leerClave();
  if (!clave) {
    avisarSinClave();
    return secreto;
  }
  const iv = crypto.randomBytes(LARGO_IV);
  const cifrador = crypto.createCipheriv(ALGORITMO, clave, iv, { authTagLength: LARGO_TAG });
  const cifrado = Buffer.concat([cifrador.update(String(secreto), 'utf8'), cifrador.final()]);
  const tag = cifrador.getAuthTag();
  return `${PREFIJO}${iv.toString('base64')}:${tag.toString('base64')}:${cifrado.toString('base64')}`;
}

// Devuelve el secreto en claro a partir de lo guardado. Un valor sin prefijo (viejo)
// sale tal cual. Si está cifrado y no se puede leer (falta la clave, es otra, o el
// valor está alterado), lanza ErrorTotpCifrado: nunca devuelve basura en silencio.
function descifrarSecreto(guardado) {
  if (guardado == null || guardado === '') return null;
  const valor = String(guardado);
  if (!estaCifrado(valor)) return valor;
  const partes = valor.split(':');
  if (partes[0] !== VERSION) {
    throw new ErrorTotpCifrado(`Secreto TOTP con una versión de cifrado desconocida (${partes[0]}).`);
  }
  if (partes.length !== 4) throw new ErrorTotpCifrado('Secreto TOTP cifrado con un formato inválido.');
  const { clave, problema } = leerClave();
  if (!clave) {
    throw new ErrorTotpCifrado(problema === 'invalida'
      ? 'TOTP_CLAVE no es válida (32 bytes en base64): no se puede descifrar el secreto TOTP.'
      : 'Falta TOTP_CLAVE: no se puede descifrar el secreto TOTP.');
  }
  const [, iv, tag, cifrado] = partes.map((p, i) => (i ? Buffer.from(p, 'base64') : p));
  if (iv.length !== LARGO_IV || tag.length !== LARGO_TAG || !cifrado.length) {
    throw new ErrorTotpCifrado('Secreto TOTP cifrado con un formato inválido.');
  }
  try {
    const descifrador = crypto.createDecipheriv(ALGORITMO, clave, iv, { authTagLength: LARGO_TAG });
    descifrador.setAuthTag(tag);
    return Buffer.concat([descifrador.update(cifrado), descifrador.final()]).toString('utf8');
  } catch {
    throw new ErrorTotpCifrado(
      'No se pudo descifrar el secreto TOTP: TOTP_CLAVE no es la que lo cifró, o el valor guardado fue alterado.'
    );
  }
}

// Para los caminos de login: el secreto listo para verificar, o null si no se puede leer.
// Con null el código de la app no coincide, pero los códigos de respaldo (hashes bcrypt,
// sin clave) siguen sirviendo: una clave mal cargada no deja a nadie afuera del todo.
function secretoParaVerificar(guardado, contexto = '') {
  try {
    return descifrarSecreto(guardado);
  } catch (err) {
    if (!(err instanceof ErrorTotpCifrado)) throw err;
    console.error(`❌ 2FA${contexto ? ` (${contexto})` : ''}: ${err.message}`);
    return null;
  }
}

// Si lo guardado es un secreto viejo en claro y ya hay clave, el valor cifrado con que
// reemplazarlo; si no hace falta (vacío, ya cifrado o sin clave), null.
function recifrado(guardado) {
  if (!guardado || estaCifrado(guardado) || !hayClave()) return null;
  return cifrarSecreto(guardado);
}

module.exports = {
  VERSION,
  ErrorTotpCifrado,
  hayClave,
  revisarClaveTotp,
  estaCifrado,
  cifrarSecreto,
  descifrarSecreto,
  secretoParaVerificar,
  recifrado,
};
