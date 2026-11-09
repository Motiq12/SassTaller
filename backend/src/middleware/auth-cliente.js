const jwt = require('jsonwebtoken');
const tenant = require('./tenant');

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
    // Mismo criterio que middleware/auth: el scope por taller se encadena acá y sale
    // SIEMPRE del token, no de la URL. Sin esto req.db queda sin definir o, peor, lo
    // decide un ?taller= que cualquiera puede cambiar.
    return tenant(req, res, next);
  } catch {
    return res.status(401).json({ error: 'Token inválido o expirado' });
  }
};
