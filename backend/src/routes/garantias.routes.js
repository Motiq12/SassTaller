const router = require('express').Router();
// Sin `pool`: todo el acceso pasa por req.db, scopeado al taller.
const { fail } = require('../utils/responder');
const auth = require('../middleware/auth');
const requireRol = require('../middleware/roles');
const { soloRoles } = require('../middleware/roles');
const { fotoValida } = require('../utils/validar');
const { cargarAlcance, soloSucursal, exigirSucursal, delTaller, SUCURSAL_DE_GARANTIA } = require('../utils/alcance');
const { exigirPermiso } = require('../middleware/permisos');

// Piso de rol: recepción o superior. Sin esto, cualquier token válido (incluido el
// de un cliente del portal) podía leer/crear reclamos de garantía ajenos.
router.use(auth, requireRol('recepcion'));
// Los reclamos son de la sucursal de su orden (utils/alcance.js).
router.use(cargarAlcance);
router.param('id', delTaller('garantias'));
router.param('id', exigirSucursal(SUCURSAL_DE_GARANTIA));

const ESTADOS = ['abierto', 'en_revision', 'aprobado', 'rechazado', 'resuelto'];

// SELECT base con datos de la orden/cliente/moto para mostrar el reclamo en contexto
// El filtro por taller va en CADA tabla, no solo en la principal. Con el JOIN
// scopeado pero `garantias` suelta —o al revés— la consulta devolvería igual filas
// de otros talleres, y una comprobación global la dejaría pasar (ver db/tenant-db).
//
// La base termina en WHERE para que quien la use siga con AND. Antes cada llamador
// ponía su propio WHERE, y con el filtro acá adentro habría quedado duplicado.
const SELECT_GARANTIA = `
  SELECT g.*,
         o.numero_orden, o.fecha_entrega_real, o.garantia_dias,
         m.marca, m.modelo, m.placa,
         c.nombre AS cliente_nombre, c.apellido AS cliente_apellido, c.telefono AS cliente_telefono,
         u.nombre AS creado_por_nombre
  FROM garantias g
  JOIN ordenes_trabajo o ON o.id = g.orden_id     AND o.tenant_id = @tenant
  JOIN vehiculos m       ON m.id = o.vehiculo_id  AND m.tenant_id = @tenant
  JOIN clientes c        ON c.id = o.cliente_id   AND c.tenant_id = @tenant
  LEFT JOIN usuarios u   ON u.id = g.creado_por   AND u.tenant_id = @tenant
  WHERE g.tenant_id = @tenant
`;

// GET /api/garantias — lista de reclamos (filtros: ?estado= y ?orden_id=)
router.get('/', async (req, res) => {
  try {
    const where = [];
    const params = [];
    if (req.query.estado && ESTADOS.includes(req.query.estado)) {
      where.push('g.estado = ?');
      params.push(req.query.estado);
    }
    if (req.query.orden_id) {
      where.push('g.orden_id = ?');
      params.push(req.query.orden_id);
    }
    const sql = SELECT_GARANTIA + `${where.map((w) => ' AND ' + w).join('')}${soloSucursal(req, 'o.sucursal_id')}` + ' ORDER BY g.created_at DESC';
    const [rows] = await req.db.query(sql, params);
    res.json({ data: rows });
  } catch (err) {
    fail(res, err);
  }
});

// GET /api/garantias/:id — un reclamo con sus fotos
router.get('/:id', async (req, res) => {
  try {
    const [[garantia]] = await req.db.query(SELECT_GARANTIA + ' AND g.id = ?', [req.params.id]);
    if (!garantia) return res.status(404).json({ error: 'Reclamo no encontrado' });
    const [fotos] = await req.db.query('SELECT * FROM garantia_fotos WHERE garantia_id = ? AND tenant_id = @tenant ORDER BY created_at ASC', [req.params.id]);
    res.json({ data: { ...garantia, fotos } });
  } catch (err) {
    fail(res, err);
  }
});

// POST /api/garantias — registrar un reclamo de garantía
router.post('/', soloRoles('recepcion', 'admin'), async (req, res) => {
  try {
    const { orden_id, descripcion_problema, cubre_repuestos, cubre_mano_obra } = req.body;
    if (!orden_id || !descripcion_problema) {
      return res.status(400).json({ error: 'Orden y descripción del problema son requeridos' });
    }
    const [[orden]] = await req.db.query(`SELECT id, estado FROM ordenes_trabajo WHERE id = ? AND tenant_id = @tenant${soloSucursal(req, 'sucursal_id')}`, [orden_id]);
    if (!orden) return res.status(404).json({ error: 'Orden no encontrada' });
    if (orden.estado !== 'entregada') {
      return res.status(400).json({ error: 'Solo se puede reclamar garantía sobre órdenes entregadas' });
    }
    const [result] = await req.db.query(
      `INSERT INTO garantias (tenant_id, orden_id, descripcion_problema, cubre_repuestos, cubre_mano_obra, creado_por)
       VALUES (@tenant, ?, ?, ?, ?, ?)`,
      [orden_id, descripcion_problema, cubre_repuestos ? 1 : 0, cubre_mano_obra ? 1 : 0, req.usuario.id]
    );
    const [[nueva]] = await req.db.query(SELECT_GARANTIA + ' AND g.id = ?', [result.insertId]);
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
    const [[actualizada]] = await req.db.query(SELECT_GARANTIA + ' AND g.id = ?', [req.params.id]);
    res.json({ data: actualizada, message: 'Trámite actualizado' });
  } catch (err) {
    fail(res, err);
  }
});

// POST /api/garantias/:id/fotos — evidencia del reclamo
router.post('/:id/fotos', soloRoles('recepcion', 'admin'), exigirPermiso('taller.fotos'), async (req, res) => {
  try {
    const { url, descripcion } = req.body;
    if (!url) return res.status(400).json({ error: 'Imagen requerida' });
    if (!fotoValida(url)) return res.status(400).json({ error: 'Imagen inválida' });
    const [result] = await req.db.query(
      'INSERT INTO garantia_fotos (tenant_id, garantia_id, url, descripcion) VALUES (@tenant, ?, ?, ?)',
      [req.params.id, url, descripcion || null]
    );
    const [[nueva]] = await req.db.query('SELECT * FROM garantia_fotos WHERE id = ? AND tenant_id = @tenant', [result.insertId]);
    res.status(201).json({ data: nueva, message: 'Evidencia agregada' });
  } catch (err) {
    fail(res, err);
  }
});

// DELETE /api/garantias/:id/fotos/:fid
router.delete('/:id/fotos/:fid', soloRoles('recepcion', 'admin'), async (req, res) => {
  try {
    await req.db.query('DELETE FROM garantia_fotos WHERE id = ? AND garantia_id = ? AND tenant_id = @tenant', [req.params.fid, req.params.id]);
    res.json({ message: 'Evidencia eliminada' });
  } catch (err) {
    fail(res, err);
  }
});

module.exports = router;
