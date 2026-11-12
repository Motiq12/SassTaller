// Que cada id que llega en el CUERPO de un pedido sea de este taller.
//
// Los ids de la URL ya los cuida router.param (utils/alcance.js). Los del cuerpo no:
// las claves foráneas de la base apuntan al id global, sin mirar el tenant, así que un
// cliente_id de otro taller pasaba sin error. La empresa B podía crear una cita o una
// orden con un cliente, un vehículo o un mecánico de A, o mandarle mensajes a su
// personal, con solo escribir el número a mano.
//
// Uso: const ajena = await referenciaAjena(req.db, { cliente_id, vehiculo_id });
//      if (ajena) return invalido(res, ajena.campo, ajena.error);
// Un campo vacío no se revisa: la obligatoriedad la decide cada ruta.

const vacio = (v) => v === undefined || v === null || v === '';

// Cada revisión: [campo, consulta que devuelve una fila si el id sirve, mensaje].
const REVISIONES = [
  ['cliente_id', 'SELECT id FROM clientes WHERE tenant_id = @tenant AND id = ? AND activo = 1', 'El cliente no existe en este taller'],
  ['tecnico_id', "SELECT id FROM usuarios WHERE tenant_id = @tenant AND id = ? AND rol = 'tecnico' AND activo = 1", 'El mecánico no existe o está inactivo'],
  ['destino_id', 'SELECT id FROM usuarios WHERE tenant_id = @tenant AND id = ? AND activo = 1', 'Esa persona no es de este taller'],
  ['orden_id', 'SELECT id FROM ordenes_trabajo WHERE tenant_id = @tenant AND id = ?', 'La orden no existe en este taller'],
  ['cita_id', 'SELECT id FROM citas WHERE tenant_id = @tenant AND id = ?', 'La cita no existe en este taller'],
];

async function referenciaAjena(db, ids = {}) {
  for (const [campo, sql, error] of REVISIONES) {
    const valor = ids[campo];
    if (vacio(valor)) continue;
    if (!Number.isInteger(Number(valor)) || Number(valor) <= 0) return { campo, error };
    const [[fila]] = await db.query(sql, [Number(valor)]);
    if (!fila) return { campo, error };
  }
  // El vehículo, además de ser del taller, tiene que ser del cliente de la orden o cita.
  if (!vacio(ids.vehiculo_id)) {
    const error = 'El vehículo no es de este cliente';
    if (!Number.isInteger(Number(ids.vehiculo_id)) || Number(ids.vehiculo_id) <= 0) return { campo: 'vehiculo_id', error };
    const [[v]] = await db.query('SELECT cliente_id FROM vehiculos WHERE tenant_id = @tenant AND id = ?', [Number(ids.vehiculo_id)]);
    if (!v) return { campo: 'vehiculo_id', error: 'El vehículo no existe en este taller' };
    if (!vacio(ids.cliente_id) && Number(v.cliente_id) !== Number(ids.cliente_id)) return { campo: 'vehiculo_id', error };
  }
  return null;
}

module.exports = { referenciaAjena };
