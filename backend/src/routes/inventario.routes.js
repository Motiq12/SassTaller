// Inventario de repuestos: catálogo, existencias por sucursal y movimientos.
//
// Lo ve quien puede ver precios (ordenes.precios) y lo cambia quien puede editar costos
// y repuestos (ordenes.costos): hoy administración y recepción. El mecánico no, porque
// no ve precios. Quien tiene una sucursal ve y mueve solo la suya.
const router = require('express').Router();
const auth = require('../middleware/auth');
const { soloRoles } = require('../middleware/roles');
const { exigirPermiso } = require('../middleware/permisos');
const { cargarAlcance, sucursalParaGuardar } = require('../utils/alcance');
const { fail, invalido } = require('../utils/responder');
const { sucursalValida } = require('../utils/sucursales');
const { moverExistencia, datosDeRepuesto, cantidadValida, MAX } = require('../utils/inventario');

router.use(auth, soloRoles('recepcion', 'admin'), exigirPermiso('ordenes.precios'), cargarAlcance);
const puedeEditar = exigirPermiso('ordenes.costos');

// La sucursal sobre la que se mira o se mueve: la del empleado si tiene una; si no,
// la pedida (que tiene que ser del taller). null = todas (solo para mirar).
async function sucursalPedida(req, valor) {
  const pedida = valor === undefined || valor === null || valor === '' ? null : Number(valor);
  if (pedida !== null && !(await sucursalValida(req.db, pedida))) return { error: true };
  return { id: sucursalParaGuardar(req, pedida) };
}

// La sucursal de la que va a salir una orden, igual que en utils/inventario.js
// (sucursalDeOrden): la suya, o la primera del taller si se abrió sin elegir sede.
const SEDE_DE_ORDEN = `COALESCE(o.sucursal_id, (SELECT sx.id FROM sucursales sx WHERE sx.tenant_id = @tenant
                                                  ORDER BY sx.activa DESC, sx.id LIMIT 1))`;

const escaparLike =(s) => String(s).replace(/[\\%_]/g, (c) => `\\${c}`);

// GET /api/inventario?q=&sucursal_id=&bajo=1&inactivos=1
router.get('/', async (req, res) => {
  try {
    const s = await sucursalPedida(req, req.query.sucursal_id);
    if (s.error) return invalido(res, 'sucursal_id', 'Sucursal no válida');
    const params = [];
    const filtroSede = (col) => { if (!s.id) return ''; params.push(s.id); return ` AND ${col} = ?`; };
    let sql = `SELECT r.id, r.codigo, r.nombre, r.marca, r.unidad, r.costo, r.precio, r.minimo, r.activo,
        COALESCE((SELECT SUM(e.cantidad) FROM repuesto_existencias e
                   WHERE e.tenant_id = @tenant AND e.repuesto_id = r.id${filtroSede('e.sucursal_id')}), 0)::int AS existencia,
        COALESCE((SELECT SUM(x.cantidad) FROM orden_repuestos x
                    JOIN ordenes_trabajo o ON o.id = x.orden_id AND o.tenant_id = @tenant
                   WHERE x.tenant_id = @tenant AND x.repuesto_id = r.id AND x.rechazado = 0
                     AND o.estado NOT IN ('entregada', 'cancelada')${filtroSede(SEDE_DE_ORDEN)}), 0)::int AS comprometido
      FROM repuestos r WHERE r.tenant_id = @tenant`;
    if (req.query.inactivos !== '1') sql += ' AND r.activo = 1';
    const q = String(req.query.q || '').trim().slice(0, 100);
    if (q) {
      const like = `%${escaparLike(q)}%`;
      sql += ' AND (r.nombre ILIKE ? OR r.codigo ILIKE ? OR r.marca ILIKE ?)';
      params.push(like, like, like);
    }
    sql += ' ORDER BY r.nombre LIMIT 2000';
    const [filas] = await req.db.query(sql, params);
    for (const f of filas) {
      f.disponible = f.existencia - f.comprometido;
      f.bajo = f.activo === 1 && f.disponible <= f.minimo;
    }
    res.json({ data: req.query.bajo === '1' ? filas.filter((f) => f.bajo) : filas, sucursal_id: s.id });
  } catch (err) {
    fail(res, err);
  }
});

// POST /api/inventario — { codigo, nombre, marca, unidad, costo, precio, minimo, existencia_inicial, sucursal_id }
router.post('/', puedeEditar, async (req, res) => {
  const v = datosDeRepuesto(req.body);
  if (v.error) return invalido(res, v.campo, v.error);
  const inicial = req.body.existencia_inicial;
  const hayInicial = inicial !== undefined && inicial !== null && inicial !== '' && Number(inicial) !== 0;
  if (hayInicial && !cantidadValida(inicial)) return invalido(res, 'existencia_inicial', 'La cantidad tiene que ser un número entero positivo');
  let sede = null;
  if (hayInicial) {
    const s = await sucursalPedida(req, req.body.sucursal_id).catch(() => ({ error: true }));
    if (s.error || !s.id) return invalido(res, 'sucursal_id', 'Elegí la sucursal donde está');
    sede = s.id;
  }
  const conn = await req.db.conexion();
  try {
    await conn.beginTransaction();
    const d = v.datos;
    const [r] = await conn.query(
      'INSERT INTO repuestos (tenant_id, codigo, nombre, marca, unidad, costo, precio, minimo) VALUES (@tenant, ?, ?, ?, ?, ?, ?, ?)',
      [d.codigo, d.nombre, d.marca, d.unidad, d.costo, d.precio, d.minimo]
    );
    if (hayInicial) {
      await moverExistencia(conn, { repuestoId: r.insertId, sucursalId: sede, tipo: 'entrada', cantidad: Number(inicial), costoUnitario: d.costo, nota: 'Existencia inicial', usuarioId: req.usuario.id });
    }
    await conn.commit();
    const [[nuevo]] = await req.db.query('SELECT * FROM repuestos WHERE tenant_id = @tenant AND id = ?', [r.insertId]);
    res.status(201).json({ data: nuevo, message: 'Repuesto agregado al inventario' });
  } catch (err) {
    await conn.rollback();
    if (err.code === 'ER_DUP_ENTRY') return invalido(res, 'codigo', 'Ya hay un repuesto con ese código', 409);
    fail(res, err);
  } finally {
    conn.release();
  }
});

// PUT /api/inventario/:id — datos del repuesto (las cantidades se mueven aparte).
router.put('/:id', puedeEditar, async (req, res) => {
  try {
    const v = datosDeRepuesto(req.body);
    if (v.error) return invalido(res, v.campo, v.error);
    const d = v.datos;
    const [r] = await req.db.query(
      `UPDATE repuestos SET codigo = ?, nombre = ?, marca = ?, unidad = ?, costo = ?, precio = ?, minimo = ?, updated_at = CURRENT_TIMESTAMP
        WHERE tenant_id = @tenant AND id = ?`,
      [d.codigo, d.nombre, d.marca, d.unidad, d.costo, d.precio, d.minimo, req.params.id]
    );
    if (!r.affectedRows) return res.status(404).json({ error: 'Repuesto no encontrado' });
    const [[actual]] = await req.db.query('SELECT * FROM repuestos WHERE tenant_id = @tenant AND id = ?', [req.params.id]);
    res.json({ data: actual, message: 'Repuesto actualizado' });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return invalido(res, 'codigo', 'Ya hay un repuesto con ese código', 409);
    fail(res, err);
  }
});

// PATCH /api/inventario/:id/activo — { activo }. Se desactiva, no se borra: las órdenes
// y los movimientos viejos lo siguen nombrando.
router.patch('/:id/activo', puedeEditar, async (req, res) => {
  try {
    const activo = req.body?.activo ? 1 : 0;
    const [r] = await req.db.query('UPDATE repuestos SET activo = ?, updated_at = CURRENT_TIMESTAMP WHERE tenant_id = @tenant AND id = ?', [activo, req.params.id]);
    if (!r.affectedRows) return res.status(404).json({ error: 'Repuesto no encontrado' });
    res.json({ message: activo ? 'Repuesto reactivado' : 'Repuesto desactivado' });
  } catch (err) {
    fail(res, err);
  }
});

// GET /api/inventario/:id/movimientos?sucursal_id=
router.get('/:id/movimientos', async (req, res) => {
  try {
    const s = await sucursalPedida(req, req.query.sucursal_id);
    if (s.error) return invalido(res, 'sucursal_id', 'Sucursal no válida');
    const [[rep]] = await req.db.query('SELECT id FROM repuestos WHERE tenant_id = @tenant AND id = ?', [req.params.id]);
    if (!rep) return res.status(404).json({ error: 'Repuesto no encontrado' });
    const params = [req.params.id];
    let sql = `SELECT m.id, m.tipo, m.cantidad, m.existencia_despues, m.costo_unitario, m.proveedor, m.documento, m.nota, m.created_at,
          m.sucursal_id, s.nombre AS sucursal_nombre, m.orden_id, o.numero_orden, u.nombre AS usuario_nombre
        FROM movimientos_inventario m
        LEFT JOIN sucursales s ON s.id = m.sucursal_id AND s.tenant_id = @tenant
        LEFT JOIN ordenes_trabajo o ON o.id = m.orden_id AND o.tenant_id = @tenant
        LEFT JOIN usuarios u ON u.id = m.usuario_id AND u.tenant_id = @tenant
       WHERE m.tenant_id = @tenant AND m.repuesto_id = ?`;
    if (s.id) { sql += ' AND m.sucursal_id = ?'; params.push(s.id); }
    sql += ' ORDER BY m.id DESC LIMIT 200';
    const [filas] = await req.db.query(sql, params);
    res.json({ data: filas });
  } catch (err) {
    fail(res, err);
  }
});

// Lo común de entrada y ajuste: repuesto del taller, sucursal y texto acotado.
async function prepararMovimiento(req, res) {
  const [[rep]] = await req.db.query('SELECT id, activo FROM repuestos WHERE tenant_id = @tenant AND id = ?', [req.params.id]);
  if (!rep) { res.status(404).json({ error: 'Repuesto no encontrado' }); return null; }
  const s = await sucursalPedida(req, req.body?.sucursal_id);
  if (s.error || !s.id) { invalido(res, 'sucursal_id', 'Elegí la sucursal'); return null; }
  const texto = (v, max) => String(v ?? '').trim().slice(0, max) || null;
  return { sucursalId: s.id, proveedor: texto(req.body.proveedor, MAX.proveedor), documento: texto(req.body.documento, MAX.documento), nota: texto(req.body.nota, MAX.nota) };
}

// POST /api/inventario/:id/entrada — { cantidad, sucursal_id, costo_unitario, proveedor, documento, nota }
// Una compra o un ingreso. Si trae costo, pasa a ser el costo del repuesto.
router.post('/:id/entrada', puedeEditar, async (req, res) => {
  if (!cantidadValida(req.body?.cantidad)) return invalido(res, 'cantidad', 'La cantidad tiene que ser un número entero positivo');
  const costo = req.body.costo_unitario;
  const hayCosto = costo !== undefined && costo !== null && costo !== '';
  if (hayCosto && !(Number.isFinite(Number(costo)) && Number(costo) >= 0 && Number(costo) <= 100000000)) return invalido(res, 'costo_unitario', 'El costo no es válido');
  let conn;
  try {
    const m = await prepararMovimiento(req, res);
    if (!m) return;
    conn = await req.db.conexion();
    await conn.beginTransaction();
    const existencia = await moverExistencia(conn, {
      repuestoId: Number(req.params.id), sucursalId: m.sucursalId, tipo: 'entrada', cantidad: Number(req.body.cantidad),
      costoUnitario: hayCosto ? Number(costo) : null, proveedor: m.proveedor, documento: m.documento, nota: m.nota, usuarioId: req.usuario.id,
    });
    if (hayCosto) await conn.query('UPDATE repuestos SET costo = ?, updated_at = CURRENT_TIMESTAMP WHERE tenant_id = @tenant AND id = ?', [Number(costo), req.params.id]);
    await conn.commit();
    res.status(201).json({ data: { existencia }, message: 'Entrada registrada' });
  } catch (err) {
    if (conn) await conn.rollback();
    fail(res, err);
  } finally {
    if (conn) conn.release();
  }
});

// POST /api/inventario/:id/ajuste — { conteo, sucursal_id, nota }. Después de contar lo
// que hay: la existencia pasa a ser `conteo` y queda anotada la diferencia.
router.post('/:id/ajuste', puedeEditar, async (req, res) => {
  if (!cantidadValida(req.body?.conteo, { permitirCero: true })) return invalido(res, 'conteo', 'El conteo tiene que ser un número entero, cero o más');
  const nota = String(req.body?.nota || '').trim();
  if (nota.length < 3) return invalido(res, 'nota', 'Escribí el motivo del ajuste');
  let conn;
  try {
    const m = await prepararMovimiento(req, res);
    if (!m) return;
    conn = await req.db.conexion();
    await conn.beginTransaction();
    const [[e]] = await conn.query(
      'SELECT cantidad FROM repuesto_existencias WHERE tenant_id = @tenant AND repuesto_id = ? AND sucursal_id = ? FOR UPDATE',
      [req.params.id, m.sucursalId]
    );
    const diferencia = Number(req.body.conteo) - Number(e?.cantidad || 0);
    if (!diferencia) { await conn.rollback(); return invalido(res, 'conteo', 'Ya tiene esa cantidad: no hay nada que ajustar'); }
    const existencia = await moverExistencia(conn, {
      repuestoId: Number(req.params.id), sucursalId: m.sucursalId, tipo: 'ajuste', cantidad: diferencia, nota: m.nota, usuarioId: req.usuario.id,
    });
    await conn.commit();
    res.status(201).json({ data: { existencia, diferencia }, message: 'Ajuste registrado' });
  } catch (err) {
    if (conn) await conn.rollback();
    fail(res, err);
  } finally {
    if (conn) conn.release();
  }
});

module.exports = router;
