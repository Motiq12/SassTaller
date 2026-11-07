// Cliente mínimo para un almacenamiento compatible con S3 (los buckets de
// Railway, Cloudflare R2, Backblaze B2, el propio S3). Solo hace lo que
// necesitan los respaldos: subir un archivo, listar, bajar y borrar.
//
// No usa el SDK de AWS a propósito: son cuatro llamadas HTTP firmadas con
// AWS Signature V4, y el SDK serían decenas de megas de dependencias para eso.

const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');

const sha256 = (dato) => crypto.createHash('sha256').update(dato).digest('hex');
const hmac = (clave, dato) => crypto.createHmac('sha256', clave).update(dato).digest();

// Codificación de la firma (RFC 3986): todo menos letras, dígitos y - _ . ~
const codificar = (texto) => encodeURIComponent(texto).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
// La barra separa carpetas: en una ruta se conserva.
const codificarRuta = (ruta) => ruta.split('/').map(codificar).join('/');

// Firma una petición y devuelve las cabeceras con las que hay que enviarla.
// El cuerpo no entra en la firma (UNSIGNED-PAYLOAD): un respaldo puede pesar
// cientos de megas y calcularle el hash obligaría a leerlo dos veces. Va por
// HTTPS, que ya garantiza que no se altere en el camino.
function firmar({ metodo, host, ruta, consulta = {}, cabeceras = {}, hashCuerpo = 'UNSIGNED-PAYLOAD', region, accessKeyId, secretAccessKey, fecha = new Date() }) {
  const marca = fecha.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''); // 20261008T083000Z
  const dia = marca.slice(0, 8);

  const todas = { host, 'x-amz-content-sha256': hashCuerpo, 'x-amz-date': marca };
  for (const [k, v] of Object.entries(cabeceras)) todas[k.toLowerCase()] = String(v).trim().replace(/\s+/g, ' ');
  const nombres = Object.keys(todas).sort();
  const firmadas = nombres.join(';');

  const consultaCanonica = Object.keys(consulta).sort().map((k) => `${codificar(k)}=${codificar(String(consulta[k]))}`).join('&');
  const peticion = [
    metodo,
    codificarRuta(ruta),
    consultaCanonica,
    nombres.map((k) => `${k}:${todas[k]}\n`).join(''),
    firmadas,
    hashCuerpo,
  ].join('\n');

  const alcance = `${dia}/${region}/s3/aws4_request`;
  const aFirmar = ['AWS4-HMAC-SHA256', marca, alcance, sha256(peticion)].join('\n');
  const claveFirma = hmac(hmac(hmac(hmac('AWS4' + secretAccessKey, dia), region), 's3'), 'aws4_request');
  const firma = crypto.createHmac('sha256', claveFirma).update(aFirmar).digest('hex');

  return {
    firma,
    consultaCanonica,
    cabeceras: { ...todas, authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${alcance}, SignedHeaders=${firmadas}, Signature=${firma}` },
  };
}

// config: { endpoint, bucket, region, accessKeyId, secretAccessKey, estilo }
//   estilo 'virtual' (por defecto): https://<bucket>.<endpoint>/<clave>
//   estilo 'path':                  https://<endpoint>/<bucket>/<clave>
function crearS3(config) {
  const base = new URL(config.endpoint);
  const virtual = config.estilo !== 'path';
  const host = virtual ? `${config.bucket}.${base.host}` : base.host;
  const raiz = virtual ? '' : `/${config.bucket}`;
  const transporte = base.protocol === 'http:' ? http : https;

  // Hace una petición firmada. `subir` y `bajar` son rutas de archivos locales.
  function pedir(metodo, clave, { consulta = {}, subir, bajar } = {}) {
    const ruta = `${raiz}/${clave}`.replace(/\/+$/, '') || '/';
    const cabeceras = {};
    if (subir) cabeceras['content-length'] = fs.statSync(subir).size;
    const f = firmar({ metodo, host, ruta, consulta, cabeceras, region: config.region || 'auto', accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey });

    return new Promise((resolve, reject) => {
      const req = transporte.request({
        method: metodo,
        protocol: base.protocol,
        hostname: virtual ? `${config.bucket}.${base.hostname}` : base.hostname,
        port: base.port || undefined,
        path: codificarRuta(ruta) + (f.consultaCanonica ? `?${f.consultaCanonica}` : ''),
        headers: f.cabeceras,
      }, (res) => {
        const bien = res.statusCode >= 200 && res.statusCode < 300;
        if (bajar && bien) {
          const salida = fs.createWriteStream(bajar);
          res.pipe(salida);
          salida.on('finish', () => resolve({ estado: res.statusCode, cuerpo: '' }));
          salida.on('error', reject);
          return;
        }
        const trozos = [];
        res.on('data', (t) => trozos.push(t));
        res.on('end', () => {
          const cuerpo = Buffer.concat(trozos).toString('utf8');
          if (bien) return resolve({ estado: res.statusCode, cuerpo });
          // El almacenamiento contesta el motivo en XML; alcanza con el código y el mensaje.
          const motivo = (cuerpo.match(/<Code>([^<]*)<\/Code>/) || [])[1] || '';
          const detalle = (cuerpo.match(/<Message>([^<]*)<\/Message>/) || [])[1] || '';
          reject(new Error(`El almacenamiento respondió ${res.statusCode}${motivo ? ` (${motivo})` : ''}${detalle ? `: ${detalle}` : ''}`));
        });
        res.on('error', reject);
      });
      // Sin actividad durante dos minutos: se corta en vez de quedar colgado.
      req.setTimeout(120000, () => req.destroy(new Error('El almacenamiento dejó de responder')));
      req.on('error', reject);
      if (subir) fs.createReadStream(subir).on('error', reject).pipe(req);
      else req.end();
    });
  }

  return {
    subir: (clave, archivo) => pedir('PUT', clave, { subir: archivo }),
    bajar: (clave, archivo) => pedir('GET', clave, { bajar: archivo }),
    borrar: (clave) => pedir('DELETE', clave),
    // Devuelve [{ clave, bytes, fecha }] de todo lo que empiece con `prefijo`.
    async listar(prefijo = '') {
      const objetos = [];
      let continuacion = null;
      do {
        const consulta = { 'list-type': '2', prefix: prefijo };
        if (continuacion) consulta['continuation-token'] = continuacion;
        const { cuerpo } = await pedir('GET', '', { consulta });
        for (const m of cuerpo.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
          const campo = (n) => (m[1].match(new RegExp(`<${n}>([^<]*)</${n}>`)) || [])[1] || '';
          objetos.push({ clave: desescaparXml(campo('Key')), bytes: Number(campo('Size')) || 0, fecha: campo('LastModified') });
        }
        const sigue = /<IsTruncated>true<\/IsTruncated>/.test(cuerpo);
        continuacion = sigue ? desescaparXml((cuerpo.match(/<NextContinuationToken>([^<]*)<\/NextContinuationToken>/) || [])[1] || '') : null;
      } while (continuacion);
      return objetos;
    },
  };
}

function desescaparXml(s) {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

module.exports = { crearS3, firmar };
