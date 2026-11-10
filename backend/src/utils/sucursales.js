// Sucursales (locales del taller). Centraliza el acceso a la tabla `sucursales` con
// una caché en memoria, porque el portal la consulta seguido (selector + validación
// de reservas). Se invalida al guardar desde el panel admin (clearCache).
// Caché POR TALLER: cada taller tiene sus propias sedes, y una caché global le
// mostraría al taller B el selector de sucursales del taller A.
const cache = new Map(); // tenantId -> { filas, at }
const TTL_MS = 30 * 1000;

// Lee todas las sucursales del taller (con caché). `soloActivas` filtra a las habilitadas.
async function getSucursales(db, { soloActivas = false } = {}) {
  if (!db || !db.tenantId) throw new Error('getSucursales: falta el db scopeado (req.db)');
  let guardado = cache.get(db.tenantId);
  if (!guardado || Date.now() - guardado.at >= TTL_MS) {
    try {
      const [rows] = await db.query(
        `SELECT id, nombre, direccion, telefono, provincia, canton, activa, orden FROM sucursales
         WHERE tenant_id = @tenant ORDER BY orden, id`
      );
      guardado = { filas: rows, at: Date.now() };
      cache.set(db.tenantId, guardado);
    } catch (_) {
      // Tabla aún no migrada: devolvé vacío sin romper (el portal cae a su default).
      return [];
    }
  }
  return soloActivas ? guardado.filas.filter((s) => Number(s.activa) === 1) : guardado.filas;
}

function clearCache(tenantId) {
  if (tenantId == null) cache.clear();
  else cache.delete(tenantId);
}

// ¿El id corresponde a una sucursal activa DE ESTE TALLER? (validación de reservas
// del portal). Al ir contra la caché por taller, mandar el id de una sede ajena
// devuelve false, que es lo que corresponde.
async function sucursalValida(db, id) {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) return false;
  const activas = await getSucursales(db, { soloActivas: true });
  return activas.some((s) => Number(s.id) === n);
}

// Primera sucursal activa (default seguro cuando no se especifica una). null si no hay.
async function sucursalPorDefecto(db) {
  const activas = await getSucursales(db, { soloActivas: true });
  return activas.length ? Number(activas[0].id) : null;
}

// ¿El técnico puede atender en esta sucursal? Permisivo: verdadero si no hay técnico,
// si la cita/orden no tiene sucursal, o si el técnico es de esa sede o de "ambas" (NULL).
// Solo rechaza cuando el técnico pertenece a OTRA sede concreta.
async function tecnicoEnSucursal(db, tecnicoId, sucursalId) {
  if (!tecnicoId || !sucursalId) return true;
  const [[t]] = await db.query(
    "SELECT sucursal_id FROM usuarios WHERE id = ? AND rol = 'tecnico' AND activo = 1 AND tenant_id = @tenant",
    [tecnicoId]
  );
  if (!t) return false;
  return t.sucursal_id == null || Number(t.sucursal_id) === Number(sucursalId);
}

module.exports = { getSucursales, clearCache, sucursalValida, sucursalPorDefecto, tecnicoEnSucursal };
