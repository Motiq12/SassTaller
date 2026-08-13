// Registro de lo que hace cada administrador de Motiq.
//
// Sirve para dos cosas a la vez, y la segunda es la que importa:
//
//  1. Cada uno ve su propia actividad reciente en su espacio de trabajo, que es lo
//     que convierte una pantalla compartida en "la mía".
//  2. Queda constancia de quién suspendió o borró un taller. Son acciones que dejan
//     a un cliente sin poder trabajar, y hasta ahora solo quedaban en la consola del
//     servidor — o sea, se perdían en el próximo reinicio.
//
// Se guarda el correo además del id: si mañana se borra o se renombra una cuenta,
// las líneas viejas tienen que seguir diciendo quién fue.
const { pool } = require('../db/pool');

async function anotar(admin, accion, { tenantId = null, slug = null, detalle = null } = {}) {
  try {
    await pool.query(
      `INSERT INTO motiq_bitacora (admin_id, admin_email, accion, tenant_id, tenant_slug, detalle)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [admin?.id || null, admin?.email || null, accion, tenantId, slug, detalle ? String(detalle).slice(0, 300) : null]
    );
  } catch (err) {
    // Anotar nunca puede tumbar la acción que se está anotando: si la bitácora falla,
    // suspender un taller tiene que suspenderlo igual. Se avisa y se sigue.
    console.warn('⚠️  No se pudo anotar en la bitácora:', err.message);
  }
}

module.exports = { anotar };
