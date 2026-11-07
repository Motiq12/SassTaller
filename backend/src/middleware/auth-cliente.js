const jwt = require('jsonwebtoken');

// Valida el token del portal del cliente. El payload debe tener tipo: 'cliente'
// para que un token de personal no sirva en el portal y viceversa.
module.exports = function authCliente(req, res, next) {
  const header = req.headers['authorization'];
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token requerido' });
  }
  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    if (payload.tipo !== 'cliente') {
      return res.status(401).json({ error: 'Token no válido para el portal' });
    }
    req.cliente = payload;
    next();
  } catch {
    return res.status(401).json({ error: 'Token inválido o expirado' });
  }
};
