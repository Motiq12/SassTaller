// Convierte el esquema de UN taller en el esquema del SaaS.
//
// El código de MS Motos nació para un taller solo: sus tablas no tienen tenant_id y
// la tabla de vehículos se llama `motos`. Este módulo aplica encima lo que convierte
// esa base en multi-taller, y lo hace de forma idempotente: se puede correr en cada
// arranque y en cada deploy, y si ya está aplicado no hace nada.
//
// Por qué va en un archivo aparte y no mezclado en auto-migrate.js: son dos cosas
// distintas. auto-migrate lleva el esquema de UN taller al día; esto lo multiplica.
// Mezclarlas dejaría 2.000 líneas donde no se puede ver de un vistazo qué pertenece
// al aislamiento entre talleres, que es justo lo que no se puede perder de vista.
//
// El orden importa y no es intercambiable:
//   1. tenants tiene que existir antes que cualquier clave foránea que la apunte.
//   2. El renombre motos→vehiculos va antes de tocar columnas, porque después se
//      agregan índices que nombran la tabla nueva.
//   3. tenant_id va antes de la capa del SaaS, que ya da por hecho que está.
const { pool } = require('./pool');
const { ROLES_FABRICA } = require('../utils/permisos');

// Las tablas que guardan datos DE UN TALLER. Toda consulta que las toque tiene que
// filtrar (ver db/tenant-db.js, que lo exige y revienta si falta).
//
// Las primeras son las que ya tenía el SaaS. Las del segundo bloque las trajo MS
// Motos y hubo que decidirlas: el criterio es si la fila pertenece a un taller.
// Una cita, un feriado o una sesión de un empleado, sí. Un respaldo de la base
// entera o un admin de la plataforma, no.
const TABLAS_DE_TALLER = [
  // Ya estaban en el SaaS
  'citas', 'clientes', 'configuracion', 'email_verify_codes', 'garantias',
  'garantia_fotos', 'login_codes', 'mensajes_internos', 'mensaje_lecturas',
  'notificaciones', 'ordenes_trabajo', 'orden_avances', 'orden_checklist',
  'orden_contadores', 'orden_fotos', 'orden_repuestos', 'orden_tiempos',
  'password_reset_codes', 'promos', 'recompensas_canjeadas', 'servicios',
  'sucursales', 'tareas_mecanico', 'usuarios', 'vehiculos', 'web_vitals',
  // Nuevas, traídas de MS Motos
  'actividad_personal',   // qué hizo cada empleado; es de su taller
  'bloqueos_horario',     // horas cerradas de la agenda de ESE taller
  'cita_servicios',       // los servicios elegidos en una cita
  'eventos_seguridad',    // logins fallidos y cambios de rol, por taller
  'feriados',             // cada taller decide qué días no abre
  'ordenes_eliminadas',   // papelera de órdenes
  'roles',                // roles a medida; cada taller define los suyos
  'sesiones_personal',    // sesiones abiertas del personal
];

// Tablas que NO llevan tenant_id, para dejar la decisión escrita y no tener que
// volver a razonarla. Son de la plataforma: viven por encima de los talleres.
//   tenants, plataforma_admins, planes_config, avisos_plataforma, contactos_demo,
//   motiq_bitacora, motiq_seguidos, motiq_tareas  → son de Motiq
//   reportes_falla   → lleva tenant_id como DATO (de qué taller vino), pero nullable
//                      y sin scope: el reporte le llega a la plataforma, no al taller
//   respaldos_registro → el respaldo es de la base entera, no de un taller
//   web_*            → del sitio web público, que no se trajo a este proyecto

async function existeTabla(nombre) {
  const [[f]] = await pool.query(
    `SELECT COUNT(*) n FROM information_schema.tables
      WHERE table_schema = DATABASE() AND table_name = ?`, [nombre]);
  return f.n > 0;
}

async function existeColumna(tabla, columna) {
  const [[f]] = await pool.query(
    `SELECT COUNT(*) n FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`, [tabla, columna]);
  return f.n > 0;
}

async function existeIndice(tabla, nombre) {
  const [[f]] = await pool.query(
    `SELECT COUNT(*) n FROM information_schema.statistics
      WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ?`, [tabla, nombre]);
  return f.n > 0;
}

// Cada paso se intenta por separado y un fallo no corta la cadena. Es a propósito:
// en una base a medio migrar, que el paso 3 no aplique no es razón para dejar sin
// correr los 30 siguientes. Lo que falle queda en el log con su nombre.
async function paso(nombre, fn) {
  try {
    const hizo = await fn();
    if (hizo) console.log(`🏢 Multi-taller: ${nombre}`);
    return true;
  } catch (err) {
    console.warn(`⚠️  Multi-taller (${nombre}) omitido: ${err.code || err.message}`);
    return false;
  }
}

// 1) La tabla raíz. Todo lo demás le cuelga.
async function crearTenants() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tenants (
      id          INT AUTO_INCREMENT PRIMARY KEY,
      nombre      VARCHAR(150) NOT NULL,
      slug        VARCHAR(60)  NOT NULL COMMENT 'subdominio/identificador publico',
      plan        VARCHAR(30)  NOT NULL DEFAULT 'trial',
      estado      VARCHAR(20)  NOT NULL DEFAULT 'activo' COMMENT 'activo|suspendido|cancelado',
      created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_tenant_slug (slug)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  // El taller 1 es el que ya existía: todo lo que hay en la base queda bajo él.
  // Sin esta fila, las claves foráneas de abajo no podrían apuntar a ningún lado.
  const [r] = await pool.query(
    `INSERT IGNORE INTO tenants (id, nombre, slug, plan, estado)
     VALUES (1, 'Taller principal', 'principal', 'pro', 'activo')`);
  return r.affectedRows > 0;
}

// 2) motos → vehiculos. El sistema se abre a talleres que no son de motos.
//
// Son DOS cambios que se arreglan por separado, no uno en dos pasos. La primera
// versión los tenía encadenados y el segundo falló: quedó la tabla renombrada y las
// columnas con el nombre viejo, y como la función salía temprano al ver que `motos`
// ya no existía, nunca las habría arreglado. Cada parte mira su propio estado.
async function renombrarVehiculos() {
  let hizo = false;

  if ((await existeTabla('motos')) && !(await existeTabla('vehiculos'))) {
    // MySQL mantiene solas las claves foráneas que apuntaban a la tabla.
    await pool.query('RENAME TABLE motos TO vehiculos');
    hizo = true;
  }

  // Las columnas que la referencian. Se usa CHANGE y no RENAME COLUMN porque
  // RENAME COLUMN no existe en MariaDB antes de 10.5 (XAMPP trae 10.4) y revienta
  // con un error de sintaxis. CHANGE anda en las dos, pero exige repetir el tipo,
  // así que se lee del esquema en vez de escribirlo a mano: si mañana la columna
  // deja de ser INT, esto la sigue.
  for (const t of ['citas', 'ordenes_trabajo']) {
    if (!(await existeColumna(t, 'moto_id'))) continue;
    if (await existeColumna(t, 'vehiculo_id')) continue;   // ya hecho
    const [[col]] = await pool.query(
      `SELECT column_type AS tipo, is_nullable AS nulo FROM information_schema.columns
        WHERE table_schema = DATABASE() AND table_name = ? AND column_name = 'moto_id'`, [t]);
    const nulo = col.nulo === 'YES' ? 'NULL' : 'NOT NULL';
    await pool.query(`ALTER TABLE \`${t}\` CHANGE \`moto_id\` \`vehiculo_id\` ${col.tipo} ${nulo}`);
    hizo = true;
  }
  return hizo;
}

// Qué atiende cada vehículo y cada taller. Sin esto un taller de autos no puede
// registrar nada: el tipo no sería un dato, sería una suposición.
async function tiposDeVehiculo() {
  let hizo = false;
  if (await existeTabla('vehiculos')) {
    if (!(await existeColumna('vehiculos', 'tipo'))) {
      await pool.query("ALTER TABLE vehiculos ADD COLUMN tipo VARCHAR(20) NOT NULL DEFAULT 'moto'");
      hizo = true;
    }
    if (!(await existeColumna('vehiculos', 'atributos'))) {
      // Los campos propios de cada tipo van en JSON para que sumar un tipo nuevo
      // más adelante no obligue a tocar el esquema.
      await pool.query('ALTER TABLE vehiculos ADD COLUMN atributos JSON NULL');
      hizo = true;
    }
  }
  if (await existeTabla('configuracion')) {
    if (!(await existeColumna('configuracion', 'tipos_vehiculo'))) {
      await pool.query('ALTER TABLE configuracion ADD COLUMN tipos_vehiculo JSON NULL');
      await pool.query("UPDATE configuracion SET tipos_vehiculo = JSON_ARRAY('moto') WHERE tipos_vehiculo IS NULL");
      hizo = true;
    }
  }
  return hizo;
}

// 3) tenant_id en cada tabla de taller, con su índice y su clave foránea.
//
// DEFAULT 1 a propósito: las filas que ya están pertenecen al taller que ya existía.
// Sin el default, ADD COLUMN NOT NULL sobre una tabla con datos falla.
async function columnaTenant(tabla) {
  if (!(await existeTabla(tabla))) return false;
  let hizo = false;

  if (!(await existeColumna(tabla, 'tenant_id'))) {
    await pool.query(`ALTER TABLE \`${tabla}\` ADD COLUMN tenant_id INT NOT NULL DEFAULT 1`);
    hizo = true;
  }
  const idx = `idx_${tabla}_tenant`;
  if (!(await existeIndice(tabla, idx))) {
    await pool.query(`ALTER TABLE \`${tabla}\` ADD INDEX \`${idx}\` (tenant_id)`);
    hizo = true;
  }
  // La clave foránea va al final y en su propio try: si la base tiene filas con un
  // tenant_id que no existe, falla sola y el resto queda aplicado igual.
  const fk = `fk_${tabla}_tenant`;
  const [[f]] = await pool.query(
    `SELECT COUNT(*) n FROM information_schema.table_constraints
      WHERE table_schema = DATABASE() AND table_name = ? AND constraint_name = ?`, [tabla, fk]);
  if (f.n === 0) {
    try {
      await pool.query(
        `ALTER TABLE \`${tabla}\` ADD CONSTRAINT \`${fk}\` FOREIGN KEY (tenant_id) REFERENCES tenants (id)`);
      hizo = true;
    } catch (err) {
      console.warn(`⚠️  Multi-taller: ${tabla} quedó sin clave foránea a tenants (${err.code || err.message})`);
    }
  }
  return hizo;
}

// 4) Índices COMPUESTOS, que es de lo que depende el rendimiento con muchos talleres.
//
// Un índice de una sola columna sobre tenant_id casi no sirve acá: toda consulta ya
// filtra por taller, así que ese índice no distingue nada dentro del taller — el motor
// acota por tenant y después recorre. Peor todavía cuando un taller grande concentra
// la mayoría de las filas: su propio tenant_id deja de ser selectivo.
//
// Lo que sirve es (tenant_id, <la columna por la que se filtra u ordena>). La lista de
// abajo no se inventó: salió de medir qué columnas acompañan a tenant_id en las
// consultas reales de src/routes. Cada par está puesto porque aparece, no por si acaso
// — un índice de más también cuesta, en cada INSERT y en disco.
const INDICES = [
  // La orden de trabajo es el centro del sistema y la que más se lista y filtra.
  ['ordenes_trabajo', 'estado'], ['ordenes_trabajo', 'fecha_ingreso'],
  ['ordenes_trabajo', 'tecnico_id'], ['ordenes_trabajo', 'cliente_id'],
  ['ordenes_trabajo', 'vehiculo_id'],
  // La agenda: por mecánico, por cliente, por estado y por la orden que la originó.
  ['citas', 'tecnico_id'], ['citas', 'cliente_id'], ['citas', 'estado'], ['citas', 'orden_id'],
  // Las hijas de la orden se piden siempre por su orden.
  ['orden_repuestos', 'orden_id'], ['orden_avances', 'orden_id'], ['orden_fotos', 'orden_id'],
  ['orden_checklist', 'orden_id'], ['orden_tiempos', 'orden_id'], ['garantias', 'orden_id'],
  // El resto del uso diario.
  ['clientes', 'email'], ['vehiculos', 'cliente_id'],
  ['usuarios', 'rol'], ['usuarios', 'activo'],
  ['notificaciones', 'cliente_id'], ['tareas_mecanico', 'tecnico_id'],
  ['promos', 'activa'], ['servicios', 'activo'],
];

async function indicesPorTaller() {
  let puestos = 0;
  for (const [tabla, col] of INDICES) {
    if (!(await existeTabla(tabla))) continue;
    if (!(await existeColumna(tabla, col))) continue;       // la trajo otra versión
    const nombre = `idx_${tabla}_t_${col}`;
    if (await existeIndice(tabla, nombre)) continue;
    try {
      await pool.query(`ALTER TABLE \`${tabla}\` ADD INDEX \`${nombre}\` (tenant_id, \`${col}\`)`);
      puestos++;
    } catch (err) {
      console.warn(`⚠️  Multi-taller: índice ${nombre} omitido (${err.code || err.message})`);
    }
  }

  // El login del personal busca por correo ANTES de saber el taller (el mismo correo
  // puede existir en varios), así que esa consulta no lleva tenant_id y necesita su
  // propio índice. Sin él, cada intento de ingreso recorre la tabla entera de usuarios
  // de TODO el SaaS — y es la consulta que más se repite.
  if ((await existeTabla('usuarios')) && !(await existeIndice('usuarios', 'idx_usuarios_email'))) {
    try {
      await pool.query('ALTER TABLE usuarios ADD INDEX idx_usuarios_email (email)');
      puestos++;
    } catch (err) {
      console.warn(`⚠️  Multi-taller: índice de correo omitido (${err.code || err.message})`);
    }
  }
  return puestos > 0;
}

// Una clave única global hace que dos empresas choquen entre sí: el mismo correo, el
// mismo número de orden o la misma placa no podrían existir en dos talleres. Y como
// "configuracion" tenía de clave solo id = 1, ni siquiera se podía crear un segundo
// taller. Cada una pasa a incluir tenant_id.
const CLAVES_POR_TALLER = [
  { tabla: 'configuracion', quitar: 'PRIMARY', columnas: ['tenant_id', 'id'] },
  { tabla: 'orden_contadores', quitar: 'PRIMARY', columnas: ['tenant_id', 'anio'] },
  { tabla: 'usuarios', quitar: 'email', columnas: ['tenant_id', 'email'], nombre: 'uq_usuarios_tenant_email' },
  { tabla: 'servicios', quitar: 'uq_servicio_nombre', columnas: ['tenant_id', 'nombre'], nombre: 'uq_servicios_tenant_nombre' },
  { tabla: 'ordenes_trabajo', quitar: 'numero_orden', columnas: ['tenant_id', 'numero_orden'], nombre: 'uq_ordenes_tenant_numero' },
  { tabla: 'vehiculos', quitar: 'uq_motos_placa_norm', columnas: ['tenant_id', 'placa_norm'], nombre: 'uq_vehiculos_tenant' },
  { tabla: 'vehiculos', quitar: 'uq_vehiculos_placa_norm', columnas: ['tenant_id', 'placa_norm'], nombre: 'uq_vehiculos_tenant' },
  { tabla: 'roles', quitar: 'uq_roles_clave', columnas: ['tenant_id', 'clave'], nombre: 'uq_roles_tenant_clave' },
  { tabla: 'clientes', quitar: 'uq_clientes_google_sub', columnas: ['tenant_id', 'google_sub'], nombre: 'uq_clientes_tenant_google' },
  { tabla: 'orden_checklist', quitar: 'orden_id', columnas: ['tenant_id', 'orden_id'], nombre: 'uq_checklist_tenant_orden', conservar: '(orden_id)' },
];

async function columnasDeIndice(tabla, indice) {
  const [filas] = await pool.query(
    `SELECT COLUMN_NAME AS c FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ? ORDER BY SEQ_IN_INDEX`,
    [tabla, indice]
  );
  return filas.map((f) => f.c);
}

async function clavesPorTaller() {
  let hizo = false;
  for (const { tabla, quitar, columnas, nombre, conservar } of CLAVES_POR_TALLER) {
    if (!(await existeTabla(tabla)) || !(await existeColumna(tabla, 'tenant_id'))) continue;
    const actuales = await columnasDeIndice(tabla, quitar);
    if (!actuales.length || actuales.includes('tenant_id')) continue;
    const lista = columnas.map((c) => `\`${c}\``).join(', ');
    if (quitar === 'PRIMARY') {
      await pool.query(`ALTER TABLE \`${tabla}\` DROP PRIMARY KEY, ADD PRIMARY KEY (${lista})`);
    } else {
      const yaEsta = (await columnasDeIndice(tabla, nombre)).length > 0;
      // Una clave foránea puede necesitar ese índice: se deja uno común en su lugar.
      if (conservar) await pool.query(`ALTER TABLE \`${tabla}\` ADD INDEX idx_${tabla}_fk ${conservar}`);
      await pool.query(`ALTER TABLE \`${tabla}\` DROP INDEX \`${quitar}\`${yaEsta ? '' : `, ADD UNIQUE KEY \`${nombre}\` (${lista})`}`);
    }
    console.log(`🏢 ${tabla}: la clave ${quitar} ahora es por taller`);
    hizo = true;
  }
  return hizo;
}

// Un registro heredado que quedó rotulado en el taller 1 por el DEFAULT pasa al taller
// de su dueño. Es idempotente: solo toca lo que no coincide.
const ROTULOS = [
  ['cita_servicios', 'cita_id', 'citas'],
  ['sesiones_personal', 'usuario_id', 'usuarios'],
  ['actividad_personal', 'usuario_id', 'usuarios'],
  ['eventos_seguridad', 'usuario_id', 'usuarios'],
  ['eventos_seguridad', 'actor_id', 'usuarios'],
  ['feriados', 'creado_por', 'usuarios'],
  ['bloqueos_horario', 'creado_por', 'usuarios'],
  ['ordenes_eliminadas', 'eliminada_por', 'usuarios'],
  ['mensaje_lecturas', 'usuario_id', 'usuarios'],
];

async function corregirRotulos() {
  let total = 0;
  for (const [tabla, columna, padre] of ROTULOS) {
    if (!(await existeTabla(tabla)) || !(await existeColumna(tabla, columna))) continue;
    const [r] = await pool.query(
      `UPDATE \`${tabla}\` x JOIN \`${padre}\` p ON p.id = x.\`${columna}\`
          SET x.tenant_id = p.tenant_id WHERE x.tenant_id <> p.tenant_id`
    );
    total += r.affectedRows;
  }
  return total > 0;
}

// Sin valor por defecto: una fila sin empresa ahora falla al escribirse. Con DEFAULT 1,
// cualquier INSERT olvidado caía en silencio en la primera empresa registrada.
async function quitarDefectoTenant() {
  let hizo = false;
  for (const tabla of TABLAS_DE_TALLER) {
    if (!(await existeTabla(tabla))) continue;
    const [[c]] = await pool.query(
      `SELECT COLUMN_DEFAULT AS d FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = 'tenant_id'`,
      [tabla]
    );
    if (!c || c.d === null || String(c.d).toUpperCase() === 'NULL') continue;
    await pool.query(`ALTER TABLE \`${tabla}\` ALTER COLUMN tenant_id DROP DEFAULT`);
    hizo = true;
  }
  // Un intento de ingreso con un correo que no existe no pertenece a ninguna empresa.
  if (await existeTabla('eventos_seguridad')) {
    await pool.query('ALTER TABLE eventos_seguridad MODIFY tenant_id INT NULL');
  }
  return hizo;
}

async function colorDeMarca() {
  if (await existeColumna('configuracion', 'color_primario')) return false;
  await pool.query('ALTER TABLE configuracion ADD COLUMN color_primario VARCHAR(7) NULL');
  return true;
}

// Cada empresa tiene su propia copia de los roles de fábrica: puede ajustarlos sin que
// el cambio le llegue a otra.
async function rolesPorTaller() {
  if (!(await existeTabla('roles')) || !(await existeColumna('roles', 'tenant_id'))) return false;
  for (const r of ROLES_FABRICA) {
    await pool.query(
      `INSERT IGNORE INTO roles (tenant_id, clave, nombre, base, descripcion, permisos, de_fabrica)
       SELECT t.id, ?, ?, ?, ?, ?, 1 FROM tenants t`,
      [r.clave, r.nombre, r.base, r.descripcion, JSON.stringify(r.permisos)]
    );
  }
  return false;
}

async function aplicarMultiTenant() {
  console.log('🏢 Aplicando la capa multi-taller…');
  await paso('tabla tenants', crearTenants);
  await paso('motos → vehiculos', renombrarVehiculos);
  await paso('tipos de vehículo', tiposDeVehiculo);

  let tocadas = 0;
  for (const tabla of TABLAS_DE_TALLER) {
    const antes = tocadas;
    await paso(`tenant_id en ${tabla}`, async () => {
      const hizo = await columnaTenant(tabla);
      if (hizo) tocadas++;
      return hizo;
    });
    if (tocadas === antes) continue;
  }
  await paso('índices por taller', indicesPorTaller);
  await paso('claves por taller', clavesPorTaller);
  await paso('rótulos de taller', corregirRotulos);
  await paso('color de marca', colorDeMarca);
  await paso('roles por taller', rolesPorTaller);
  await paso('tenant_id sin valor por defecto', quitarDefectoTenant);
  console.log(`🏢 Capa multi-taller lista (${tocadas} tabla(s) modificada(s) en esta corrida).`);
}

module.exports = { aplicarMultiTenant, renombrarVehiculos, TABLAS_DE_TALLER };
