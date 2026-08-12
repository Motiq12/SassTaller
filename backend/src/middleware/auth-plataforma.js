const jwt = require('jsonwebtoken');

/**
 * Sesión de un administrador de MOTIQ (la plataforma), no de un taller.
 *
 * Hay tres tipos de sesión en el sistema y ninguna debe servir en el terreno de
 * las otras:
 *
 *   staff       → personal de un taller  (middleware/auth)
 *   cliente     → cliente de un taller   (middleware/auth-cliente)
 *   plataforma  → dueño de Motiq         (este)
 *
 * Un token de plataforma NO lleva `tenant_id` a propósito: quien administra Motiq
 * no pertenece a ningún taller, y darle uno lo convertiría en un usuario del
 * taller 1 con permisos de admin. Como consecuencia `req.db` no existe acá — las
 * rutas de plataforma consultan sin scope, que es correcto porque su trabajo es
 * justamente mirar a través de todos los talleres.
 */
module.exports = function authPlataforma(req, res, next) {
  const header = req.headers['authorization'];
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token requerido' });
  }
  try {
    const payload = jwt.verify(header.slice(7), process.env.JWT_SECRET);
    // Se exige el tipo explícito. Sin este chequeo, el token de un admin de
    // cualquier taller entraría al panel de Motiq y vería a toda la competencia.
    if (payload.tipo !== 'plataforma' || !payload.id) {
      return res.status(403).json({ error: 'Esta sección es de administración de Motiq' });
    }
    req.plataforma = payload;
    next();
  } catch {
    return res.status(401).json({ error: 'Token inválido o expirado' });
  }
};
