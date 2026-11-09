// Resuelve el taller en rutas PÚBLICAS del portal (registro, login, recuperar
// contraseña, OTP). Ahí todavía no hay token, así que el taller no puede salir del
// JWT: se toma del subdominio con el que entró el cliente (msmotors.tuapp.com) o,
// como alternativa explícita, de un campo `taller` con el slug.
//
// Sin esto, un registro público no sabría a qué taller pertenece el cliente nuevo.
const jwt = require('jsonwebtoken');
const { pool } = require('../db/pool');
const { paraTenant } = require('../db/tenant-db');

// Subdominios que no identifican a un taller (entorno local, apex, www).
const NO_SON_TALLER = new Set(['www', 'localhost', 'api', 'app', '127', '0']);

function slugDelHost(req) {
  const host = String(req.hostname || '').toLowerCase();
  if (!host || !host.includes('.')) return null;   // 'localhost' y equivalentes
  const primero = host.split('.')[0];
  return NO_SON_TALLER.has(primero) ? null : primero;
}

module.exports = async function tenantPublico(req, res, next) {
  try {
    const slug = String(req.body?.taller || req.query?.taller || slugDelHost(req) || '').trim().toLowerCase();

    if (!slug) {
      // Si viene un Bearer, la ruta es de las autenticadas y el taller sale del
      // token: se deja pasar para que auth-cliente lo resuelva. Este middleware
      // cubre solo el tramo público, donde no hay de dónde sacarlo.
      const bearer = /^Bearer\s+(.+)$/i.exec(String(req.headers.authorization || ''));
      if (bearer) {
        try {
          const { tenant_id: id } = jwt.verify(bearer[1], process.env.JWT_SECRET);
          if (id) { req.tenantId = id; req.db = paraTenant(id); }
        } catch { /* token malo: lo rechaza el middleware de sesión de la ruta */ }
        return next();
      }
      return res.status(400).json({ error: 'Falta indicar el taller' });
    }

    const [[tenant]] = await pool.query(
      "SELECT id FROM tenants WHERE slug = ? AND estado = 'activo'",
      [slug]
    );
    if (!tenant) return res.status(404).json({ error: 'Taller no encontrado o inactivo' });

    req.tenantId = tenant.id;
    // El slug queda a mano: los correos lo necesitan para armar la URL del logo,
    // que es publica y por lo tanto tiene que decir de que taller es.
    req.tallerSlug = slug;
    req.db = paraTenant(tenant.id);
    next();
  } catch (err) {
    next(err);
  }
};
