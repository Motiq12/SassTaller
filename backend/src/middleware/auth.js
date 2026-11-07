const jwt = require('jsonwebtoken');
const { estadoDeSesion, sesionVigente, sidAbierto } = require('../utils/sesiones');

// Lo único que puede pedir el rol `contenido`: la administración del sitio web,
// su sesión (/auth/me, verificación en dos pasos) y la marca del taller (logo y
// colores del panel).
// Se compara por segmento completo: '/api/web' deja pasar '/api/web/motos' pero
// no '/api/webhooks'.
const RUTAS_CONTENIDO = ['/api/web', '/api/auth', '/api/marca'];
function rutaDeContenido(url) {
  const ruta = String(url || '').split('?')[0];
  return RUTAS_CONTENIDO.some((p) => ruta === p || ruta.startsWith(p + '/'));
}

module.exports = function authMiddleware(req, res, next) {
  const header = req.headers['authorization'];
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token requerido' });
  }
  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    // El token debe ser de PERSONAL: los del portal de clientes se firman con el
    // mismo secreto pero llevan tipo:'cliente' y no tienen rol. Sin este chequeo,
    // un cliente autenticado podría usar su token en las rutas de staff.
    if (payload.tipo === 'cliente' || !payload.rol) {
      return res.status(403).json({ error: 'Token no válido para esta sección' });
    }
    // Token parcial de 2FA (contraseña correcta pero falta el segundo factor): solo
    // vale para canjearlo en /auth/2fa/verificar, nunca como sesión. Hoy además no
    // lleva `rol` (ya lo cortaría el chequeo de arriba); esto lo deja explícito para
    // que siga bloqueado aunque el payload cambie más adelante.
    if (payload.pend2fa) {
      return res.status(403).json({ error: 'Falta completar la verificación en dos pasos' });
    }
    // El rol `contenido` (quien solo administra el sitio web) no ve nada del taller.
    // Se corta aquí, por lista blanca, y no ruta por ruta: así una ruta nueva que se
    // proteja solo con `auth` (como /api/motos, que trae datos de clientes) no le
    // queda abierta por olvido.
    if (payload.rol === 'contenido' && !rutaDeContenido(req.originalUrl)) {
      return res.status(403).json({ error: 'No tienes permisos para esta sección' });
    }
    req.usuario = payload;
  } catch {
    return res.status(401).json({ error: 'Token inválido o expirado' });
  }
  // La firma es buena; falta saber si esa sesión sigue abierta: si administración la
  // cerró, o si la persona está desactivada, el token deja de valer aunque no venza
  // (utils/sesiones.js). Si la base no responde, vale la firma.
  // Y si el token es de una sesión con dispositivo (lleva `sid`), que esa no se haya
  // cerrado desde Mi perfil.
  const cerrada = () => res.status(401).json({ error: 'Tu sesión se cerró. Volvé a iniciar sesión.', codigo: 'sesion_cerrada' });
  return estadoDeSesion(req.usuario.id).then(async (estado) => {
    if (estado !== undefined && !sesionVigente(req.usuario, estado)) return cerrada();
    if (req.usuario.sid && (await sidAbierto(req.usuario.sid)) === false) return cerrada();
    next();
  });
};
