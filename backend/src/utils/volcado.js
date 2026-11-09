// Volcado de los datos a SQL, sin depender de `pg_dump`.
//
// En Railway el backend corre en un contenedor sin el cliente de Postgres, así que el
// respaldo automático no puede llamar a `pg_dump` como el script manual
// (scripts/backup-db.js). Esto escribe los DATOS: el esquema sale de db/migraciones.
//
// Para restaurar: una base vacía, `node src/db/migrar.js`, y cargar el archivo con psql.
//
// Lo que cuida, y por qué:
// - Una sola transacción REPEATABLE READ: el respaldo es una foto coherente aunque los
//   talleres sigan trabajando mientras corre.
// - Las filas se leen por tandas: hay tablas con fotos en base64, y cargar una tabla
//   entera en memoria tumbaría el proceso.
// - Cada valor sale como texto de Postgres (::text), sin pasar por números ni fechas de
//   JavaScript: no se pierde un decimal, un bigint ni una zona horaria.

const NUMERICOS = new Set(['smallint', 'integer', 'bigint', 'numeric', 'real', 'double precision']);
const ES_NUMERO = /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/;
const FILAS_POR_TANDA = 50;
// Un INSERT se corta al pasar de este tamaño. Una fila sola puede superarlo: va sola.
const BYTES_POR_INSERT = 512 * 1024;
// Las escribe el migrador al preparar la base que se va a restaurar.
const NO_SE_RESPALDAN = new Set(['schema_migraciones']);

const id = (nombre) => `"${String(nombre).replace(/"/g, '""')}"`;

// El valor de una columna, escrito como literal de SQL. Los bytea llegan como \x0102ff.
function literal(valor, tipo) {
  if (valor === null || valor === undefined) return 'NULL';
  if (NUMERICOS.has(tipo) && ES_NUMERO.test(valor)) return String(valor);
  return `'${String(valor).replace(/'/g, "''")}'`;
}

// Las columnas generadas no: Postgres las calcula y rechaza que se les inserte un valor.
function columnasRespaldables(columnas) {
  return columnas.filter((c) => c.generada !== 'ALWAYS');
}

// conexion: una conexión de pool.getConnection().
// escribir(texto): función async que recibe el SQL por trozos.
async function volcarBase(conexion, escribir, { ahora = new Date() } = {}) {
  await conexion.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try {
    const [[{ base }]] = await conexion.query('SELECT current_database() AS base');
    const [todas] = await conexion.query(
      "SELECT table_name AS nombre FROM information_schema.tables WHERE table_schema = current_schema() AND table_type = 'BASE TABLE' ORDER BY table_name"
    );
    const tablas = todas.filter((t) => !NO_SE_RESPALDAN.has(t.nombre));

    await escribir([
      `-- Respaldo de los datos de la base ${base}`,
      `-- Hecho el ${ahora.toISOString()} por el sistema (respaldo automático).`,
      '-- Para restaurar: base vacía, node src/db/migrar.js, y gunzip -c <archivo>.sql.gz | psql <base>',
      '',
      'SET standard_conforming_strings = on;',
      "SET client_encoding = 'UTF8';",
      "SET TIME ZONE 'UTC';",
      'BEGIN;',
      // Las claves foráneas se revisan al final: así no importa el orden de las tablas.
      'SET CONSTRAINTS ALL DEFERRED;',
      '',
    ].join('\n'));

    let totalFilas = 0;
    for (const { nombre } of tablas) {
      const [info] = await conexion.query(
        `SELECT column_name AS nombre, data_type AS tipo, is_generated AS generada, is_identity AS identidad
           FROM information_schema.columns
          WHERE table_schema = current_schema() AND table_name = ? ORDER BY ordinal_position`,
        [nombre]
      );
      const columnas = columnasRespaldables(info);
      const lista = columnas.map((c) => id(c.nombre)).join(', ');
      const seleccion = columnas.map((c) => `${id(c.nombre)}::text AS ${id(c.nombre)}`).join(', ');
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

      await escribir(`\n-- Tabla ${id(nombre)}\n`);
      for (let desde = 0; ; desde += FILAS_POR_TANDA) {
        const [tanda] = await conexion.query(
          `SELECT ${seleccion} FROM ${id(nombre)} ORDER BY ctid LIMIT ${FILAS_POR_TANDA} OFFSET ${desde}`
        );
        for (const fila of tanda) {
          const tupla = '(' + columnas.map((c) => literal(fila[c.nombre], c.tipo)).join(', ') + ')';
          lote.push(tupla);
          bytes += tupla.length;
          filas++;
          if (bytes >= BYTES_POR_INSERT) await vaciar();
        }
        if (tanda.length < FILAS_POR_TANDA) break;
      }
      await vaciar();
      totalFilas += filas;

      // El contador de ids sigue después del último restaurado.
      const conId = columnas.find((c) => c.identidad === 'YES');
      if (conId) {
        const c = id(conId.nombre);
        await escribir(`SELECT setval(pg_get_serial_sequence('${id(nombre)}', '${conId.nombre}'), COALESCE(MAX(${c}), 1), MAX(${c}) IS NOT NULL) FROM ${id(nombre)};\n`);
      }
      await escribir(`-- ${filas} filas en ${id(nombre)}\n`);
    }

    await escribir([
      '',
      'COMMIT;',
      // Si esta línea no está, el archivo quedó cortado y no hay que restaurarlo.
      `-- Respaldo completo: ${tablas.length} tablas, ${totalFilas} filas.`,
      '',
    ].join('\n'));
    return { base, tablas: tablas.length, filas: totalFilas };
  } finally {
    await conexion.query('ROLLBACK').catch(() => {});
  }
}

module.exports = { volcarBase, literal, columnasRespaldables };
