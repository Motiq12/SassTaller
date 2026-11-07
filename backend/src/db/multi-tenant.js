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
  console.log(`🏢 Capa multi-taller lista (${tocadas} tabla(s) modificada(s) en esta corrida).`);
}

module.exports = { aplicarMultiTenant, TABLAS_DE_TALLER };
