const jwt = require('jsonwebtoken');
const { pool } = require('../db/pool');

// ¿La cuenta sigue activa? Sin esto, alguien a quien se le quitó el acceso seguía
// entrando hasta que le venciera el token (8 horas), con los datos de todos los talleres.
// Se guarda 10 s para no ir a la base en cada pedido.
const TTL_MS = 10 * 1000;
const cache = new Map();
async function cuentaActiva(id) {
  const g = cache.get(Number(id));
  if (g && Date.now() - g.t < TTL_MS) return g.activa;
  try {
    const [[a]] = await pool.query('SELECT activo FROM plataforma_admins WHERE id = ?', [id]);
    const activa = !!a && Number(a.activo) === 1;
    cache.set(Number(id), { activa, t: Date.now() });
    return activa;
  } catch (err) {
    console.error('⚠️  No se pudo revisar la cuenta de plataforma:', err.code || err.message);
    return true; // la firma ya se verificó
  }
}

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
    const payload = jwt.verify(header.slice(7), process.env.JWT_SECRET, { algorithms: ['HS256'] });
    // Se exige el tipo explícito. Sin este chequeo, el token de un admin de
    // cualquier taller entraría al panel de Motiq y vería a toda la competencia.
    if (payload.tipo !== 'plataforma' || !payload.id) {
      return res.status(403).json({ error: 'Esta sección es de administración de Motiq' });
    }
    req.plataforma = payload;
    return cuentaActiva(payload.id).then((activa) => {
      if (!activa) return res.status(401).json({ error: 'Esta cuenta ya no tiene acceso' });
      next();
    });
  } catch {
    return res.status(401).json({ error: 'Token inválido o expirado' });
  }
};
// Tras activar o desactivar una cuenta: que rija en el próximo pedido.
module.exports.olvidar = (id) => cache.delete(Number(id));
