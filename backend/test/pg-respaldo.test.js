// Simulacro completo: servicio de respaldo -> gzip + AES-GCM -> psql -> migrador.
// Solo bases locales propias y efímeras; nunca usa DATABASE_URL de producción.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Client } = require('pg');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');

const urlPrueba = process.env.PG_TEST_URL && new URL(process.env.PG_TEST_URL);
if (urlPrueba && (!['localhost', '127.0.0.1'].includes(urlPrueba.hostname)
    || !/^\/[a-zA-Z0-9_]+_test$/.test(urlPrueba.pathname))) {
  throw new Error('PG_TEST_URL debe ser local y terminar en _test');
}
const backend = path.resolve(__dirname, '..');
const qid = (s) => `"${s.replace(/"/g, '""')}"`;

function migrar(url) {
  return spawnSync(process.execPath, ['src/db/migrar.js'], {
    cwd: backend, encoding: 'utf8', timeout: 30000,
    env: { ...process.env, DATABASE_URL: url.href, MIGRACION_DATABASE_URL: '', DATABASE_SSL: '', PGSSLMODE: 'disable' },
  });
}

// psql explícito (PSQL_BIN o PSQL_DOCKER_CONTAINER) o el del PATH. Si no hay
// ninguno (Windows sin cliente), se carga con el driver en una sola consulta
// simple: mismo SQL, misma transacción, y un error corta todo como ON_ERROR_STOP.
let modoCarga;
function elegirModoCarga() {
  if (modoCarga) return modoCarga;
  if (process.env.PSQL_DOCKER_CONTAINER) modoCarga = 'docker';
  else if (process.env.PSQL_BIN) modoCarga = 'psql';
  else modoCarga = spawnSync('psql', ['--version'], { encoding: 'utf8' }).error ? 'driver' : 'psql';
  return modoCarga;
}

async function cargar(url, sql) {
  const modo = elegirModoCarga();
  if (modo === 'driver') {
    const c = new Client({ connectionString: url.href });
    await c.connect();
    try {
      await c.query(sql);
      return { status: 0, stdout: '', stderr: '' };
    } catch (err) {
      return { status: 3, stdout: '', stderr: `ERROR: ${err.message}` };
    } finally {
      await c.end(); // cerrar la sesión revierte una transacción abortada
    }
  }
  const env = { ...process.env, PGPASSWORD: decodeURIComponent(url.password), PGSSLMODE: 'disable' };
  const args = ['-X', '-v', 'ON_ERROR_STOP=1', '-U', decodeURIComponent(url.username), '-d', url.pathname.slice(1)];
  // No se ejecuta un shell: el SQL llega intacto por stdin, incluso con \ y emoji.
  const contenedor = process.env.PSQL_DOCKER_CONTAINER;
  const bin = modo === 'docker' ? 'docker' : (process.env.PSQL_BIN || 'psql');
  const argv = modo === 'docker'
    ? ['exec', '-i', '-e', 'PGPASSWORD', contenedor, 'psql', '-h', '127.0.0.1', ...args]
    : ['-h', url.hostname, '-p', url.port || '5432', ...args];
  return spawnSync(bin, argv, { env, input: sql, encoding: 'utf8', timeout: 30000, maxBuffer: 8 * 1024 * 1024 });
}

function exitoso(r) {
  assert.ifError(r.error);
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
}

async function inventario(cliente) {
  const { rows: tablas } = await cliente.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name");
  const resultado = {};
  for (const { table_name: tabla } of tablas) {
    const { rows: [{ n }] } = await cliente.query(`SELECT count(*)::text AS n FROM ${qid(tabla)}`);
    const { rows } = await cliente.query(`SELECT to_jsonb(t)::text AS fila FROM ${qid(tabla)} t ORDER BY to_jsonb(t)::text`);
    const { rowCount: porTaller } = await cliente.query("SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 AND column_name = 'tenant_id'", [tabla]);
    resultado[tabla] = { n, filas: rows.map((r) => r.fila) };
    if (porTaller) resultado[tabla].talleres = (await cliente.query(`SELECT tenant_id, count(*)::text AS n FROM ${qid(tabla)} GROUP BY tenant_id ORDER BY tenant_id`)).rows;
  }
  return resultado;
}

test('PostgreSQL: restaura respaldo cifrado de dos talleres en otra base vacía', {
  skip: !urlPrueba && 'sin PG_TEST_URL', timeout: 120000,
}, async (t) => {
  const prefijo = urlPrueba.pathname.slice(1, -5).slice(0, 24);
  const sello = `${process.pid}_${crypto.randomBytes(3).toString('hex')}`;
  const origen = new URL(urlPrueba); origen.pathname = `/${prefijo}_respaldo_${sello}_test`;
  const destino = new URL(urlPrueba); destino.pathname = `/${prefijo}_restaurado_${sello}_test`;
  const admin = new Client({ connectionString: urlPrueba.href });
  const lector = new Client({ connectionString: destino.href });
  const creadas = [];
  const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'motiq-restaurar-'));
  let pool;
  try {
    await admin.connect();
    t.diagnostic(`Carga del SQL con: ${elegirModoCarga()}`);
    t.diagnostic(`Servidor PostgreSQL ${(await admin.query('SHOW server_version')).rows[0].server_version}`);
    for (const url of [origen, destino]) {
      await admin.query(`CREATE DATABASE ${qid(url.pathname.slice(1))} TEMPLATE template0`);
      creadas.push(url.pathname.slice(1));
    }
    exitoso(migrar(origen));
    exitoso(migrar(destino)); // prueba que el entrypoint sí crea el esquema
    process.env.DATABASE_URL = origen.href;
    process.env.MIGRACION_DATABASE_URL = '';
    ({ pool } = require('../src/db/pool'));
    const db = pool.nativo;
    for (const [i, slug] of ['alfa', 'beta'].entries()) {
      const tid = i + 11;
      await db.query('INSERT INTO tenants (id, nombre, slug) VALUES ($1, $2, $3)', [tid, `Taller ${slug}`, slug]);
      await db.query("INSERT INTO clientes (id, tenant_id, nombre, apellido, telefono) VALUES ($1, $1, $2, 'Mora', '88880000')", [tid, "Ñandú O'Brien 🛠️\\\nlínea dos"]);
      await db.query("INSERT INTO sucursales (id, tenant_id, nombre) VALUES ($1, $1, 'Central')", [tid]);
      await db.query("INSERT INTO usuarios (id, tenant_id, sucursal_id, nombre, email, password_hash) VALUES ($1, $1, $1, 'Técnico', $2, 'hash-sintetico')", [tid, `${slug}@example.test`]);
      await db.query("INSERT INTO vehiculos (id, tenant_id, cliente_id, tipo, marca, modelo, placa, atributos) VALUES ($1, $1, $1, 'auto', 'Toyota', 'Prueba', 'ABC-123', $2)", [tid, JSON.stringify({ nota: "emoji 🛠️ y 'comillas'", kilometros: '9007199254740993' })]);
      await db.query("INSERT INTO ordenes_trabajo (id, tenant_id, vehiculo_id, cliente_id, tecnico_id, sucursal_id, numero_orden, problema_reportado, costo_mano_obra) VALUES ($1, $1, $1, $1, $1, $1, 'OT-1', 'Frenos', 123456.78)", [tid]);
      await db.query("INSERT INTO citas (tenant_id, cliente_id, vehiculo_id, orden_id, fecha, hora, motivo) VALUES ($1, $1, $1, $1, '2030-01-02', '10:30', 'Revisión')", [tid]);
    }
    // Más de una tanda, secuencias adelantadas y tablas vacías con ids consumidos.
    await db.query("INSERT INTO clientes (id, tenant_id, nombre, apellido, telefono) SELECT n, 11, 'Cliente ' || n, 'Prueba', '1' FROM generate_series(100, 154) n");
    await db.query("SELECT setval(pg_get_serial_sequence('clientes', 'id'), 900, true)");
    await db.query("SELECT setval(pg_get_serial_sequence('avisos_plataforma', 'id'), 60, true)");
    const antes = await inventario(db);
    assert.equal(antes.tenants.n, '2');

    const { respaldar, configRespaldo } = require('../src/services/respaldo');
    const archivo = path.join(carpeta, 'respaldo.sql.gz.enc');
    const objetos = [];
    const resumen = await respaldar({ pool, config: configRespaldo({
      RESPALDO_S3_ENDPOINT: 'http://almacen.invalid', RESPALDO_S3_BUCKET: 'prueba',
      RESPALDO_S3_ACCESS_KEY_ID: 'prueba', RESPALDO_S3_SECRET_ACCESS_KEY: 'prueba', RESPALDO_CLAVE: 'solo-simulacro',
    }), s3: {
      async subir(clave, temporal) { fs.copyFileSync(temporal, archivo); objetos.push({ clave, bytes: fs.statSync(archivo).size }); },
      async listar() { return objetos; },
      async borrar() { assert.fail('No debe rotar ningún objeto en este simulacro'); },
    } });
    assert.equal(resumen.cifrado, true);
    const abierto = path.join(carpeta, 'respaldo.sql.gz');
    const { descifrarArchivo } = require('../src/utils/cifrado-archivo');
    await descifrarArchivo(archivo, abierto, 'solo-simulacro');
    const sql = zlib.gunzipSync(fs.readFileSync(abierto)).toString('utf8');
    assert.match(sql, /-- Respaldo completo: \d+ tablas, \d+ filas\.\n$/);

    await lector.connect();
    // No puede cargar con un historial distinto, ni dejar una carga parcial.
    await lector.query("INSERT INTO schema_migraciones(nombre) VALUES ('9999_incompatible.sql')");
    const incompatible = await cargar(destino, sql);
    assert.equal(incompatible.status, 3, incompatible.stderr);
    assert.match(incompatible.stderr, /esquema destino no coincide/);
    await lector.query("DELETE FROM schema_migraciones WHERE nombre = '9999_incompatible.sql'");

    // Una referencia rota debe abortar la transacción completa, incluso si llegó
    // hasta el final. No se desactivan triggers ni session_replication_role.
    const roto = sql.replace(/(INSERT INTO "clientes"[^;]+;)/, '$1\nUPDATE clientes SET tenant_id = 999999;');
    assert.notEqual(roto, sql);
    const fkRota = await cargar(destino, roto);
    assert.equal(fkRota.status, 3, fkRota.stderr);
    assert.match(fkRota.stderr, /foreign key constraint/);
    assert.equal((await lector.query('SELECT count(*)::text AS n FROM tenants')).rows[0].n, '0');

    exitoso(await cargar(destino, sql));
    assert.deepEqual(await inventario(lector), antes, 'todos los conteos, datos e historial coinciden, también por taller');
    const segundaMigracion = migrar(destino);
    exitoso(segundaMigracion);
    assert.match(segundaMigracion.stdout, /Esquema al día/);
    assert.deepEqual(await inventario(lector), antes, 'el migrador no repite backfills');

    const repetido = await cargar(destino, sql);
    assert.equal(repetido.status, 3, repetido.stderr);
    assert.match(repetido.stderr, /destino debe estar vacío/);
    assert.deepEqual(await inventario(lector), antes, 'una segunda carga no altera los datos');

    // El verificador de la guía también tiene que pasar sobre la base restaurada.
    // Con el driver no hay \gexec: se corre su bloque de FK y secuencias.
    const verificador = fs.readFileSync(path.join(backend, 'scripts/verificar-restauracion.sql'), 'utf8');
    if (elegirModoCarga() === 'driver') {
      await lector.query(verificador.match(/DO \$verificar\$[\s\S]+?\$verificar\$;/)[0]);
    } else {
      const verificado = await cargar(destino, verificador);
      exitoso(verificado);
      assert.match(verificado.stdout, /alfa|beta|tenants/);
    }

    const { rows: fks } = await lector.query("SELECT conname, convalidated, condeferrable FROM pg_constraint WHERE contype = 'f' AND connamespace = 'public'::regnamespace");
    assert.ok(fks.length > 0);
    assert.ok(fks.every((fk) => fk.convalidated && fk.condeferrable));
    const { rows: ids } = await lector.query("SELECT table_name, column_name, pg_get_serial_sequence(quote_ident(table_name), column_name) AS secuencia FROM information_schema.columns WHERE table_schema = 'public' AND is_identity = 'YES'");
    for (const { table_name: tabla, column_name: columna, secuencia } of ids) {
      const { rows: [r] } = await lector.query(`SELECT nextval($1::regclass)::text AS siguiente, (SELECT max(${qid(columna)})::text FROM ${qid(tabla)}) AS maximo`, [secuencia]);
      assert.ok(BigInt(r.siguiente) > BigInt(r.maximo || '0'), `secuencia utilizable: ${tabla}`);
      if (tabla === 'clientes') assert.equal(r.siguiente, '901');
      if (tabla === 'avisos_plataforma') assert.equal(r.siguiente, '61');
    }
    t.diagnostic(`${resumen.tablas} tablas y ${resumen.filas} filas restauradas; conteos por taller, datos, FK, secuencias e idempotencia verificados`);
  } finally {
    if (pool) await pool.end();
    await lector.end();
    // Solo nombres creados exitosamente por ESTA ejecución; jamás una base ajena.
    for (const nombre of creadas.reverse()) await admin.query(`DROP DATABASE ${qid(nombre)} WITH (FORCE)`);
    await admin.end();
    fs.rmSync(carpeta, { recursive: true, force: true });
  }
});
