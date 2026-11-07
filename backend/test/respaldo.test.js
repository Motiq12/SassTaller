const { test } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { pipeline } = require('node:stream/promises');
const { Readable } = require('node:stream');

const { firmar, crearS3 } = require('../src/utils/s3');
const { literal, columnasRespaldables } = require('../src/utils/volcado');
const { cifrador, descifrarArchivo, estaCifrado } = require('../src/utils/cifrado-archivo');
const { configRespaldo, respaldar, nombreRespaldo, sobrantes } = require('../src/services/respaldo');

const tmp = (nombre) => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'respaldo-test-')), nombre);

// ── La firma de las peticiones (AWS Signature V4) ──────────────────────────
// Los valores esperados son los ejemplos de la documentación de Amazon S3
// ("Signature Calculations for the Authorization Header"): si la firma sale
// igual, cualquier almacenamiento compatible la va a aceptar.
const AWS = {
  region: 'us-east-1',
  accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  host: 'examplebucket.s3.amazonaws.com',
  fecha: new Date('2013-05-24T00:00:00Z'),
  hashCuerpo: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
};

test('firma como el ejemplo de Amazon: bajar un objeto', () => {
  const f = firmar({ ...AWS, metodo: 'GET', ruta: '/test.txt', cabeceras: { Range: 'bytes=0-9' } });
  assert.equal(f.firma, 'f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41');
  assert.equal(f.cabeceras.authorization,
    'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, '
    + 'SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, '
    + 'Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41');
});

test('firma como el ejemplo de Amazon: listar con parámetros', () => {
  const f = firmar({ ...AWS, metodo: 'GET', ruta: '/', consulta: { prefix: 'J', 'max-keys': '2' } });
  assert.equal(f.consultaCanonica, 'max-keys=2&prefix=J', 'los parámetros van ordenados');
  assert.equal(f.firma, '34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7');
});

// ── Los valores en el SQL ─────────────────────────────────────────────────
test('literal: nulos, números, textos con comillas y binarios', () => {
  assert.equal(literal(null, 'varchar'), 'NULL');
  assert.equal(literal('42', 'int'), '42');
  assert.equal(literal('-12.50', 'decimal'), '-12.50');
  assert.equal(literal('9007199254740993', 'bigint'), '9007199254740993', 'un BIGINT no pierde dígitos');
  assert.equal(literal('42', 'varchar'), "'42'", 'un texto que parece número sigue siendo texto');
  assert.equal(literal("O'Brien \\ ñ\n", 'varchar'), "'O\\'Brien \\\\ ñ\\n'");
  assert.equal(literal('2026-10-08 02:30:00', 'datetime'), "'2026-10-08 02:30:00'");
  assert.equal(literal('{"a": "b\'c"}', 'json'), "'{\\\"a\\\": \\\"b\\'c\\\"}'");
  assert.equal(literal(Buffer.from([0, 255, 16]), 'mediumblob'), "X'00ff10'");
  assert.equal(literal(Buffer.alloc(0), 'blob'), "X''");
});

test('no se respaldan las columnas generadas, pero sí las de valor por defecto calculado', () => {
  const cols = [
    { nombre: 'id', extra: 'auto_increment' },
    { nombre: 'total', extra: 'STORED GENERATED' },
    { nombre: 'iniciales', extra: 'VIRTUAL GENERATED' },
    { nombre: 'created_at', extra: 'DEFAULT_GENERATED' },
    { nombre: 'updated_at', extra: 'DEFAULT_GENERATED on update CURRENT_TIMESTAMP' },
  ];
  assert.deepEqual(columnasRespaldables(cols).map((c) => c.nombre), ['id', 'created_at', 'updated_at']);
});

// ── El cifrado ────────────────────────────────────────────────────────────
async function cifrarEn(archivo, datos, frase) {
  await pipeline(Readable.from([datos]), cifrador(frase), fs.createWriteStream(archivo));
}

test('lo cifrado se descifra igual, y no se parece al original', async () => {
  const datos = crypto.randomBytes(300000);
  const cifrado = tmp('r.enc'); const abierto = tmp('r.bin');
  await cifrarEn(cifrado, datos, 'una frase larga');
  assert.equal(estaCifrado(cifrado), true);
  assert.equal(fs.readFileSync(cifrado).includes(datos.subarray(0, 64)), false);
  await descifrarArchivo(cifrado, abierto, 'una frase larga');
  assert.equal(fs.readFileSync(abierto).equals(datos), true);
});

test('con otra frase no abre, y no deja un archivo a medias', async () => {
  const cifrado = tmp('r.enc'); const abierto = tmp('r.bin');
  await cifrarEn(cifrado, Buffer.from('datos de clientes'), 'la buena');
  await assert.rejects(descifrarArchivo(cifrado, abierto, 'la mala'), /frase no es la correcta|dañado/);
  assert.equal(fs.existsSync(abierto), false);
});

test('un respaldo cifrado alterado o cortado no abre', async () => {
  const cifrado = tmp('r.enc'); const abierto = tmp('r.bin');
  await cifrarEn(cifrado, crypto.randomBytes(5000), 'frase');
  const bytes = fs.readFileSync(cifrado);
  bytes[bytes.length - 100] ^= 1;
  fs.writeFileSync(cifrado, bytes);
  await assert.rejects(descifrarArchivo(cifrado, abierto, 'frase'));
  fs.writeFileSync(cifrado, bytes.subarray(0, bytes.length - 500));
  await assert.rejects(descifrarArchivo(cifrado, abierto, 'frase'));
  assert.equal(fs.existsSync(abierto), false);
});

test('un archivo cualquiera no pasa por respaldo cifrado', async () => {
  const otro = tmp('otro.gz');
  fs.writeFileSync(otro, zlib.gzipSync('hola'));
  assert.equal(estaCifrado(otro), false);
  await assert.rejects(descifrarArchivo(otro, tmp('x'), 'frase'), /no es un respaldo cifrado/);
});

// ── La configuración y la rotación ────────────────────────────────────────
const ENV = {
  RESPALDO_S3_ENDPOINT: 'https://t3.storageapi.dev', RESPALDO_S3_BUCKET: 'mi-bucket',
  RESPALDO_S3_ACCESS_KEY_ID: 'id', RESPALDO_S3_SECRET_ACCESS_KEY: 'secreto',
};

test('sin las variables obligatorias el respaldo queda apagado y dice cuáles faltan', () => {
  const c = configRespaldo({ RESPALDO_S3_BUCKET: 'x' });
  assert.equal(c.activo, false);
  assert.deepEqual(c.faltan, ['RESPALDO_S3_ENDPOINT', 'RESPALDO_S3_ACCESS_KEY_ID', 'RESPALDO_S3_SECRET_ACCESS_KEY']);
});

test('con lo obligatorio queda encendido, con valores por defecto sensatos', () => {
  const c = configRespaldo(ENV);
  assert.equal(c.activo, true);
  assert.deepEqual([c.region, c.estilo, c.prefijo, c.conservar, c.frase], ['auto', 'virtual', 'respaldos/', 14, '']);
  assert.equal(configRespaldo({ ...ENV, RESPALDO_CONSERVAR: '0' }).conservar, 14, 'nunca cero: borraría todo');
  assert.equal(configRespaldo({ ...ENV, RESPALDO_CONSERVAR: '30', RESPALDO_PREFIJO: '/copias' }).prefijo, 'copias/');
});

test('el nombre lleva la fecha y ordena por antigüedad', () => {
  assert.equal(nombreRespaldo('railway', new Date('2026-10-08T08:30:05.123Z'), false), 'railway_2026-10-08T08-30-05Z.sql.gz');
  assert.equal(nombreRespaldo('mi base!', new Date('2026-10-08T08:30:05Z'), true), 'mi_base__2026-10-08T08-30-05Z.sql.gz.enc');
});

test('la rotación deja los más nuevos y no toca archivos ajenos', () => {
  const claves = [
    'respaldos/railway_2026-10-03T08-30-00Z.sql.gz',
    'respaldos/railway_2026-10-01T08-30-00Z.sql.gz.enc',
    'respaldos/railway_2026-10-02T08-30-00Z.sql.gz',
    'respaldos/notas.txt',
    'respaldos/manual/railway_2020-01-01T00-00-00Z.sql.gz',
    'otra-carpeta/railway_2019-01-01T00-00-00Z.sql.gz',
  ];
  assert.deepEqual(sobrantes(claves, 'respaldos/', 2), ['respaldos/railway_2026-10-01T08-30-00Z.sql.gz.enc']);
  assert.deepEqual(sobrantes(claves, 'respaldos/', 5), []);
});

// ── De punta a punta, contra un almacenamiento de mentira ─────────────────
// Un servidor HTTP que guarda lo que le suben. No comprueba la firma (eso lo
// cubren los ejemplos de Amazon de arriba): comprueba que las peticiones salgan
// bien armadas y que el respaldo llegue entero, se liste y se rote.
function almacenFalso() {
  const objetos = new Map();
  const pedidos = [];
  const servidor = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const clave = decodeURIComponent(url.pathname.replace(/^\/cubo\/?/, ''));
    pedidos.push({ metodo: req.method, clave, auth: req.headers.authorization || '', hash: req.headers['x-amz-content-sha256'] });
    const trozos = [];
    req.on('data', (t) => trozos.push(t));
    req.on('end', () => {
      if (req.method === 'PUT') { objetos.set(clave, Buffer.concat(trozos)); res.writeHead(200); return res.end(); }
      if (req.method === 'DELETE') { objetos.delete(clave); res.writeHead(204); return res.end(); }
      if (req.method === 'GET' && url.searchParams.get('list-type') === '2') {
        const prefijo = url.searchParams.get('prefix') || '';
        const xml = [...objetos].filter(([k]) => k.startsWith(prefijo))
          .map(([k, v]) => `<Contents><Key>${k}</Key><LastModified>2026-10-08T08:30:00.000Z</LastModified><Size>${v.length}</Size></Contents>`).join('');
        res.writeHead(200, { 'Content-Type': 'application/xml' });
        return res.end(`<?xml version="1.0"?><ListBucketResult><IsTruncated>false</IsTruncated>${xml}</ListBucketResult>`);
      }
      if (req.method === 'GET' && objetos.has(clave)) { res.writeHead(200); return res.end(objetos.get(clave)); }
      res.writeHead(404, { 'Content-Type': 'application/xml' });
      res.end('<Error><Code>NoSuchKey</Code><Message>No existe</Message></Error>');
    });
  });
  return new Promise((resolve) => servidor.listen(0, '127.0.0.1', () => resolve({ servidor, objetos, pedidos, puerto: servidor.address().port })));
}

// Una "base" de mentira con dos tablas, que responde lo que pide el volcado.
function baseFalsa() {
  const tablas = {
    clientes: { crear: 'CREATE TABLE `clientes` (\n  `id` int NOT NULL,\n  `nombre` varchar(100)\n)', cols: [['id', 'int'], ['nombre', 'varchar']], filas: [['1', "Ñandú O'Brien"], ['2', null]] },
    web_fotos: { crear: 'CREATE TABLE `web_fotos` (\n  `clave` char(24),\n  `bytes` mediumblob\n)', cols: [['clave', 'char'], ['bytes', 'mediumblob']], filas: [['abc', Buffer.from([1, 2, 255])]] },
  };
  const conexion = {
    destruida: false,
    async query(sql, params = []) {
      if (/^SET SESSION|^START TRANSACTION|^COMMIT/.test(sql)) return [{}];
      if (/SELECT DATABASE\(\)/.test(sql)) return [[{ base: 'taller' }]];
      if (/information_schema\.TABLES/.test(sql)) return [Object.keys(tablas).map((nombre) => ({ nombre }))];
      if (/^SHOW CREATE TABLE/.test(sql)) { const t = sql.match(/`([^`]+)`/)[1]; return [[{ 'Create Table': tablas[t].crear }]]; }
      if (/information_schema\.COLUMNS/.test(sql)) return [tablas[params[0]].cols.map(([nombre, tipo]) => ({ nombre, tipo, extra: '' }))];
      throw new Error('Consulta no prevista: ' + sql);
    },
    connection: {
      query({ sql }) { const t = sql.match(/FROM `([^`]+)`/)[1]; return { stream: () => Readable.from(tablas[t].filas) }; },
    },
    destroy() { this.destruida = true; },
  };
  return { conexion, pool: { getConnection: async () => conexion } };
}

test('respaldo completo: vuelca, comprime, sube, comprueba y rota', async () => {
  const falso = await almacenFalso();
  try {
    const config = configRespaldo({ ...ENV, RESPALDO_S3_ENDPOINT: `http://127.0.0.1:${falso.puerto}`, RESPALDO_S3_BUCKET: 'cubo', RESPALDO_S3_ESTILO: 'path', RESPALDO_CONSERVAR: '2' });
    falso.objetos.set('respaldos/taller_2026-10-01T08-30-00Z.sql.gz', Buffer.from('viejo 1'));
    falso.objetos.set('respaldos/taller_2026-10-02T08-30-00Z.sql.gz', Buffer.from('viejo 2'));
    falso.objetos.set('respaldos/leeme.txt', Buffer.from('no es un respaldo'));
    const { pool, conexion } = baseFalsa();

    const r = await respaldar({ pool, config, ahora: new Date('2026-10-08T08:30:00Z') });

    assert.equal(r.clave, 'respaldos/taller_2026-10-08T08-30-00Z.sql.gz');
    assert.deepEqual([r.tablas, r.filas, r.borrados, r.cifrado], [2, 3, 1, false]);
    assert.equal(conexion.destruida, true, 'la conexión del volcado no vuelve al pool');
    assert.deepEqual([...falso.objetos.keys()].sort(), [
      'respaldos/leeme.txt', 'respaldos/taller_2026-10-02T08-30-00Z.sql.gz', 'respaldos/taller_2026-10-08T08-30-00Z.sql.gz',
    ]);

    const sql = zlib.gunzipSync(falso.objetos.get(r.clave)).toString('utf8');
    assert.match(sql, /SET FOREIGN_KEY_CHECKS = 0;/);
    assert.match(sql, /DROP TABLE IF EXISTS `clientes`;\nCREATE TABLE `clientes`/);
    assert.match(sql, /INSERT INTO `clientes` \(`id`, `nombre`\) VALUES\n\(1, 'Ñandú O\\'Brien'\),\n\(2, NULL\);/);
    assert.match(sql, /INSERT INTO `web_fotos` \(`clave`, `bytes`\) VALUES\n\('abc', X'0102ff'\);/);
    assert.match(sql, /-- Respaldo completo: 2 tablas, 3 filas\.\n$/);

    const subida = falso.pedidos.find((p) => p.metodo === 'PUT');
    assert.match(subida.auth, /^AWS4-HMAC-SHA256 Credential=id\/\d{8}\/auto\/s3\/aws4_request, SignedHeaders=content-length;host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/);
    assert.equal(subida.hash, 'UNSIGNED-PAYLOAD');
  } finally {
    falso.servidor.close();
  }
});

test('con frase, lo que se sube está cifrado y se puede bajar y abrir', async () => {
  const falso = await almacenFalso();
  try {
    const config = configRespaldo({ ...ENV, RESPALDO_S3_ENDPOINT: `http://127.0.0.1:${falso.puerto}`, RESPALDO_S3_BUCKET: 'cubo', RESPALDO_S3_ESTILO: 'path', RESPALDO_CLAVE: 'frase secreta' });
    const r = await respaldar({ pool: baseFalsa().pool, config, ahora: new Date('2026-10-08T08:30:00Z') });
    assert.equal(r.clave, 'respaldos/taller_2026-10-08T08-30-00Z.sql.gz.enc');
    assert.equal(falso.objetos.get(r.clave).includes(Buffer.from('clientes')), false, 'no se lee nada del contenido');

    const bajado = tmp('bajado.enc'); const abierto = tmp('bajado.sql.gz');
    await crearS3(config).bajar(r.clave, bajado);
    await descifrarArchivo(bajado, abierto, 'frase secreta');
    assert.match(zlib.gunzipSync(fs.readFileSync(abierto)).toString('utf8'), /INSERT INTO `clientes`/);
  } finally {
    falso.servidor.close();
  }
});

test('si la subida falla, no se borra ningún respaldo anterior y se dice por qué', async () => {
  const falso = await almacenFalso();
  falso.servidor.removeAllListeners('request');
  falso.servidor.on('request', (req, res) => {
    req.resume();
    req.on('end', () => { res.writeHead(403, { 'Content-Type': 'application/xml' }); res.end('<Error><Code>AccessDenied</Code><Message>Sin permiso</Message></Error>'); });
  });
  try {
    const config = configRespaldo({ ...ENV, RESPALDO_S3_ENDPOINT: `http://127.0.0.1:${falso.puerto}`, RESPALDO_S3_BUCKET: 'cubo', RESPALDO_S3_ESTILO: 'path' });
    await assert.rejects(respaldar({ pool: baseFalsa().pool, config }), /403 \(AccessDenied\): Sin permiso/);
  } finally {
    falso.servidor.close();
  }
});

test('una base sin tablas no se respalda (no se sube un archivo vacío)', async () => {
  const subidas = [];
  const s3 = { subir: async (c) => subidas.push(c), listar: async () => [], borrar: async () => {} };
  const pool = { getConnection: async () => ({
    async query(sql) { return /information_schema\.TABLES/.test(sql) ? [[]] : /SELECT DATABASE\(\)/.test(sql) ? [[{ base: 'vacia' }]] : [{}]; },
    destroy() {},
  }) };
  await assert.rejects(respaldar({ pool, config: configRespaldo(ENV), s3 }), /ninguna tabla/);
  assert.equal(subidas.length, 0);
});
