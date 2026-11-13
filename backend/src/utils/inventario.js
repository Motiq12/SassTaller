// Movimientos de inventario. Toda entrada o salida pasa por moverExistencia: suma a
// la existencia de esa sucursal y deja el movimiento anotado con lo que quedó.
//
// La salida se hace al ENTREGAR la orden (utils/ordenes.js → cerrarOrden), no al
// agregar la pieza: hasta la entrega la pieza se puede quitar, rechazar o la orden
// cancelar, y devolver stock en cada uno de esos caminos sería fácil de olvidar. Mientras
// la orden está abierta, la pieza cuenta como "comprometida" (ver inventario.routes).

const MAX = { codigo: 60, nombre: 200, marca: 100, unidad: 20, proveedor: 150, documento: 60, nota: 300 };
const TOPE_CANTIDAD = 100000;
const TOPE_MONTO = 100000000;

// `conn` tiene que estar en una transacción: la existencia y el movimiento van juntos.
async function moverExistencia(conn, m) {
  const [[e]] = await conn.query(
    `INSERT INTO repuesto_existencias (tenant_id, repuesto_id, sucursal_id, cantidad)
     VALUES (@tenant, ?, ?, ?)
     ON CONFLICT (tenant_id, repuesto_id, sucursal_id)
     DO UPDATE SET cantidad = repuesto_existencias.cantidad + EXCLUDED.cantidad, updated_at = CURRENT_TIMESTAMP
     RETURNING cantidad`,
    [m.repuestoId, m.sucursalId, m.cantidad]
  );
  await conn.query(
    `INSERT INTO movimientos_inventario
       (tenant_id, repuesto_id, sucursal_id, tipo, cantidad, existencia_despues, costo_unitario, orden_id, orden_repuesto_id,
        proveedor, documento, nota, usuario_id)
     VALUES (@tenant, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [m.repuestoId, m.sucursalId, m.tipo, m.cantidad, e.cantidad, m.costoUnitario ?? null, m.ordenId ?? null,
      m.ordenRepuestoId ?? null, m.proveedor || null, m.documento || null, m.nota || null, m.usuarioId ?? null]
  );
  return e.cantidad;
}

// La sucursal de la que sale una orden: la suya, o la primera del taller si se abrió
// sin elegir sede (pasa con órdenes viejas).
async function sucursalDeOrden(conn, ordenId) {
  const [[o]] = await conn.query('SELECT sucursal_id FROM ordenes_trabajo WHERE id = ? AND tenant_id = @tenant', [ordenId]);
  if (o?.sucursal_id) return o.sucursal_id;
  const [[s]] = await conn.query('SELECT id FROM sucursales WHERE tenant_id = @tenant ORDER BY activa DESC, id LIMIT 1');
  return s?.id || null;
}

// Al entregar: descuenta las piezas del catálogo que el cliente aprobó. Una pieza que
// ya descontó (entrega reintentada) no vuelve a descontar.
async function descontarOrden(conn, ordenId, usuarioId) {
  const [piezas] = await conn.query(
    `SELECT p.id, p.repuesto_id, p.cantidad, p.costo_unitario
       FROM orden_repuestos p
      WHERE p.tenant_id = @tenant AND p.orden_id = ? AND p.repuesto_id IS NOT NULL AND p.rechazado = 0
        AND NOT EXISTS (SELECT 1 FROM movimientos_inventario m
                         WHERE m.tenant_id = @tenant AND m.orden_repuesto_id = p.id AND m.tipo = 'salida')`,
    [ordenId]
  );
  if (!piezas.length) return 0;
  const sucursalId = await sucursalDeOrden(conn, ordenId);
  if (!sucursalId) return 0;
  for (const p of piezas) {
    const cantidad = Math.max(1, Math.round(Number(p.cantidad) || 1));
    await moverExistencia(conn, {
      repuestoId: p.repuesto_id, sucursalId, tipo: 'salida', cantidad: -cantidad,
      costoUnitario: p.costo_unitario, ordenId, ordenRepuestoId: p.id, usuarioId,
    });
  }
  return piezas.length;
}

// El repuesto del catálogo que se quiere usar en una orden: tiene que ser de este taller
// y estar activo. Devuelve la fila, null si no vino, o false si no sirve.
async function repuestoDelCatalogo(db, id) {
  if (id === undefined || id === null || id === '') return null;
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) return false;
  const [[r]] = await db.query('SELECT id, nombre, precio FROM repuestos WHERE tenant_id = @tenant AND id = ? AND activo = 1', [n]);
  return r || false;
}

// Valida y limpia los datos de un repuesto del catálogo. Devuelve { datos } o { campo, error }.
function datosDeRepuesto(b = {}) {
  const texto = (v, max) => String(v ?? '').trim().slice(0, max);
  const nombre = texto(b.nombre, MAX.nombre + 1);
  if (!nombre) return { campo: 'nombre', error: 'Falta el nombre del repuesto' };
  if (nombre.length > MAX.nombre) return { campo: 'nombre', error: `El nombre no puede pasar de ${MAX.nombre} caracteres` };
  const codigo = texto(b.codigo, MAX.codigo + 1);
  if (codigo.length > MAX.codigo) return { campo: 'codigo', error: `El código no puede pasar de ${MAX.codigo} caracteres` };
  const monto = (v, campo, nombreCampo) => {
    if (v === undefined || v === null || v === '') return { valor: 0 };
    const x = Number(v);
    if (!Number.isFinite(x) || x < 0 || x > TOPE_MONTO) return { campo, error: `${nombreCampo} no es válido` };
    return { valor: Math.round(x * 100) / 100 };
  };
  const costo = monto(b.costo, 'costo', 'El costo');
  if (costo.error) return costo;
  const precio = monto(b.precio, 'precio', 'El precio');
  if (precio.error) return precio;
  const minimo = b.minimo === undefined || b.minimo === null || b.minimo === '' ? 0 : Number(b.minimo);
  if (!Number.isInteger(minimo) || minimo < 0 || minimo > TOPE_CANTIDAD) return { campo: 'minimo', error: 'El mínimo tiene que ser un número entero' };
  return {
    datos: {
      codigo: codigo || null, nombre, marca: texto(b.marca, MAX.marca) || null,
      unidad: texto(b.unidad, MAX.unidad) || 'unidad', costo: costo.valor, precio: precio.valor, minimo,
    },
  };
}

// Cantidad entera y positiva (entradas) o mayor o igual a cero (conteos).
function cantidadValida(v, { permitirCero = false } = {}) {
  const n = Number(v);
  return Number.isInteger(n) && n <= TOPE_CANTIDAD && (permitirCero ? n >= 0 : n > 0);
}

module.exports = { moverExistencia, descontarOrden, sucursalDeOrden, repuestoDelCatalogo, datosDeRepuesto, cantidadValida, MAX };
