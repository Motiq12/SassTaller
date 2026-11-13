const jwt = require('jsonwebtoken');
const { sesionVigente } = require('../utils/sesiones-plataforma');

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
 *
 * B-06: la firma no alcanza. Cada pedido comprueba en la base que la sesión (`sid`)
 * siga abierta, que la cuenta siga activa y con segundo factor, y que la versión de
 * credenciales sea la de ahora. Sin caché: desactivar a alguien o cambiar la
 * contraseña corta su acceso en el pedido siguiente, en todos los workers. Si la base
 * no responde, se falla cerrado.
 */
module.exports = function authPlataforma(req, res, next) {
  const header = req.headers['authorization'];
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token requerido' });
  }
  let payload;
  try {
    payload = jwt.verify(header.slice(7), process.env.JWT_SECRET, { algorithms: ['HS256'] });
  } catch {
    return res.status(401).json({ error: 'Token inválido o expirado' });
  }
  // Se exige el tipo explícito. Sin este chequeo, el token de un admin de
  // cualquier taller entraría al panel de Motiq y vería a toda la competencia.
  // El token parcial del login (tipo 'plataforma_2fa') tampoco pasa.
  if (payload.tipo !== 'plataforma' || !payload.id) {
    return res.status(403).json({ error: 'Esta sección es de administración de Motiq' });
  }
  const cerrada = () => res.status(401).json({ error: 'Tu sesión se cerró. Volvé a iniciar sesión.', codigo: 'sesion_cerrada' });
  // Un token sin sid es del formato de antes de B-06: no se puede revocar, no vale.
  if (typeof payload.sid !== 'string' || !payload.sid) return cerrada();
  return sesionVigente(payload.id, payload.sid).then((vale) => {
    if (vale === undefined) {
      return res.status(503).json({ error: 'No se pudo comprobar la sesión. Intentá de nuevo.', codigo: 'sesion_no_disponible' });
    }
    if (!vale) return cerrada();
    req.plataforma = payload;
    next();
  });
};
// Compatibilidad: ya no hay caché que olvidar (cada pedido consulta la base).
module.exports.olvidar = () => {};
