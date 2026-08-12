const router = require('express').Router();
// Sin `pool`: todo el acceso pasa por req.db, scopeado al taller.
const { fail } = require('../utils/responder');
const auth = require('../middleware/auth');
const requireRol = require('../middleware/roles');
const { fotoValida } = require('../utils/validar');

// Piso de rol: recepción o superior. Sin esto, cualquier token válido (incluido el
// de un cliente del portal) podía leer/crear reclamos de garantía ajenos.
router.use(auth, requireRol('recepcion'));

const ESTADOS = ['abierto', 'en_revision', 'aprobado', 'rechazado', 'resuelto'];

// SELECT base con datos de la orden/cliente/moto para mostrar el reclamo en contexto
const SELECT_GARANTIA = `
  SELECT g.*,
         o.numero_orden, o.fecha_entrega_real, o.garantia_dias,
         m.marca, m.modelo, m.placa,
         c.nombre AS cliente_nombre, c.apellido AS cliente_apellido, c.telefono AS cliente_telefono,
         u.nombre AS creado_por_nombre
  FROM garantias g
  JOIN ordenes_trabajo o ON o.id = g.orden_id AND o.tenant_id = @tenant
  JOIN motos m           ON m.id = o.moto_id AND m.tenant_id = @tenant
  JOIN clientes c        ON c.id = o.cliente_id AND c.tenant_id = @tenant
  LEFT JOIN usuarios u   ON u.id = g.creado_por AND u.tenant_id = @tenant
`;

// GET /api/garantias — lista de reclamos (filtros: ?estado= y ?orden_id=)
router.get('/', async (req, res) => {
  try {
    // El filtro por taller va SIEMPRE, aunque no haya filtros de la query.
    const where = ['g.tenant_id = @tenant'];
    const params = [];
    if (req.query.estado && ESTADOS.includes(req.query.estado)) {
      where.push('g.estado = ?');
      params.push(req.query.estado);
    }
    if (req.query.orden_id) {
      where.push('g.orden_id = ?');
      params.push(req.query.orden_id);
    }
    const sql = SELECT_GARANTIA + ` WHERE ${where.join(' AND ')}` + ' ORDER BY g.created_at DESC';
    const [rows] = await req.db.query(sql, params);
    res.json({ data: rows });
  } catch (err) {
    fail(res, err);
  }
});

// GET /api/garantias/:id — un reclamo con sus fotos
router.get('/:id', async (req, res) => {
  try {
    const [[garantia]] = await req.db.query(SELECT_GARANTIA + ' WHERE g.id = ?', [req.params.id]);
    if (!garantia) return res.status(404).json({ error: 'Reclamo no encontrado' });
    const [fotos] = await req.db.query('SELECT * FROM garantia_fotos WHERE tenant_id = @tenant AND garantia_id = ? ORDER BY created_at ASC', [req.params.id]);
    res.json({ data: { ...garantia, fotos } });
  } catch (err) {
    fail(res, err);
  }
});

// POST /api/garantias — registrar un reclamo de garantía
router.post('/', async (req, res) => {
  try {
    const { orden_id, descripcion_problema, cubre_repuestos, cubre_mano_obra } = req.body;
    if (!orden_id || !descripcion_problema) {
      return res.status(400).json({ error: 'Orden y descripción del problema son requeridos' });
    }
    const [[orden]] = await req.db.query('SELECT id, estado FROM ordenes_trabajo WHERE tenant_id = @tenant AND id = ?', [orden_id]);
    if (!orden) return res.status(404).json({ error: 'Orden no encontrada' });
    if (orden.estado !== 'entregada') {
      return res.status(400).json({ error: 'Solo se puede reclamar garantía sobre órdenes entregadas' });
    }
    const [result] = await req.db.query(
      `INSERT INTO garantias (tenant_id,orden_id, descripcion_problema, cubre_repuestos, cubre_mano_obra, creado_por)
       VALUES (@tenant, ?, ?, ?, ?, ?)`,
      [orden_id, descripcion_problema, cubre_repuestos ? 1 : 0, cubre_mano_obra ? 1 : 0, req.usuario.id]
    );
    const [[nueva]] = await req.db.query(SELECT_GARANTIA + ' WHERE g.id = ?', [result.insertId]);
    res.status(201).json({ data: nueva, message: 'Reclamo de garantía registrado' });
  } catch (err) {
    fail(res, err);
  }
});

// PATCH /api/garantias/:id/estado — avanzar el trámite (admin)
router.patch('/:id/estado', requireRol('admin'), async (req, res) => {
  try {
    const { estado, resolucion, cubre_repuestos, cubre_mano_obra } = req.body;
    if (!ESTADOS.includes(estado)) return res.status(400).json({ error: 'Estado inválido' });
    await req.db.query(
      `UPDATE garantias SET estado = ?, resolucion = ?,
         cubre_repuestos = COALESCE(?, cubre_repuestos),
         cubre_mano_obra = COALESCE(?, cubre_mano_obra)
       WHERE id = ? AND tenant_id = @tenant`,
      [
        estado,
        resolucion || null,
        cubre_repuestos === undefined ? null : (cubre_repuestos ? 1 : 0),
        cubre_mano_obra === undefined ? null : (cubre_mano_obra ? 1 : 0),
        req.params.id,
      ]
    );
    const [[actualizada]] = await req.db.query(SELECT_GARANTIA + ' WHERE g.id = ?', [req.params.id]);
    res.json({ data: actualizada, message: 'Trámite actualizado' });
  } catch (err) {
    fail(res, err);
  }
});

// POST /api/garantias/:id/fotos — evidencia del reclamo
router.post('/:id/fotos', async (req, res) => {
  try {
    const { url, descripcion } = req.body;
    if (!url) return res.status(400).json({ error: 'Imagen requerida' });
    if (!fotoValida(url)) return res.status(400).json({ error: 'Imagen inválida' });
    const [result] = await req.db.query(
      'INSERT INTO garantia_fotos (tenant_id,garantia_id, url, descripcion) VALUES (@tenant, ?, ?, ?)',
      [req.params.id, url, descripcion || null]
    );
    const [[nueva]] = await req.db.query('SELECT * FROM garantia_fotos WHERE tenant_id = @tenant AND id = ?', [result.insertId]);
    res.status(201).json({ data: nueva, message: 'Evidencia agregada' });
  } catch (err) {
    fail(res, err);
  }
});

// DELETE /api/garantias/:id/fotos/:fid
router.delete('/:id/fotos/:fid', async (req, res) => {
  try {
    await req.db.query('DELETE FROM garantia_fotos WHERE tenant_id = @tenant AND id = ? AND garantia_id = ?', [req.params.fid, req.params.id]);
    res.json({ message: 'Evidencia eliminada' });
  } catch (err) {
    fail(res, err);
  }
});

module.exports = router;
