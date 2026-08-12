// Fija el tenant del request a partir del token ya verificado y expone `req.db`,
// un cliente de base que solo puede ver ese taller.
//
// Va SIEMPRE después de middleware/auth (o auth-cliente): necesita req.usuario /
// req.cliente ya resueltos. Si el token no trae tenant, corta acá: es preferible un
// 401 a servir una consulta sin scope.
const { paraTenant } = require('../db/tenant-db');

module.exports = function tenantMiddleware(req, res, next) {
  const tenantId = Number(req.usuario?.tenant_id ?? req.cliente?.tenant_id);

  if (!Number.isInteger(tenantId) || tenantId <= 0) {
    // Token viejo (emitido antes de multi-tenant) o manipulado. Que reinicie sesión.
    return res.status(401).json({ error: 'Sesión sin taller asociado. Iniciá sesión de nuevo.' });
  }

  req.tenantId = tenantId;
  req.db = paraTenant(tenantId);
  next();
};
