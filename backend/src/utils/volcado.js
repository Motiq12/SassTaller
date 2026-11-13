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
    const tablas = todas;
    const tieneHistorial = tablas.some((t) => t.nombre === 'schema_migraciones');
    if (tablas.length && !tieneHistorial) {
      throw new Error('Falta schema_migraciones: ejecutar el migrador antes de respaldar');
    }
    const [migraciones] = tieneHistorial
      ? await conexion.query('SELECT nombre FROM schema_migraciones ORDER BY nombre')
      : [[]];

    await escribir([
      `-- Respaldo de los datos de la base ${base}`,
      `-- Hecho el ${ahora.toISOString()} por el sistema (respaldo automático).`,
      '-- Preparar una base vacía con el mismo esquema: node src/db/migrar.js (ver docs/RESPALDOS.md).',
      '-- Cargar: psql -X -v ON_ERROR_STOP=1 -d <destino> -f respaldo.sql',
      `-- Migraciones: ${JSON.stringify(migraciones.map((m) => m.nombre))}`,
      '',
      'SET standard_conforming_strings = on;',
      "SET client_encoding = 'UTF8';",
      "SET TIME ZONE 'UTC';",
      "SET search_path = public;",
      'BEGIN;',
      // Las claves foráneas se revisan al final: así no importa el orden de las tablas.
      'SET CONSTRAINTS ALL DEFERRED;',
      '',
    ].join('\n'));

    // El esquema se reconstruye con el código de la fecha del respaldo. No se
    // acepta una versión más nueva: podría cambiar defaults o saltarse backfills.
    if (tieneHistorial) {
      const versiones = migraciones.map((m) => literal(m.nombre, 'text')).join(', ');
      await escribir(`\nDO $restaurar$ BEGIN
  IF (SELECT COALESCE(array_agg(nombre ORDER BY nombre), ARRAY[]::text[]) FROM schema_migraciones)
     IS DISTINCT FROM ARRAY[${versiones}]::text[] THEN
    RAISE EXCEPTION 'El esquema destino no coincide con las migraciones del respaldo';
  END IF;
END $restaurar$;\n`);
    }
    // No borrar ni mezclar datos existentes. Los locks duran hasta COMMIT y
    // evitan que otra sesión inserte después de comprobar que todo está vacío.
    if (tablas.length) await escribir(`LOCK TABLE ${tablas.map((t) => id(t.nombre)).join(', ')} IN ACCESS EXCLUSIVE MODE;\n`);
    for (const { nombre } of tablas.filter((t) => t.nombre !== 'schema_migraciones')) {
      await escribir(`DO $restaurar$ BEGIN
  IF EXISTS (SELECT 1 FROM ${id(nombre)}) THEN
    RAISE EXCEPTION 'El destino debe estar vacío; tabla con datos: %', ${literal(nombre, 'text')};
  END IF;
END $restaurar$;\n`);
    }

    let totalFilas = 0;
    const secuencias = [];
    for (const { nombre } of tablas) {
      const [info] = await conexion.query(
        `SELECT column_name AS nombre, data_type AS tipo, is_generated AS generada, is_identity AS identidad,
                pg_get_serial_sequence(quote_ident(table_schema) || '.' || quote_ident(table_name), column_name) AS secuencia
           FROM information_schema.columns
          WHERE table_schema = current_schema() AND table_name = ? ORDER BY ordinal_position`,
        [nombre]
      );
      const columnas = columnasRespaldables(info);
      const lista = columnas.map((c) => id(c.nombre)).join(', ');
      const seleccion = columnas.map((c) => `${id(c.nombre)}::text AS ${id(c.nombre)}`).join(', ');
      const identidad = columnas.some((c) => c.identidad === 'YES') ? ' OVERRIDING SYSTEM VALUE' : '';
      const cabecera = `INSERT INTO ${id(nombre)} (${lista})${identidad} VALUES\n`;
      // El migrador ya creó estas filas. Recuperar sus fechas originales conserva
      // el historial sin volver a ejecutar migraciones ni borrar su tabla.
      const conflicto = nombre === 'schema_migraciones'
        ? ' ON CONFLICT (nombre) DO UPDATE SET aplicada_en = EXCLUDED.aplicada_en'
        : '';

      let lote = [];
      let bytes = 0;
      let filas = 0;
      const vaciar = async () => {
        if (!lote.length) return;
        await escribir(cabecera + lote.join(',\n') + conflicto + ';\n');
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

      // Identidades Y seriales, incluso vacíos o adelantados por filas borradas.
      // ::text evita perder precisión por el parser global de bigint del pool.
      for (const columna of columnas.filter((c) => c.secuencia)) {
        const [[estado]] = await conexion.query(`SELECT last_value::text AS valor, is_called AS llamada FROM ${columna.secuencia}`);
        const [[config]] = await conexion.query('SELECT seqincrement::text AS incremento FROM pg_sequence WHERE seqrelid = ?::regclass', [columna.secuencia]);
        if (BigInt(config.incremento) <= 0n) throw new Error(`Secuencia descendente no soportada: ${columna.secuencia}`);
        const c = id(columna.nombre);
        secuencias.push(`SELECT setval(pg_get_serial_sequence(${literal(id(nombre), 'text')}, ${literal(columna.nombre, 'text')}), GREATEST(COALESCE(MAX(${c}), ${estado.valor}), ${estado.valor}), ${estado.llamada ? 'true' : 'false'} OR MAX(${c}) IS NOT NULL) FROM ${id(nombre)};`);
      }
      await escribir(`-- ${filas} filas en ${id(nombre)}\n`);
      await escribir(`DO $restaurar$ BEGIN
  IF (SELECT count(*) FROM ${id(nombre)}) <> ${filas} THEN
    RAISE EXCEPTION 'Conteo incorrecto en %', ${literal(nombre, 'text')};
  END IF;
END $restaurar$;\n`);
    }

    await escribir([
      '',
      // Validar las FK ANTES de setval: los cambios a secuencias no se revierten.
      'SET CONSTRAINTS ALL IMMEDIATE;',
      ...secuencias,
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
