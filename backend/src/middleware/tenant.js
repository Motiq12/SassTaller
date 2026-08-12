// Fija el tenant del request a partir del token ya verificado y expone `req.db`,
// un cliente de base que solo puede ver ese taller.
//
// Va SIEMPRE después de middleware/auth (o auth-cliente): necesita req.usuario /
// req.cliente ya resueltos. Si el token no trae tenant, corta acá: es preferible un
// 401 a servir una consulta sin scope.
const { paraTenant } = require('../db/tenant-db');
const { estadoDe } = require('../utils/estado-tenant');

module.exports = function tenantMiddleware(req, res, next) {
  const tenantId = Number(req.usuario?.tenant_id ?? req.cliente?.tenant_id);

  if (!Number.isInteger(tenantId) || tenantId <= 0) {
    // Token viejo (emitido antes de multi-tenant) o manipulado. Que reinicie sesión.
    return res.status(401).json({ error: 'Sesión sin taller asociado. Iniciá sesión de nuevo.' });
  }

  // Un taller suspendido deja de trabajar YA, no cuando le venza el token. Se
  // comprueba acá y no solo en el login porque la sesión dura 8 horas: si únicamente
  // se mirara al entrar, suspender a alguien no tendría efecto hasta el día siguiente.
  // Es una lectura de memoria (ver utils/estado-tenant), no una consulta.
  const estado = estadoDe(tenantId);
  if (estado !== 'activo') {
    return res.status(403).json({
      error: estado === 'suspendido'
        ? 'La cuenta del taller está suspendida. Contactá a soporte.'
        : 'La cuenta del taller ya no está activa.',
      estado,
    });
  }

  req.tenantId = tenantId;
  req.db = paraTenant(tenantId);
  next();
};
