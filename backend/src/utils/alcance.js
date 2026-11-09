// Qué sucursal ve cada empleado.
//
// Cada empleado tiene una sucursal (usuarios.sucursal_id) o ninguna, que quiere
// decir "las dos". Quien tiene una ve solo lo de ella: las citas, las órdenes, sus
// alertas y sus mecánicos. Lo que no tiene sucursal (algo viejo, o una orden abierta
// sin elegir sede) lo ven todos, para que no quede perdido. El administrador ve todo,
// siempre.
//
// Los clientes y sus motos se comparten entre sucursales (un cliente puede ir a
// cualquiera de las dos); lo que se filtra son sus citas y órdenes.
//
// La sucursal se lee de la base en cada petición, no del token: si el administrador
// cambia a alguien de sucursal, vale en ese mismo momento.
const { pool } = require('../db/pool');

async function sucursalDeAlcance(req) {
  if (req._alcanceLeido) return req.sucursalAlcance;
  let sucursal = null;
  if (req.usuario && req.usuario.rol !== 'admin') {
    const [[u]] = await pool.query('SELECT sucursal_id FROM usuarios WHERE id = ?', [req.usuario.id]);
    const n = Number(u?.sucursal_id);
    sucursal = Number.isInteger(n) && n > 0 ? n : null;
  }
  req._alcanceLeido = true;
  req.sucursalAlcance = sucursal;
  return sucursal;
}

// Middleware: deja la sucursal en req.sucursalAlcance (null = todas).
function cargarAlcance(req, res, next) {
  sucursalDeAlcance(req).then(() => next()).catch(next);
}

// Condición para agregar a un WHERE: ' AND (col = 2 OR col IS NULL)', o nada para
// quien ve todas. El número sale de la base y pasa por Number: no hay texto del
// usuario en el SQL.
function soloSucursal(req, columna) {
  const s = req.sucursalAlcance;
  return s ? ` AND (${columna} = ${Number(s)} OR ${columna} IS NULL)` : '';
}

// La sucursal con la que se guarda algo nuevo: la del empleado si tiene una (no
// puede crear cosas en la otra), o la que eligió si ve las dos.
function sucursalParaGuardar(req, pedida) {
  return req.sucursalAlcance || pedida;
}

// Middleware para rutas con :id de algo que es de una sucursal. `sql` devuelve la
// sucursal de ese registro (con un solo ? para el id). Si es de la otra sucursal,
// responde 404, igual que si no existiera: no se le confirma a nadie que existe.
function delTaller(tabla) {
  return async (req, res, next, id) => {
    try {
      const [[fila]] = await req.db.query(`SELECT id FROM ${tabla} WHERE id = ? AND tenant_id = @tenant`, [id]);
      if (!fila) return res.status(404).json({ error: 'No encontrado' });
      next();
    } catch (err) {
      next(err);
    }
  };
}

function exigirSucursal(sql, param = 'id') {
  return async (req, res, next) => {
    try {
      const s = await sucursalDeAlcance(req);
      if (!s) return next();
      const [[fila]] = await pool.query(sql, [req.params[param]]);
      if (fila && fila.sucursal_id !== null && Number(fila.sucursal_id) !== s) {
        return res.status(404).json({ error: 'No encontrado' });
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

const SUCURSAL_DE_ORDEN = 'SELECT sucursal_id FROM ordenes_trabajo WHERE id = ?';
const SUCURSAL_DE_CITA = 'SELECT sucursal_id FROM citas WHERE id = ?';
const SUCURSAL_DE_GARANTIA = 'SELECT o.sucursal_id FROM garantias g JOIN ordenes_trabajo o ON o.id = g.orden_id WHERE g.id = ?';

module.exports = {
  sucursalDeAlcance, cargarAlcance, soloSucursal, sucursalParaGuardar, exigirSucursal, delTaller,
  SUCURSAL_DE_ORDEN, SUCURSAL_DE_CITA, SUCURSAL_DE_GARANTIA,
};
