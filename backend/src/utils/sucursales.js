// Sucursales (locales del taller). Centraliza el acceso a la tabla `sucursales` con
// una caché en memoria, porque el portal la consulta seguido (selector + validación
// de reservas). Se invalida al guardar desde el panel admin (clearCache).
const { pool } = require('../db/pool');

let cache = null;        // array de sucursales (todas, activas e inactivas)
let cacheAt = 0;
const TTL_MS = 30 * 1000;

// Lee todas las sucursales (con caché). `soloActivas` filtra a las habilitadas.
async function getSucursales({ soloActivas = false } = {}) {
  if (!cache || Date.now() - cacheAt >= TTL_MS) {
    try {
      const [rows] = await pool.query(
        'SELECT id, nombre, direccion, telefono, activa, orden FROM sucursales ORDER BY orden, id'
      );
      cache = rows;
      cacheAt = Date.now();
    } catch (_) {
      // Tabla aún no migrada: devolvé vacío sin romper (el portal cae a su default).
      return [];
    }
  }
  return soloActivas ? cache.filter((s) => Number(s.activa) === 1) : cache;
}

function clearCache() {
  cache = null;
  cacheAt = 0;
}

// ¿El id corresponde a una sucursal activa? (validación de reservas del portal).
async function sucursalValida(id) {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) return false;
  const activas = await getSucursales({ soloActivas: true });
  return activas.some((s) => Number(s.id) === n);
}

// Primera sucursal activa (default seguro cuando no se especifica una). null si no hay.
async function sucursalPorDefecto() {
  const activas = await getSucursales({ soloActivas: true });
  return activas.length ? Number(activas[0].id) : null;
}

// ¿El técnico puede atender en esta sucursal? Permisivo: verdadero si no hay técnico,
// si la cita/orden no tiene sucursal, o si el técnico es de esa sede o de "ambas" (NULL).
// Solo rechaza cuando el técnico pertenece a OTRA sede concreta.
async function tecnicoEnSucursal(tecnicoId, sucursalId) {
  if (!tecnicoId || !sucursalId) return true;
  const [[t]] = await pool.query(
    "SELECT sucursal_id FROM usuarios WHERE id = ? AND rol = 'tecnico' AND activo = 1",
    [tecnicoId]
  );
  if (!t) return false;
  return t.sucursal_id == null || Number(t.sucursal_id) === Number(sucursalId);
}

module.exports = { getSucursales, clearCache, sucursalValida, sucursalPorDefecto, tecnicoEnSucursal };
