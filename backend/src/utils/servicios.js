// Catálogo de servicios y cupos de agenda (compartido por el portal y recepción).
//
// El catálogo vive en la tabla `servicios` y se administra desde el panel. La lista de
// abajo queda solo como respaldo: es lo que se usa si la tabla todavía no existe (BD sin
// migrar) para que el portal no se quede sin nada que ofrecer.
// Multi-tenant: el catálogo es por taller, así que todo recibe el `db` scopeado.
const SERVICIOS_DEFECTO = [
  'Cambio de aceite y filtros',
  'Revisión completa',
  'Cambio de pastillas de freno',
  'Kit de transmisión (cadena y piñones)',
  'Diagnóstico electrónico',
  'Cambio de neumáticos',
];

// Horas agendables: de 8:00 a 16:00, una por hora.
const HORAS = ['08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00'];

// Máximo de citas por franja horaria.
const MAX_POR_HORA = 2;

// Caché en memoria con el mismo criterio que utils/configuracion.js: el catálogo se
// consulta en cada carga del formulario de agendar y cambia muy de vez en cuando.
// Caché POR TALLER: con una global, el catálogo del primer taller consultado se
// serviría al siguiente durante el TTL (ver el comentario en configuracion.js).
const cache = new Map(); // tenantId -> { filas, at }
const TTL_MS = 30 * 1000;

// Filas completas (id, nombre, activo, orden) — para administrarlas.
async function getServiciosFilas(db) {
  if (!db || !db.tenantId) throw new Error('getServiciosFilas: falta el db scopeado (req.db)');
  const guardado = cache.get(db.tenantId);
  if (guardado && Date.now() - guardado.at < TTL_MS) return guardado.filas;
  let filas;
  try {
    const [rows] = await db.query(
      'SELECT id, nombre, activo, orden FROM servicios WHERE tenant_id = @tenant ORDER BY orden, nombre'
    );
    filas = rows;
  } catch (_) {
    // Tabla aún no migrada: se responde con el respaldo para no romper el agendado.
    filas = SERVICIOS_DEFECTO.map((nombre, i) => ({ id: null, nombre, activo: 1, orden: i + 1 }));
  }
  cache.set(db.tenantId, { filas, at: Date.now() });
  return filas;
}

// Solo los nombres activos: es lo que se ofrece al agendar y contra lo que se valida.
async function getServicios(db) {
  const filas = await getServiciosFilas(db);
  return filas.filter((s) => s.activo).map((s) => s.nombre);
}

// ¿Se puede agendar este servicio? Un servicio desactivado deja de ofrecerse, pero las
// citas viejas que lo usaron siguen mostrándose bien porque guardan el texto.
async function servicioValido(db, nombre) {
  const activos = await getServicios(db);
  return activos.includes(nombre);
}

function clearCache(tenantId) {
  if (tenantId == null) cache.clear();
  else cache.delete(tenantId);
}

module.exports = {
  SERVICIOS_DEFECTO, HORAS, MAX_POR_HORA,
  getServicios, getServiciosFilas, servicioValido, clearCache,
};
