// Resuelve el taller en rutas PÚBLICAS del portal (registro, login, recuperar
// contraseña, OTP). Ahí todavía no hay token, así que el taller no puede salir del
// JWT: se toma del subdominio con el que entró el cliente (msmotors.tuapp.com) o,
// como alternativa explícita, de un campo `taller` con el slug.
//
// Sin esto, un registro público no sabría a qué taller pertenece el cliente nuevo.
const jwt = require('jsonwebtoken');
const { pool } = require('../db/pool');
const { paraTenant } = require('../db/tenant-db');

// Subdominios que no identifican a un taller (infraestructura).
const NO_SON_TALLER = new Set(['www', 'localhost', 'api', 'app']);
// Dominios del hosting: su primera parte es un identificador de Railway, no un taller.
const DOMINIOS_DE_PLATAFORMA = ['.railway.app'];

// El slug del taller que trae el host, o null si el host no es de un taller.
//
// Un subdominio de taller tiene al menos TRES partes (msmotors.motiq12.com). Antes
// bastaba con que hubiera un punto, así que el dominio del producto, motiq12.com,
// se leía como el taller "motiq12": cada visita a la landing pedía la marca de un
// taller inexistente y mostraba "Taller no encontrado o inactivo". La misma regla
// vive en el frontend (services/taller.service.ts): si cambia acá, cambia allá.
function slugDelHost(hostname) {
  const host = String(hostname || '').toLowerCase();
  if (!host || /^[\d.]+$/.test(host) || host.includes(':')) return null;   // IPv4 / IPv6
  if (DOMINIOS_DE_PLATAFORMA.some((d) => host.endsWith(d))) return null;
  const partes = host.split('.');
  if (partes.length < 3) return null;   // localhost, motiq12.com
  return NO_SON_TALLER.has(partes[0]) ? null : partes[0];
}

module.exports = async function tenantPublico(req, res, next) {
  try {
    const slug = String(req.body?.taller || req.query?.taller || slugDelHost(req.hostname) || '').trim().toLowerCase();

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
module.exports.slugDelHost = slugDelHost;
