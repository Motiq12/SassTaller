// Cifrado de un archivo con una frase secreta (AES-256-GCM), para los respaldos.
//
// Un respaldo es la base entera: cédulas, teléfonos y correos de los clientes.
// Si se define RESPALDO_CLAVE, sale cifrado del servidor y quien consiga el
// archivo (o las credenciales del almacenamiento) no puede leerlo sin la frase.
// OJO: si esa frase se pierde, los respaldos cifrados no se pueden abrir. Hay
// que guardarla también fuera de Railway.
//
// Formato del archivo:
//   "MSRESPALDO1\n" (12 bytes) · sal (16) · iv (12) · datos cifrados · sello (16)
// La llave sale de la frase con scrypt y esa sal. El sello (el "auth tag" de
// GCM) va al final: al descifrar, si el archivo fue alterado, quedó cortado o
// la frase no es la correcta, falla en vez de entregar basura.

const crypto = require('node:crypto');
const fs = require('node:fs');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const MARCA = Buffer.from('MSRESPALDO1\n', 'latin1');
const LARGO_SAL = 16;
const LARGO_IV = 12;
const LARGO_SELLO = 16;
const CABECERA = MARCA.length + LARGO_SAL + LARGO_IV;

const llaveDe = (frase, sal) => crypto.scryptSync(String(frase), sal, 32);

// Transform que cifra lo que le pasa: escribe la cabecera al empezar y el sello al terminar.
function cifrador(frase) {
  const sal = crypto.randomBytes(LARGO_SAL);
  const iv = crypto.randomBytes(LARGO_IV);
  const cifra = crypto.createCipheriv('aes-256-gcm', llaveDe(frase, sal), iv);
  let empezado = false;
  return new Transform({
    transform(trozo, _enc, listo) {
      if (!empezado) {
        empezado = true;
        this.push(Buffer.concat([MARCA, sal, iv]));
      }
      listo(null, cifra.update(trozo));
    },
    flush(listo) {
      if (!empezado) this.push(Buffer.concat([MARCA, sal, iv]));
      this.push(cifra.final());
      this.push(cifra.getAuthTag());
      listo();
    },
  });
}

// ¿El archivo es un respaldo cifrado con este formato?
function estaCifrado(archivo) {
  const fd = fs.openSync(archivo, 'r');
  try {
    const inicio = Buffer.alloc(MARCA.length);
    fs.readSync(fd, inicio, 0, MARCA.length, 0);
    return inicio.equals(MARCA);
  } finally {
    fs.closeSync(fd);
  }
}

// Descifra `origen` en `destino`. Si falla (frase incorrecta, archivo dañado),
// borra lo que haya escrito y lanza un error claro.
async function descifrarArchivo(origen, destino, frase) {
  const tamano = fs.statSync(origen).size;
  if (tamano < CABECERA + LARGO_SELLO || !estaCifrado(origen)) {
    throw new Error('El archivo no es un respaldo cifrado de este sistema');
  }
  const fd = fs.openSync(origen, 'r');
  let sal, iv, sello;
  try {
    const cabecera = Buffer.alloc(CABECERA);
    fs.readSync(fd, cabecera, 0, CABECERA, 0);
    sal = cabecera.subarray(MARCA.length, MARCA.length + LARGO_SAL);
    iv = cabecera.subarray(MARCA.length + LARGO_SAL);
    sello = Buffer.alloc(LARGO_SELLO);
    fs.readSync(fd, sello, 0, LARGO_SELLO, tamano - LARGO_SELLO);
  } finally {
    fs.closeSync(fd);
  }
  const descifra = crypto.createDecipheriv('aes-256-gcm', llaveDe(frase, sal), iv);
  descifra.setAuthTag(sello);
  try {
    if (tamano === CABECERA + LARGO_SELLO) {
      // Respaldo vacío: no hay datos que leer, pero el sello igual se comprueba.
      fs.writeFileSync(destino, descifra.final());
    } else {
      await pipeline(
        fs.createReadStream(origen, { start: CABECERA, end: tamano - LARGO_SELLO - 1 }),
        descifra,
        fs.createWriteStream(destino)
      );
    }
  } catch (err) {
    fs.rmSync(destino, { force: true });
    throw new Error('No se pudo descifrar el respaldo: la frase no es la correcta o el archivo está dañado');
  }
}

module.exports = { cifrador, descifrarArchivo, estaCifrado };
