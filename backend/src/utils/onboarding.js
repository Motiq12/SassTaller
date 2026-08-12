// Alta de un taller nuevo en el SaaS.
//
// Antes de esto, dar de alta un taller era un INSERT a mano en MySQL más varios
// pasos sueltos. La semilla vivía en el arranque del servidor (auto-migrate), lo
// que era doblemente incorrecto: sembraba los datos del taller original ("MS
// Motos", sucursales "Liberia" y "Cañas") y, desde multi-tenancy, ni siquiera
// corría. La configuración de un taller depende de lo que ESE taller declaró al
// registrarse, así que su lugar natural es el alta, no el boot.
const bcrypt = require('bcrypt');
const { DEFAULTS } = require('./configuracion');

// Slugs que no puede tomar un taller: son subdominios de infraestructura, y
// dejarlos libres permitiría que alguien registre `api` o `www` y se quede con el
// subdominio por el que pasa el tráfico del resto.
const SLUGS_RESERVADOS = new Set([
  'www', 'api', 'app', 'admin', 'panel', 'portal', 'mail', 'smtp', 'ftp', 'cdn',
  'static', 'assets', 'blog', 'docs', 'help', 'soporte', 'status', 'dev', 'test',
  'staging', 'demo', 'login', 'signup', 'registro', 'cuenta', 'billing', 'pagos',
]);

// 3-40 caracteres, minúsculas, números y guiones internos. Se usa como subdominio,
// así que no puede empezar ni terminar con guion.
const RE_SLUG = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;

function normalizarSlug(valor) {
  return String(valor || '')
    .trim().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')  // quita tildes
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Devuelve el motivo del rechazo, o null si el slug sirve.
function motivoSlugInvalido(slug) {
  if (!slug) return 'El identificador del taller es requerido';
  if (!RE_SLUG.test(slug)) {
    return 'El identificador debe tener entre 3 y 40 caracteres: minúsculas, números y guiones';
  }
  if (SLUGS_RESERVADOS.has(slug)) return 'Ese identificador está reservado, elegí otro';
  return null;
}

// Crea el taller completo y utilizable. TODO ocurre en una transacción: si algo
// falla a mitad, no puede quedar un taller sin admin ocupando un slug — un registro
// huérfano que nadie puede usar ni volver a registrar.
//
// `conn` debe ser una conexión con transacción ya abierta. Devuelve { tenantId, adminId }.
async function crearTaller(conn, datos) {
  const { nombre, slug, plan = 'trial', admin, sucursal, contacto = {} } = datos;

  const [tenant] = await conn.query(
    "INSERT INTO tenants (nombre, slug, plan, estado) VALUES (?, ?, ?, 'activo')",
    [nombre, slug, plan]
  );
  const tenantId = tenant.insertId;

  // 1) Usuario admin: es el dueño de la cuenta y la única forma de entrar.
  const hash = await bcrypt.hash(admin.password, 10);
  const [usuario] = await conn.query(
    "INSERT INTO usuarios (tenant_id, nombre, email, password_hash, rol, telefono, activo) VALUES (?, ?, ?, ?, 'admin', ?, 1)",
    [tenantId, admin.nombre, admin.email, hash, admin.telefono || null]
  );

  // 2) Configuración con los datos del taller y el resto de los DEFAULTS, para que
  //    la agenda del portal funcione desde el primer minuto sin tocar nada.
  await conn.query(
    `INSERT INTO configuracion
       (tenant_id, id, nombre_taller, telefono, email, direccion,
        max_citas_hora, dias_anticipacion, duracion_cita_min, cancelacion_horas_min,
        horarios, garantia_dias, metodos_pago, visitas_para_cortesia, zona_horaria_offset)
     VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      tenantId, nombre, contacto.telefono || '', contacto.email || admin.email, contacto.direccion || '',
      DEFAULTS.max_citas_hora, DEFAULTS.dias_anticipacion, DEFAULTS.duracion_cita_min,
      DEFAULTS.cancelacion_horas_min, JSON.stringify(DEFAULTS.horarios),
      DEFAULTS.garantia_dias, JSON.stringify(DEFAULTS.metodos_pago),
      DEFAULTS.visitas_para_cortesia, DEFAULTS.zona_horaria_offset,
    ]
  );

  // 3) Primera sucursal. El sistema asume que hay al menos una: sin ella el portal
  //    no puede ofrecer dónde agendar.
  await conn.query(
    'INSERT INTO sucursales (tenant_id, nombre, direccion, telefono, activa, orden) VALUES (?, ?, ?, ?, 1, 1)',
    [tenantId, sucursal?.nombre || nombre, sucursal?.direccion || contacto.direccion || null, sucursal?.telefono || contacto.telefono || null]
  );

  // 4) Catálogo de servicios inicial, editable después desde el panel.
  await conn.query(
    `INSERT INTO servicios (tenant_id, nombre, orden)
     SELECT ?, v.nombre, v.orden FROM (
                 SELECT 'Cambio de aceite y filtros' AS nombre, 1 AS orden
       UNION ALL SELECT 'Revisión completa', 2
       UNION ALL SELECT 'Cambio de pastillas de freno', 3
       UNION ALL SELECT 'Kit de transmisión (cadena y piñones)', 4
       UNION ALL SELECT 'Diagnóstico electrónico', 5
       UNION ALL SELECT 'Cambio de neumáticos', 6
       UNION ALL SELECT 'Mantenimiento preventivo', 7
       UNION ALL SELECT 'Sistema eléctrico', 8
       UNION ALL SELECT 'Afinamiento', 9
       UNION ALL SELECT 'Otro', 99
     ) v`,
    [tenantId]
  );

  return { tenantId, adminId: usuario.insertId };
}

module.exports = { crearTaller, normalizarSlug, motivoSlugInvalido, SLUGS_RESERVADOS };
