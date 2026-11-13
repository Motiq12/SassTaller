// Imágenes de prueba para B-11: bytes reales de cada formato y disfraces que antes
// pasaban la validación (solo miraba el prefijo y el largo del texto).
const PNG_1x1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEBgIApD5fRAAAAABJRU5ErkJggg==';
// JPEG mínimo: SOI + APP0 (JFIF) + EOI. Para la firma alcanzan los primeros bytes.
const JPEG_MIN = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xd9]).toString('base64');
// WebP: cabecera RIFF....WEBPVP8 con un cuerpo de relleno.
const WEBP_MIN = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x1a, 0, 0, 0]), Buffer.from('WEBPVP8 '), Buffer.alloc(18)]).toString('base64');

const png = `data:image/png;base64,${PNG_1x1}`;
const jpeg = `data:image/jpeg;base64,${JPEG_MIN}`;
const webp = `data:image/webp;base64,${WEBP_MIN}`;
const b64 = (texto) => Buffer.from(texto, 'latin1').toString('base64');
// Un HTML con código, declarado como PNG: el prefijo y el largo eran lo único que se miraba.
const htmlDisfrazado = `data:image/png;base64,${b64('<html><script>alert(document.cookie)</script></html>')}`;
const svgDisfrazado = `data:image/png;base64,${b64('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>')}`;
// Un PNG de verdad declarado como JPEG: el tipo servido no coincide con los bytes.
const tipoCruzado = `data:image/jpeg;base64,${PNG_1x1}`;
const gif = `data:image/gif;base64,${b64('GIF89a\u0001\u0000\u0001\u0000\u0000\u0000\u0000;')}`;
// Base64 roto: un carácter fuera del alfabeto, o un largo que no es múltiplo de 4.
const base64Roto = `data:image/png;base64,${PNG_1x1.slice(0, 20)}*${PNG_1x1.slice(21)}`;
const base64Cortado = `data:image/png;base64,${PNG_1x1.slice(0, -3)}`;
// PNG con la firma correcta y `bytes` decodificados en total.
const pngDe = (bytes) => {
  const b = Buffer.alloc(bytes);
  Buffer.from(PNG_1x1, 'base64').copy(b);
  return `data:image/png;base64,${b.toString('base64')}`;
};

module.exports = { PNG_1x1, png, jpeg, webp, htmlDisfrazado, svgDisfrazado, tipoCruzado, gif, base64Roto, base64Cortado, pngDe };
