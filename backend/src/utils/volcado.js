// Volcado de la base a SQL, sin depender de `mysqldump`.
//
// En Railway el backend corre en un contenedor sin el cliente de MySQL, así que
// el respaldo automático no puede llamar a `mysqldump` como hace el script
// manual. Esto escribe lo mismo que hace falta para restaurar: cada tabla con
// su CREATE TABLE y sus filas, en un archivo que se carga con el cliente `mysql`
// de siempre.
//
// Lo que cuida, y por qué:
// - Una sola transacción con instantánea (igual que `mysqldump
//   --single-transaction`): el respaldo es una foto coherente aunque el taller
//   siga trabajando mientras corre.
// - Las filas se leen de a una y se escriben de a una: hay tablas con fotos en
//   base64, y cargar una tabla entera en memoria tumbaría el proceso.
// - Cada valor sale como texto tal cual lo manda MySQL (sin pasar por números
//   ni fechas de JavaScript), así no se pierde un decimal, un BIGINT ni una hora.
// - Las columnas binarias van en hexadecimal.

const mysql = require('mysql2');

const BINARIOS = new Set(['binary', 'varbinary', 'tinyblob', 'blob', 'mediumblob', 'longblob', 'bit',
  'geometry', 'point', 'linestring', 'polygon', 'multipoint', 'multilinestring', 'multipolygon', 'geomcollection', 'geometrycollection']);
const NUMERICOS = new Set(['tinyint', 'smallint', 'mediumint', 'int', 'bigint', 'decimal', 'float', 'double', 'year']);
const ES_NUMERO = /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/;

// Un INSERT se corta al pasar de este tamaño, para que restaurar no dependa de
// un max_allowed_packet enorme. Una fila sola puede superarlo (una foto): va sola.
const BYTES_POR_INSERT = 512 * 1024;

const id = (nombre) => mysql.escapeId(nombre);

// El valor de una columna, escrito como literal de SQL.
function literal(valor, tipo) {
  if (valor === null || valor === undefined) return 'NULL';
  if (Buffer.isBuffer(valor)) return `X'${valor.toString('hex')}'`;
  if (NUMERICOS.has(tipo) && ES_NUMERO.test(valor)) return String(valor);
  return mysql.escape(String(valor));
}

// Columnas que se respaldan de una tabla. Las generadas (VIRTUAL o STORED) no:
// MySQL las calcula solo y rechaza que se les inserte un valor. Ojo que
// "DEFAULT_GENERATED" es otra cosa (un valor por defecto calculado) y sí va.
function columnasRespaldables(columnas) {
  return columnas.filter((c) => !/\b(VIRTUAL|STORED) GENERATED\b/i.test(c.extra || ''));
}

// conexion: una conexión de mysql2/promise dedicada a esto (no se reutiliza
// después: se le cambia la zona horaria de la sesión).
// escribir(texto): función async que recibe el SQL por trozos.
async function volcarBase(conexion, escribir, { ahora = new Date() } = {}) {
  // Las columnas TIMESTAMP se muestran en la zona de la sesión: se fija UTC acá y
  // en el archivo, para que al restaurar caigan en el mismo instante.
  await conexion.query("SET SESSION time_zone = '+00:00'");
  await conexion.query('SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ');
  await conexion.query('START TRANSACTION WITH CONSISTENT SNAPSHOT');

  const [[{ base }]] = await conexion.query('SELECT DATABASE() AS base');
  const [tablas] = await conexion.query(
    "SELECT TABLE_NAME AS nombre FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME"
  );

  await escribir([
    `-- Respaldo de la base \`${base}\``,
    `-- Hecho el ${ahora.toISOString()} por el sistema (respaldo automático).`,
    '-- Para restaurar: gunzip -c <archivo>.sql.gz | mysql --default-character-set=utf8mb4 -u <usuario> -p <base>',
    '',
    'SET NAMES utf8mb4;',
    "SET time_zone = '+00:00';",
    'SET FOREIGN_KEY_CHECKS = 0;',
    'SET UNIQUE_CHECKS = 0;',
    "SET SQL_MODE = 'NO_AUTO_VALUE_ON_ZERO';",
    '',
  ].join('\n'));

  let totalFilas = 0;
  for (const { nombre } of tablas) {
    const [[crear]] = await conexion.query(`SHOW CREATE TABLE ${id(nombre)}`);
    const [todas] = await conexion.query(
      'SELECT COLUMN_NAME AS nombre, DATA_TYPE AS tipo, EXTRA AS extra FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION',
      [nombre]
    );
    const columnas = columnasRespaldables(todas);
    const tipos = columnas.map((c) => String(c.tipo).toLowerCase());
    const binarias = new Set(columnas.filter((c, i) => BINARIOS.has(tipos[i])).map((c) => c.nombre));
    const lista = columnas.map((c) => id(c.nombre)).join(', ');

    await escribir(`\n--\n-- Tabla ${id(nombre)}\n--\nDROP TABLE IF EXISTS ${id(nombre)};\n${crear['Create Table']};\n\n`);

    const cabecera = `INSERT INTO ${id(nombre)} (${lista}) VALUES\n`;
    let lote = [];
    let bytes = 0;
    let filas = 0;
    const vaciar = async () => {
      if (!lote.length) return;
      await escribir(cabecera + lote.join(',\n') + ';\n');
      lote = [];
      bytes = 0;
    };

    // typeCast: el texto tal cual llega de MySQL; las binarias, como Buffer.
    const consulta = conexion.connection.query({
      sql: `SELECT ${lista} FROM ${id(nombre)}`,
      rowsAsArray: true,
      typeCast: (campo) => (binarias.has(campo.name) ? campo.buffer() : campo.string('utf8')),
    });
    for await (const fila of consulta.stream({ highWaterMark: 16 })) {
      const tupla = '(' + fila.map((v, i) => literal(v, tipos[i])).join(', ') + ')';
      lote.push(tupla);
      bytes += tupla.length;
      filas++;
      if (bytes >= BYTES_POR_INSERT) await vaciar();
    }
    await vaciar();
    totalFilas += filas;
    await escribir(`-- ${filas} filas en ${id(nombre)}\n`);
  }

  await escribir([
    '',
    'SET FOREIGN_KEY_CHECKS = 1;',
    'SET UNIQUE_CHECKS = 1;',
    // Si esta línea no está, el archivo quedó cortado y no hay que restaurarlo.
    `-- Respaldo completo: ${tablas.length} tablas, ${totalFilas} filas.`,
    '',
  ].join('\n'));

  await conexion.query('COMMIT');
  return { base, tablas: tablas.length, filas: totalFilas };
}

module.exports = { volcarBase, literal, columnasRespaldables };
