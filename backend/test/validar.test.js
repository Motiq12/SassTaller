const { test } = require('node:test');
const assert = require('node:assert');
const { emailValido } = require('../src/utils/validar');

test('acepta correos bien formados', () => {
  assert.equal(emailValido('user@correo.com'), true);
  assert.equal(emailValido('a.b-c+d@sub.dominio.cr'), true);
});

test('recorta espacios alrededor', () => {
  assert.equal(emailValido('  user@correo.com  '), true);
});

test('rechaza correos inválidos', () => {
  for (const malo of ['', 'sin-arroba', 'a@b', 'a@b.', '@b.com', 'a b@c.com', 'a@@b.com']) {
    assert.equal(emailValido(malo), false, `debería rechazar: "${malo}"`);
  }
});

test('rechaza null/undefined sin romper', () => {
  assert.equal(emailValido(null), false);
  assert.equal(emailValido(undefined), false);
});

// ── B-11: la imagen se valida por sus bytes, no por el prefijo ──
const { fotoValida, logoValido } = require('../src/utils/validar');
const img = require('./imagenes');
const FOTO_MAX = 3 * 1024 * 1024;
const LOGO_MAX = 525 * 1024;

test('fotoValida acepta PNG, JPG y WebP reales, y el vacío para quitar la foto', () => {
  for (const bueno of [null, undefined, '', img.png, img.jpeg, img.webp, img.jpeg.replace('image/jpeg', 'image/jpg')]) {
    assert.equal(fotoValida(bueno), true, `debería aceptar: ${String(bueno).slice(0, 30)}`);
  }
});

test('fotoValida rechaza lo que solo tiene el prefijo de imagen', () => {
  const casos = {
    'HTML con código declarado como PNG': img.htmlDisfrazado,
    'SVG declarado como PNG': img.svgDisfrazado,
    'PNG declarado como JPEG': img.tipoCruzado,
    'GIF': img.gif,
    'base64 con un carácter inválido': img.base64Roto,
    'base64 cortado': img.base64Cortado,
    'solo el prefijo': 'data:image/png;base64,',
    'una dirección externa': 'https://ejemplo.com/foto.png',
    'un número': 42,
    'un objeto': {},
  };
  for (const [nombre, valor] of Object.entries(casos)) assert.equal(fotoValida(valor), false, `debería rechazar: ${nombre}`);
});

test('fotoValida mide los bytes decodificados, con tope de 3 MB', () => {
  assert.equal(fotoValida(img.pngDe(FOTO_MAX)), true, 'justo en el tope');
  assert.equal(fotoValida(img.pngDe(FOTO_MAX + 1)), false, 'un byte de más');
});

test('logoValido usa la misma revisión, con su propio tope', () => {
  assert.equal(logoValido(img.png), true);
  assert.equal(logoValido(img.htmlDisfrazado), false);
  assert.equal(logoValido(img.tipoCruzado), false);
  assert.equal(logoValido(img.pngDe(LOGO_MAX)), true);
  assert.equal(logoValido(img.pngDe(LOGO_MAX + 1)), false);
});
