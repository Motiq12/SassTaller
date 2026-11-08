// Cupo por franja horaria: que dos reservas simultáneas no tomen la misma última plaza.
//
// Serializa las reservas de UNA franja (taller + sucursal + fecha + hora) hasta el fin
// de la transacción en curso. Sin esto dos clientes podían contar "queda un lugar" a
// la vez y entrar los dos.
//
// En MySQL se hacía con `SELECT COUNT(*) … FOR UPDATE`. Postgres no permite FOR UPDATE
// con un agregado, y además bloquear las filas que ya existen no frena a una fila NUEVA
// que compite por el mismo cupo (el problema real). Un candado consultivo sí: el segundo
// espera al primero, y franjas distintas no se estorban entre sí.
//
// Uso: dentro de una transacción (conn = await req.db.conexion(); beginTransaction),
// ANTES de contar las citas de la franja. El candado se suelta solo con el COMMIT o el
// ROLLBACK. test/pg-cupos.test.js lo prueba con dos transacciones que se pisan.
async function bloquearFranja(conn, sucursalId, fecha, hora) {
  const clave = `cupo:${conn.tenantId}:${sucursalId}:${fecha}:${String(hora).slice(0, 5)}`;
  await conn.query('SELECT pg_advisory_xact_lock(hashtext(?))', [clave]);
}

module.exports = { bloquearFranja };
