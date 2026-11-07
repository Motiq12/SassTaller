// Que el servidor respete las casillas de cada rol (utils/permisos.js).
//
// Los permisos se leen de la base en cada petición, no del token: si el
// administrador le cambia el rol a alguien o le quita una casilla a un rol, vale en
// ese mismo momento, sin que la persona tenga que volver a entrar.
//
// Se agrega a una ruta DESPUÉS de auth y de requireRol/soloRoles: esos siguen
// diciendo quién puede entrar a la ruta; esto solo puede quitar.
const { pool } = require('../db/pool');
const { permisosEfectivos, puede, NOMBRE_PERMISO, BASE_DE_ROL, ajustables } = require('../utils/permisos');

// { rol, permisos, ajustables, rolId, rolNombre } del usuario de la petición.
async function permisosDeUsuario(usuarioId) {
  const [[u]] = await pool.query('SELECT rol, rol_id FROM usuarios WHERE id = ?', [usuarioId]);
  if (!u) return { rol: null, permisos: [], ajustables: [], rolId: null, rolNombre: null };
  // El rol propio (si tiene) y el de fábrica de su rol del sistema, en una consulta.
  // La clave va como parámetro: no se compara columna con columna (ver la collation
  // de roles en auto-migrate.js).
  const [filas] = await pool.query(
    'SELECT id, clave, nombre, base, permisos FROM roles WHERE id = ? OR clave = ?',
    [u.rol_id || 0, u.rol]
  );
  const leer = (f) => {
    if (!f) return null;
    let permisos = [];
    try { permisos = JSON.parse(f.permisos || '[]'); } catch { permisos = []; }
    return { id: f.id, nombre: f.nombre, base: f.base, permisos };
  };
  const base = BASE_DE_ROL[u.rol];
  const propio = leer(filas.find((f) => u.rol_id && f.id === u.rol_id && f.base === base));
  const deFabrica = leer(filas.find((f) => f.clave === u.rol));
  const asignado = propio || deFabrica;
  return {
    rol: u.rol,
    permisos: permisosEfectivos(u.rol, asignado),
    ajustables: u.rol === 'admin' ? [] : ajustables(base),
    rolId: propio ? propio.id : null,
    rolNombre: asignado ? asignado.nombre : null,
  };
}

async function permisosDe(req) {
  if (!req._permisos) req._permisos = await permisosDeUsuario(req.usuario.id);
  return req._permisos;
}

// exigirPermiso('ordenes.entregar'), o una función que lo elige según la petición
// (por ejemplo, cancelar una cita pide otra casilla que reprogramarla).
function exigirPermiso(permiso) {
  return async (req, res, next) => {
    try {
      const id = typeof permiso === 'function' ? permiso(req) : permiso;
      if (!id) return next();
      const p = await permisosDe(req);
      if (puede(p.rol, p.permisos, id)) return next();
      return res.status(403).json({
        error: `Tu rol no tiene permiso para: ${(NOMBRE_PERMISO[id] || id).toLowerCase()}. Lo cambia administración en Equipo → Roles.`,
        codigo: 'sin_permiso',
        permiso: id,
      });
    } catch (err) {
      next(err);
    }
  };
}

module.exports = { exigirPermiso, permisosDe, permisosDeUsuario };
