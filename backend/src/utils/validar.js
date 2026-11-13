// Validaciones compartidas del backend.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Verifica que el string tenga forma de correo válido.
const emailValido = (e) => EMAIL_RE.test(String(e || '').trim());

// Imágenes que llegan como data URL en base64 (foto de perfil, evidencia, mensajes,
// promociones, logo...). Antes solo se miraban el prefijo y el largo del texto, así que
// pasaba cualquier cosa que dijera "data:image/png;base64," al principio: un HTML, un
// SVG con código o basura, que después se guardaba y se servía. Ahora se revisa:
//   1. que el base64 sea base64 de verdad (alfabeto, relleno y largo múltiplo de 4);
//   2. el tamaño de los bytes decodificados, no el del texto;
//   3. la firma del formato en los primeros bytes (PNG, JPG o WebP), y que coincida con
//      el tipo que declara el prefijo.
// GIF y SVG no: el GIF no lo produce ninguna pantalla (comprimen a JPG) y el SVG puede
// llevar código.
const FIRMAS = {
  png: (b) => b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47
    && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a,
  jpeg: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  webp: (b) => b.length >= 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP',
};
const DATA_URL_IMAGEN_RE = /^data:image\/(png|jpe?g|webp);base64,([A-Za-z0-9+/]+={0,2})$/i;

// null si no es una imagen aceptable; si lo es, { tipo, bytes } con el tamaño decodificado.
function leerImagen(valor, maxBytes) {
  if (typeof valor !== 'string') return null;
  // Se corta antes de decodificar: un texto enorme no llega a ocupar memoria dos veces.
  if (valor.length > Math.ceil(maxBytes / 3) * 4 + 40) return null;
  const m = DATA_URL_IMAGEN_RE.exec(valor);
  if (!m || m[2].length % 4 !== 0) return null;
  const tipo = m[1].toLowerCase() === 'png' ? 'png' : m[1].toLowerCase() === 'webp' ? 'webp' : 'jpeg';
  const buffer = Buffer.from(m[2], 'base64');
  if (!buffer.length || buffer.length > maxBytes) return null;
  if (!FIRMAS[tipo](buffer)) return null;
  return { tipo, bytes: buffer.length };
}

// Fotos (perfil, evidencia, mensajes, promociones, vehículos): hasta 3 MB decodificados,
// lo mismo que entraba antes con el tope de ~4 MB de texto base64.
// Acepta null / '' / undefined: el llamador lo guarda como NULL ("quitar la foto").
const FOTO_MAX_BYTES = 3 * 1024 * 1024;
function fotoValida(foto, maxBytes = FOTO_MAX_BYTES) {
  if (foto === null || foto === undefined || foto === '') return true;
  return leerImagen(foto, maxBytes) !== null;
}

// Logo del taller: PNG, JPG o WebP, de hasta 525 KB decodificados: lo mismo que entraba
// antes con el tope de 700 KB de texto base64 (el navegador lo achica antes de mandarlo).
// SVG no: puede llevar código, y el logo se sirve como archivo desde el dominio de la
// plataforma (GET /api/marca/logo), así que un SVG sería código de un taller corriendo
// con la sesión de quien lo abra. Tampoco una dirección externa: sería un rastreador en
// el portal.
const LOGO_MAX_BYTES = 525 * 1024;
function logoValido(logo) {
  return fotoValida(logo, LOGO_MAX_BYTES);
}

// Verifica que un texto libre (ya trimeado) no exceda el tope de la app.
// Tolera null/undefined/'' (la obligatoriedad se revisa aparte, en el llamador).
function textoDentroDeLimite(str, max) {
  if (str === null || str === undefined || str === '') return true;
  return String(str).trim().length <= max;
}

// Cédula costarricense: física (9 dígitos), jurídica (10) o DIMEX/extranjero (11-12).
// Acepta guiones/espacios como separadores, se comparan solo los dígitos.
// Tolera vacío: la obligatoriedad se revisa aparte, en el llamador.
const CEDULA_RE = /^\d{9,12}$/;
function cedulaValida(cedula) {
  if (cedula === null || cedula === undefined || cedula === '') return true;
  const soloDigitos = String(cedula).replace(/[\s-]/g, '');
  return CEDULA_RE.test(soloDigitos);
}

// Teléfono costarricense: 8 dígitos, con o sin indicativo +506.
// Acepta guiones/espacios como separadores, se comparan solo los dígitos.
// Tolera vacío: la obligatoriedad se revisa aparte, en el llamador.
const TELEFONO_RE = /^(\+?506)?\d{8}$/;
function telefonoValido(telefono) {
  if (telefono === null || telefono === undefined || telefono === '') return true;
  const soloDigitos = String(telefono).replace(/[\s-]/g, '');
  return TELEFONO_RE.test(soloDigitos);
}

// Año de fabricación de la moto: entero entre 1980 y el año próximo (permite modelos "del año siguiente").
// Tolera vacío: el campo es opcional en las rutas actuales.
const ANIO_MINIMO = 1980;
function anioValido(anio) {
  if (anio === null || anio === undefined || anio === '') return true;
  const n = Number(anio);
  const anioMaximo = new Date().getFullYear() + 1;
  return Number.isInteger(n) && n >= ANIO_MINIMO && n <= anioMaximo;
}

// Placa de moto: alfanumérica, entre 4 y 10 caracteres una vez quitados espacios/guiones
// (mismo criterio de normalización que utils/placa.js). Tolera vacío: la obligatoriedad
// se revisa aparte, en el llamador.
const PLACA_RE = /^[A-Z0-9]{4,10}$/;
function placaValida(placa) {
  if (placa === null || placa === undefined || placa === '') return true;
  const normalizada = String(placa).toUpperCase().replace(/[\s-]/g, '');
  return PLACA_RE.test(normalizada);
}

module.exports = {
  emailValido,
  fotoValida,
  logoValido,
  leerImagen,
  FOTO_MAX_BYTES,
  LOGO_MAX_BYTES,
  textoDentroDeLimite,
  cedulaValida,
  telefonoValido,
  anioValido,
  placaValida,
};
