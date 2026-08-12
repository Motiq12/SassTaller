const router = require('express').Router();
const bcrypt = require('bcrypt');
// Sin `pool`: todo el acceso pasa por req.db, scopeado al taller.
const { fail } = require('../utils/responder');
const auth = require('../middleware/auth');
const requireRol = require('../middleware/roles');
const { soloRoles } = require('../middleware/roles');
const { generarNumeroOrden, sincronizarCitaDesdeOrden, cerrarOrden, avanzarEstadoOrden, estadoTrasAprobacion } = require('../utils/ordenes');
const { getConfig, horasDisponibles } = require('../utils/configuracion');
const { getServicios } = require('../utils/servicios');
const { getSucursales, tecnicoEnSucursal } = require('../utils/sucursales');
const { notificarMecanico } = require('../utils/notificaciones');
const { LEIDO_POR_MI, VISTO_POR_OTRO, marcarLeidos } = require('../utils/mensajes');
const { fotoValida } = require('../utils/validar');

// Panel de recepción: intermediaria entre cliente y mecánico.
// Accesible a recepción y superiores.
router.use(auth, requireRol('recepcion'));

// Estados de la orden que NO se consideran activos.
const ORDEN_CERRADA = ['entregada', 'cancelada'];

// ───────────────────────────────────────────────────────────
// 1.1 Resumen del día
// ───────────────────────────────────────────────────────────
router.get('/resumen', async (req, res) => {
  try {
    const [[{ citas_hoy }]] = await req.db.query(
      'SELECT COUNT(*) AS citas_hoy FROM citas WHERE fecha = CURDATE() AND tenant_id = @tenant'
    );
    const [[{ ordenes_activas }]] = await req.db.query(
      `SELECT COUNT(*) AS ordenes_activas FROM ordenes_trabajo
       WHERE estado NOT IN ('entregada','cancelada') AND tenant_id = @tenant`
    );
    const [[{ cotizaciones_pendientes }]] = await req.db.query(
      `SELECT COUNT(*) AS cotizaciones_pendientes FROM ordenes_trabajo
       WHERE estado = 'esperando_aprobacion' AND aprobacion_cliente = 'pendiente' AND tenant_id = @tenant`
    );
    // "Ocupado" = el técnico tiene trabajo activo en cualquiera de los dos mundos
    // (una cita en proceso hoy, o una orden de trabajo abierta). Misma población
    // que mecanicos_totales, así el cociente X/Y es coherente.
    const [[{ mecanicos_ocupados }]] = await req.db.query(
      `SELECT COUNT(*) AS mecanicos_ocupados FROM usuarios u
       WHERE u.rol = 'tecnico' AND u.activo = 1 AND u.tenant_id = @tenant AND (
         EXISTS (SELECT 1 FROM citas c
                 WHERE c.tecnico_id = u.id AND c.fecha = CURDATE()
                   AND c.estado IN ('en_revision','en_mantenimiento') AND c.tenant_id = @tenant)
         OR EXISTS (SELECT 1 FROM ordenes_trabajo o
                    WHERE o.tecnico_id = u.id AND o.estado NOT IN ('entregada','cancelada')
                      AND o.tenant_id = @tenant)
       )`
    );
    const [[{ mecanicos_totales }]] = await req.db.query(
      `SELECT COUNT(*) AS mecanicos_totales FROM usuarios
       WHERE rol = 'tecnico' AND activo = 1 AND tenant_id = @tenant`
    );
    res.json({
      data: {
        citas_hoy,
        ordenes_activas,
        cotizaciones_pendientes,
        mecanicos_ocupados,
        mecanicos_totales,
      },
    });
  } catch (err) {
    fail(res, err);
  }
});

// ───────────────────────────────────────────────────────────
// 1.2 Citas del día
// ───────────────────────────────────────────────────────────
router.get('/citas-hoy', async (req, res) => {
  try {
    const [rows] = await req.db.query(
      `SELECT ci.id, ci.fecha, TIME_FORMAT(ci.hora,'%H:%i') AS hora, ci.motivo, ci.tipo_servicio, ci.estado, ci.monto,
              ci.confirmada_cliente, ci.hora_llegada, ci.no_show, ci.orden_id, o.numero_orden,
              c.id AS cliente_id, c.nombre AS cliente_nombre, c.apellido AS cliente_apellido, c.telefono AS cliente_telefono,
              m.marca, m.modelo, m.placa,
              t.nombre AS tecnico_nombre,
              ci.sucursal_id, s.nombre AS sucursal_nombre
       FROM citas ci
       JOIN clientes c ON ci.cliente_id = c.id AND c.tenant_id = @tenant
       LEFT JOIN motos m ON ci.moto_id = m.id AND m.tenant_id = @tenant
       LEFT JOIN usuarios t ON ci.tecnico_id = t.id AND t.tenant_id = @tenant
       LEFT JOIN ordenes_trabajo o ON o.id = ci.orden_id AND o.tenant_id = @tenant
       LEFT JOIN sucursales s ON s.id = ci.sucursal_id AND s.tenant_id = @tenant
       WHERE ci.tenant_id = @tenant AND ci.fecha = CURDATE() AND ci.estado <> 'cancelado'
       ORDER BY ci.hora ASC`
    );
    res.json({ data: rows });
  } catch (err) {
    fail(res, err);
  }
});

// Agenda: citas en un rango de fechas (alimenta el calendario mensual de recepción).
// Mismas columnas que citas-hoy pero entre ?desde y ?hasta. Fecha y hora formateadas
// para evitar líos de zona horaria al agrupar por día en el front.
router.get('/agenda', async (req, res) => {
  try {
    const { desde, hasta } = req.query;
    if (!desde || !hasta) return res.status(400).json({ error: 'desde y hasta son requeridos' });
    const [rows] = await req.db.query(
      `SELECT ci.id, DATE_FORMAT(ci.fecha,'%Y-%m-%d') AS fecha, TIME_FORMAT(ci.hora,'%H:%i') AS hora,
              ci.motivo, ci.tipo_servicio, ci.estado, ci.confirmada_cliente, ci.hora_llegada,
              ci.no_show, ci.orden_id, o.numero_orden,
              c.id AS cliente_id, c.nombre AS cliente_nombre, c.apellido AS cliente_apellido, c.telefono AS cliente_telefono,
              m.marca, m.modelo, m.placa,
              t.nombre AS tecnico_nombre,
              ci.sucursal_id, s.nombre AS sucursal_nombre
       FROM citas ci
       JOIN clientes c ON ci.cliente_id = c.id AND c.tenant_id = @tenant
       LEFT JOIN motos m ON ci.moto_id = m.id AND m.tenant_id = @tenant
       LEFT JOIN usuarios t ON ci.tecnico_id = t.id AND t.tenant_id = @tenant
       LEFT JOIN ordenes_trabajo o ON o.id = ci.orden_id AND o.tenant_id = @tenant
       LEFT JOIN sucursales s ON s.id = ci.sucursal_id AND s.tenant_id = @tenant
       WHERE ci.tenant_id = @tenant AND ci.fecha BETWEEN ? AND ? AND ci.estado <> 'cancelado'
       ORDER BY ci.fecha ASC, ci.hora ASC`,
      [desde, hasta]
    );
    res.json({ data: rows });
  } catch (err) {
    fail(res, err);
  }
});

// Crear (o recuperar) la orden de trabajo de una cita: activa el puente cita ↔ orden.
router.post('/citas/:id/crear-orden', async (req, res) => {
  try {
    const [[cita]] = await req.db.query(
      `SELECT id, cliente_id, moto_id, motivo, tecnico_id, sucursal_id, orden_id
       FROM citas WHERE id = ? AND tenant_id = @tenant`,
      [req.params.id]
    );
    if (!cita) return res.status(404).json({ error: 'Cita no encontrada' });

    // Idempotente: si ya tiene orden, la devuelve.
    if (cita.orden_id) {
      const [[o]] = await req.db.query(
        'SELECT id, numero_orden FROM ordenes_trabajo WHERE id = ? AND tenant_id = @tenant', [cita.orden_id]
      );
      if (o) return res.json({ data: { orden_id: o.id, numero_orden: o.numero_orden }, message: 'La cita ya tiene una orden' });
    }
    if (!cita.moto_id) return res.status(400).json({ error: 'La cita no tiene una moto asociada; no se puede crear la orden' });

    const numero_orden = await generarNumeroOrden(req.db);
    const conn = await req.db.conexion();
    try {
      await conn.beginTransaction();
      const [result] = await conn.query(
        `INSERT INTO ordenes_trabajo
          (tenant_id, numero_orden, moto_id, cliente_id, sucursal_id, recepcionista_id, tecnico_id, problema_reportado, estado)
         VALUES (@tenant, ?, ?, ?, ?, ?, ?, ?, 'diagnostico')`,
        [numero_orden, cita.moto_id, cita.cliente_id, cita.sucursal_id || null, req.usuario.id, cita.tecnico_id || null, cita.motivo || 'Orden generada desde la cita']
      );
      await conn.query(
        'INSERT INTO orden_tiempos (tenant_id, orden_id, etapa) VALUES (@tenant, ?, ?)',
        [result.insertId, 'diagnostico']
      );
      await conn.query(
        'UPDATE citas SET orden_id = ? WHERE id = ? AND tenant_id = @tenant',
        [result.insertId, req.params.id]
      );
      await conn.commit();
      await sincronizarCitaDesdeOrden(req.db, result.insertId, 'diagnostico'); // cita → en_revision + notificación
      res.status(201).json({ data: { orden_id: result.insertId, numero_orden }, message: 'Orden creada desde la cita' });
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  } catch (err) {
    fail(res, err);
  }
});

// Check-in de mostrador: marca que el cliente llegó (antes de crear la orden).
// Solo aplica a citas agendadas y sin orden todavía. Idempotente.
router.patch('/citas/:id/llegada', async (req, res) => {
  try {
    const [[cita]] = await req.db.query(
      'SELECT id, estado, orden_id, hora_llegada FROM citas WHERE id = ? AND tenant_id = @tenant',
      [req.params.id]
    );
    if (!cita) return res.status(404).json({ error: 'Cita no encontrada' });
    if (cita.estado !== 'agendado' || cita.orden_id) {
      return res.status(400).json({ error: 'La cita ya está en proceso; no aplica marcar llegada' });
    }
    if (!cita.hora_llegada) {
      await req.db.query(
        'UPDATE citas SET hora_llegada = NOW() WHERE id = ? AND tenant_id = @tenant', [req.params.id]
      );
    }
    const [[r]] = await req.db.query(
      'SELECT hora_llegada FROM citas WHERE id = ? AND tenant_id = @tenant', [req.params.id]
    );
    res.json({ data: { hora_llegada: r.hora_llegada }, message: 'Llegada registrada' });
  } catch (err) {
    fail(res, err);
  }
});

// Deshacer la llegada (si se marcó por error).
router.delete('/citas/:id/llegada', async (req, res) => {
  try {
    const [result] = await req.db.query(
      'UPDATE citas SET hora_llegada = NULL WHERE id = ? AND orden_id IS NULL AND tenant_id = @tenant',
      [req.params.id]
    );
    if (!result.affectedRows) return res.status(400).json({ error: 'No se pudo deshacer la llegada' });
    res.json({ message: 'Llegada deshecha' });
  } catch (err) {
    fail(res, err);
  }
});

// ───────────────────────────────────────────────────────────
// 1.3 Alertas recientes — EVENTOS DEL TALLER (no el buzón del cliente)
// Lo que la recepción necesita atender, redactado desde la óptica del mostrador:
//   foto       → el mecánico subió evidencia en una orden activa
//   lista      → una orden quedó lista para entrega (llamar / cobrar)
//   aprobacion → el cliente aprobó o rechazó el presupuesto
//   cita_nueva → un cliente agendó una cita desde el portal (usuario_id NULL)
// Antes esto espejaba la tabla `notificaciones` (texto en 2ª persona del cliente
// + mensajes manuales sueltos), que no le sirve a la recepción.
// ───────────────────────────────────────────────────────────
router.get('/alertas', async (req, res) => {
  try {
    const [fotos] = await req.db.query(
      `SELECT 'foto' AS tipo, f.created_at,
              o.numero_orden, o.id AS orden_id,
              m.marca, m.modelo,
              u.nombre AS tecnico_nombre
       FROM orden_fotos f
       JOIN ordenes_trabajo o ON o.id = f.orden_id AND o.tenant_id = @tenant
       JOIN motos m ON m.id = o.moto_id AND m.tenant_id = @tenant
       LEFT JOIN usuarios u ON u.id = o.tecnico_id AND u.tenant_id = @tenant
       WHERE f.tenant_id = @tenant AND o.estado NOT IN ('entregada','cancelada')
         AND f.created_at >= NOW() - INTERVAL 24 HOUR
       ORDER BY f.created_at DESC LIMIT 10`
    );
    // Órdenes que entraron a "lista_entrega" en las últimas 24 h y siguen ahí
    // (la etapa abierta del registro de tiempos marca el momento exacto).
    const [listas] = await req.db.query(
      `SELECT 'lista' AS tipo, t.inicio AS created_at,
              o.numero_orden, o.id AS orden_id,
              c.nombre AS cliente_nombre, c.apellido AS cliente_apellido,
              m.marca, m.modelo
       FROM orden_tiempos t
       JOIN ordenes_trabajo o ON o.id = t.orden_id AND o.tenant_id = @tenant
       JOIN clientes c ON c.id = o.cliente_id AND c.tenant_id = @tenant
       JOIN motos m ON m.id = o.moto_id AND m.tenant_id = @tenant
       WHERE t.tenant_id = @tenant AND t.etapa = 'lista_entrega' AND t.fin IS NULL
         AND o.estado = 'lista_entrega'
         AND t.inicio >= NOW() - INTERVAL 24 HOUR
       ORDER BY t.inicio DESC LIMIT 10`
    );
    // Decisión del cliente sobre el presupuesto (fecha_aprobacion se setea en ambas).
    const [aprob] = await req.db.query(
      `SELECT 'aprobacion' AS tipo, o.fecha_aprobacion AS created_at,
              o.numero_orden, o.id AS orden_id, o.aprobacion_cliente AS decision,
              c.nombre AS cliente_nombre, c.apellido AS cliente_apellido,
              m.marca, m.modelo
       FROM ordenes_trabajo o
       JOIN clientes c ON c.id = o.cliente_id AND c.tenant_id = @tenant
       JOIN motos m ON m.id = o.moto_id AND m.tenant_id = @tenant
       WHERE o.tenant_id = @tenant AND o.aprobacion_cliente IN ('aprobado','rechazado')
         AND o.fecha_aprobacion >= NOW() - INTERVAL 24 HOUR
       ORDER BY o.fecha_aprobacion DESC LIMIT 10`
    );
    // Citas que el cliente agendó solo desde el portal (sin usuario de mostrador).
    const [citasNuevas] = await req.db.query(
      `SELECT 'cita_nueva' AS tipo, ci.created_at,
              ci.id AS cita_id, DATE_FORMAT(ci.fecha, '%d/%m') AS fecha_corta,
              TIME_FORMAT(ci.hora, '%H:%i') AS hora,
              c.nombre AS cliente_nombre, c.apellido AS cliente_apellido,
              m.marca, m.modelo
       FROM citas ci
       JOIN clientes c ON c.id = ci.cliente_id AND c.tenant_id = @tenant
       LEFT JOIN motos m ON m.id = ci.moto_id AND m.tenant_id = @tenant
       WHERE ci.tenant_id = @tenant AND ci.usuario_id IS NULL AND ci.estado <> 'cancelado'
         AND ci.created_at >= NOW() - INTERVAL 24 HOUR
       ORDER BY ci.created_at DESC LIMIT 10`
    );
    // Citas que el cliente canceló desde el portal: el taller tiene que enterarse
    // para liberar/reasignar el espacio (antes la cita solo desaparecía de la agenda).
    const [citasCanceladas] = await req.db.query(
      `SELECT 'cita_cancelada' AS tipo, ci.fecha_cancelacion AS created_at,
              ci.id AS cita_id, DATE_FORMAT(ci.fecha, '%d/%m') AS fecha_corta,
              TIME_FORMAT(ci.hora, '%H:%i') AS hora,
              c.nombre AS cliente_nombre, c.apellido AS cliente_apellido,
              m.marca, m.modelo
       FROM citas ci
       JOIN clientes c ON c.id = ci.cliente_id AND c.tenant_id = @tenant
       LEFT JOIN motos m ON m.id = ci.moto_id AND m.tenant_id = @tenant
       WHERE ci.tenant_id = @tenant AND ci.estado = 'cancelado' AND ci.fecha_cancelacion IS NOT NULL
         AND ci.fecha_cancelacion >= NOW() - INTERVAL 24 HOUR
       ORDER BY ci.fecha_cancelacion DESC LIMIT 10`
    );
    const [repSolicitados] = await req.db.query(
      `SELECT 'repuesto' AS tipo, r.created_at,
              o.numero_orden, o.id AS orden_id,
              r.nombre AS repuesto_nombre, r.cantidad AS repuesto_cantidad,
              m.marca, m.modelo,
              u.nombre AS tecnico_nombre
       FROM orden_repuestos r
       JOIN ordenes_trabajo o ON o.id = r.orden_id AND o.tenant_id = @tenant
       JOIN motos m ON m.id = o.moto_id AND m.tenant_id = @tenant
       LEFT JOIN usuarios u ON u.id = o.tecnico_id AND u.tenant_id = @tenant
       WHERE r.tenant_id = @tenant AND r.estado = 'solicitado'
         AND r.created_at >= NOW() - INTERVAL 24 HOUR
       ORDER BY r.created_at DESC LIMIT 10`
    );
    const todas = [...fotos, ...listas, ...aprob, ...citasNuevas, ...citasCanceladas, ...repSolicitados]
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, 20);
    res.json({ data: todas });
  } catch (err) {
    fail(res, err);
  }
});

// ───────────────────────────────────────────────────────────
// 1.4 Órdenes con evidencia (activas o completadas según ?estado=)
// ───────────────────────────────────────────────────────────
router.get('/ordenes', async (req, res) => {
  try {
    // ?estado=completadas → entregadas/canceladas; lista_entrega → listas para entregar;
    // por defecto, activas.
    let filtro;
    if (req.query.estado === 'lista_entrega') filtro = "o.tenant_id = @tenant AND o.estado = 'lista_entrega'";
    else if (req.query.estado === 'completadas') filtro = "o.tenant_id = @tenant AND o.estado IN ('entregada','cancelada')";
    else filtro = "o.tenant_id = @tenant AND o.estado NOT IN ('entregada','cancelada')";
    const [rows] = await req.db.query(
      `SELECT o.id, o.numero_orden, o.estado, o.problema_reportado, o.prioridad,
              o.costo_mano_obra, o.costo_repuestos, o.descuento,
              (o.costo_mano_obra + o.costo_repuestos - o.descuento) AS total,
              o.fecha_ingreso, o.fecha_estimada_entrega,
              c.id AS cliente_id, c.nombre AS cliente_nombre, c.apellido AS cliente_apellido, c.telefono AS cliente_telefono,
              m.marca, m.modelo, m.placa,
              t.nombre AS tecnico_nombre,
              o.sucursal_id, s.nombre AS sucursal_nombre,
              (SELECT COUNT(*) FROM orden_fotos WHERE orden_id = o.id AND tenant_id = @tenant) AS total_fotos
       FROM ordenes_trabajo o
       JOIN clientes c ON o.cliente_id = c.id AND c.tenant_id = @tenant
       JOIN motos m ON o.moto_id = m.id AND m.tenant_id = @tenant
       LEFT JOIN usuarios t ON o.tecnico_id = t.id AND t.tenant_id = @tenant
       LEFT JOIN sucursales s ON s.id = o.sucursal_id AND s.tenant_id = @tenant
       WHERE ${filtro}
       ORDER BY o.fecha_ingreso DESC`
    );
    res.json({ data: rows });
  } catch (err) {
    fail(res, err);
  }
});

// 1.5 Fotos de una orden
router.get('/ordenes/:id/fotos', async (req, res) => {
  try {
    const [rows] = await req.db.query(
      'SELECT * FROM orden_fotos WHERE orden_id = ? AND tenant_id = @tenant ORDER BY created_at ASC',
      [req.params.id]
    );
    res.json({ data: rows });
  } catch (err) {
    fail(res, err);
  }
});

// 1.6 Subir foto a una orden (data URL base64). Reusa la lógica de ordenes.routes.js.
router.post('/ordenes/:id/fotos', async (req, res) => {
  try {
    const { url, tipo, descripcion } = req.body;
    if (!url) return res.status(400).json({ error: 'Imagen requerida' });
    const tiposValidos = ['ingreso', 'diagnostico', 'avance', 'entrega'];
    const tipoFinal = tiposValidos.includes(tipo) ? tipo : 'avance';
    const [result] = await req.db.query(
      'INSERT INTO orden_fotos (tenant_id, orden_id, url, tipo, descripcion) VALUES (@tenant, ?, ?, ?, ?)',
      [req.params.id, url, tipoFinal, descripcion || null]
    );
    const [[nueva]] = await req.db.query('SELECT * FROM orden_fotos WHERE id = ? AND tenant_id = @tenant', [result.insertId]);
    res.status(201).json({ data: nueva, message: 'Foto agregada' });
  } catch (err) {
    fail(res, err);
  }
});

// Entregar (cerrar) una orden lista para entrega: registra pago + garantía y la marca
// entregada. Reusa la lógica transaccional de cierre (fidelización + sync de cita).
// Recepción solo puede entregar órdenes que el mecánico ya dejó en 'lista_entrega'.
router.post('/ordenes/:id/entregar', async (req, res) => {
  try {
    const { metodo_pago, garantia_dias, observaciones_finales } = req.body;
    const r = await cerrarOrden(req.db, 
      req.params.id,
      { metodo_pago, garantia_dias, observaciones_finales },
      { soloDesdeListaEntrega: true }
    );
    if (r.notFound) return res.status(404).json({ error: 'Orden no encontrada' });
    if (r.estadoInvalido) return res.status(400).json({ error: 'La orden todavía no está lista para entrega' });
    res.json({ message: 'Orden entregada', cortesia_ganada: r.cortesiaGanada });
  } catch (err) {
    fail(res, err);
  }
});

// ───────────────────────────────────────────────────────────
// 1.7 Cotizaciones (órdenes con costos)
// ───────────────────────────────────────────────────────────
router.get('/cotizaciones', async (req, res) => {
  try {
    let filtroAprob = '';
    const params = [];
    if (req.query.estado === 'pendiente') {
      filtroAprob = " AND o.aprobacion_cliente = 'pendiente'";
    } else if (req.query.estado === 'enviada') {
      filtroAprob = " AND o.aprobacion_cliente != 'pendiente'";
    }
    const [rows] = await req.db.query(
      `SELECT o.id, o.numero_orden, o.estado, o.aprobacion_cliente,
              o.costo_mano_obra, o.costo_repuestos, o.descuento,
              (o.costo_mano_obra + o.costo_repuestos - o.descuento) AS total,
              c.id AS cliente_id, c.nombre AS cliente_nombre, c.apellido AS cliente_apellido, c.telefono AS cliente_telefono,
              m.marca, m.modelo, m.placa,
              t.nombre AS tecnico_nombre
       FROM ordenes_trabajo o
       JOIN clientes c ON o.cliente_id = c.id AND c.tenant_id = @tenant
       JOIN motos m ON o.moto_id = m.id AND m.tenant_id = @tenant
       LEFT JOIN usuarios t ON o.tecnico_id = t.id AND t.tenant_id = @tenant
       WHERE o.tenant_id = @tenant AND o.estado NOT IN ('entregada','cancelada')
         AND (o.costo_mano_obra > 0 OR o.costo_repuestos > 0)${filtroAprob}
       ORDER BY o.created_at DESC`,
      params
    );
    res.json({ data: rows });
  } catch (err) {
    fail(res, err);
  }
});

// Repuestos de una orden
router.get('/cotizaciones/:id/repuestos', async (req, res) => {
  try {
    const [rows] = await req.db.query(
      'SELECT * FROM orden_repuestos WHERE orden_id = ? AND tenant_id = @tenant ORDER BY created_at ASC',
      [req.params.id]
    );
    res.json({ data: rows });
  } catch (err) {
    fail(res, err);
  }
});

// Recalcula costo_repuestos de la orden a partir de sus piezas.
async function recalcularRepuestos(ordenId) {
  await req.db.query(
    'UPDATE ordenes_trabajo SET costo_repuestos = (SELECT COALESCE(SUM(cantidad * costo_unitario), 0) FROM orden_repuestos WHERE orden_id = ?) WHERE id = ? AND tenant_id = @tenant',
    [ordenId, ordenId]
  );
}

// Agregar repuesto
router.post('/cotizaciones/:id/repuestos', async (req, res) => {
  try {
    const { nombre, cantidad, costo_unitario, estado } = req.body;
    if (!nombre) return res.status(400).json({ error: 'Nombre del repuesto requerido' });
    const [result] = await req.db.query(
      'INSERT INTO orden_repuestos (tenant_id, orden_id, nombre, cantidad, costo_unitario, estado) VALUES (@tenant, ?, ?, ?, ?, ?)',
      [req.params.id, nombre, cantidad || 1, costo_unitario || 0, estado || 'pendiente']
    );
    await recalcularRepuestos(req.params.id);
    const [[nuevo]] = await req.db.query('SELECT * FROM orden_repuestos WHERE id = ? AND tenant_id = @tenant', [result.insertId]);
    res.status(201).json({ data: nuevo, message: 'Repuesto agregado' });
  } catch (err) {
    fail(res, err);
  }
});

// Editar repuesto
router.put('/cotizaciones/:id/repuestos/:rid', async (req, res) => {
  try {
    const { nombre, cantidad, costo_unitario, estado } = req.body;
    const [[existe]] = await req.db.query('SELECT id FROM orden_repuestos WHERE id = ? AND orden_id = ? AND tenant_id = @tenant', [req.params.rid, req.params.id]);
    if (!existe) return res.status(404).json({ error: 'Repuesto no encontrado' });
    await req.db.query(
      'UPDATE orden_repuestos SET nombre=?, cantidad=?, costo_unitario=?, estado=? WHERE id=? AND orden_id=? AND tenant_id = @tenant',
      [nombre, cantidad || 1, costo_unitario || 0, estado || 'pendiente', req.params.rid, req.params.id]
    );
    await recalcularRepuestos(req.params.id);
    const [[actualizado]] = await req.db.query('SELECT * FROM orden_repuestos WHERE id = ? AND tenant_id = @tenant', [req.params.rid]);
    res.json({ data: actualizado, message: 'Repuesto actualizado' });
  } catch (err) {
    fail(res, err);
  }
});

// Eliminar repuesto
router.delete('/cotizaciones/:id/repuestos/:rid', async (req, res) => {
  try {
    const [result] = await req.db.query('DELETE FROM orden_repuestos WHERE id=? AND orden_id=? AND tenant_id = @tenant', [req.params.rid, req.params.id]);
    if (!result.affectedRows) return res.status(404).json({ error: 'Repuesto no encontrado' });
    await recalcularRepuestos(req.params.id);
    res.json({ message: 'Repuesto eliminado' });
  } catch (err) {
    fail(res, err);
  }
});

// Actualizar mano de obra y descuento
router.put('/cotizaciones/:id/costos', async (req, res) => {
  try {
    const { costo_mano_obra, descuento } = req.body;
    const [[orden]] = await req.db.query('SELECT id FROM ordenes_trabajo WHERE id = ? AND tenant_id = @tenant', [req.params.id]);
    if (!orden) return res.status(404).json({ error: 'Orden no encontrada' });
    await req.db.query(
      'UPDATE ordenes_trabajo SET costo_mano_obra = ?, descuento = ? WHERE id = ? AND tenant_id = @tenant',
      [costo_mano_obra || 0, descuento || 0, req.params.id]
    );
    const [[actualizada]] = await req.db.query(
      'SELECT id, costo_mano_obra, costo_repuestos, descuento, (costo_mano_obra + costo_repuestos - descuento) AS total FROM ordenes_trabajo WHERE id = ? AND tenant_id = @tenant',
      [req.params.id]
    );
    res.json({ data: actualizada, message: 'Costos actualizados' });
  } catch (err) {
    fail(res, err);
  }
});

// Armar una cotización completa en UNA transacción: asigna técnico (opcional),
// inserta todas las piezas, fija mano de obra + descuento y recalcula los repuestos.
// Si algo falla, no queda nada a medias (antes el front encadenaba varias llamadas).
router.post('/cotizaciones/:id/armar', async (req, res) => {
  const ordenId = req.params.id;
  const { tecnico_id, piezas, costo_mano_obra, descuento } = req.body;

  const piezasValidas = Array.isArray(piezas)
    ? piezas
        .map(p => ({ nombre: String(p?.nombre || '').trim(), cantidad: Number(p?.cantidad) || 1, costo_unitario: Number(p?.costo_unitario) || 0 }))
        .filter(p => p.nombre && p.costo_unitario > 0)
    : [];
  if (!piezasValidas.length) {
    return res.status(400).json({ error: 'Agregá al menos una pieza con monto' });
  }

  try {
    const [[orden]] = await req.db.query('SELECT id, sucursal_id FROM ordenes_trabajo WHERE id = ? AND tenant_id = @tenant', [ordenId]);
    if (!orden) return res.status(404).json({ error: 'Orden no encontrada' });

    if (tecnico_id) {
      const [[tec]] = await req.db.query(
        "SELECT id FROM usuarios WHERE id = ? AND rol = 'tecnico' AND activo = 1 AND tenant_id = @tenant",
        [tecnico_id]
      );
      if (!tec) return res.status(400).json({ error: 'El técnico no existe o está inactivo' });
      if (!(await tecnicoEnSucursal(req.db, tecnico_id, orden.sucursal_id))) {
        return res.status(400).json({ error: 'El mecánico no atiende en la sucursal de la orden' });
      }
    }

    const conn = await req.db.conexion();
    try {
      await conn.beginTransaction();
      if (tecnico_id) {
        await conn.query('UPDATE ordenes_trabajo SET tecnico_id = ? WHERE id = ? AND tenant_id = @tenant', [tecnico_id, ordenId]);
      }
      for (const p of piezasValidas) {
        await conn.query(
          "INSERT INTO orden_repuestos (tenant_id, orden_id, nombre, cantidad, costo_unitario, estado) VALUES (@tenant, ?, ?, ?, ?, 'pendiente')",
          [ordenId, p.nombre, p.cantidad, p.costo_unitario]
        );
      }
      await conn.query(
        'UPDATE ordenes_trabajo SET costo_mano_obra = ?, descuento = ? WHERE id = ? AND tenant_id = @tenant',
        [Number(costo_mano_obra) || 0, Number(descuento) || 0, ordenId]
      );
      await conn.query(
        'UPDATE ordenes_trabajo SET costo_repuestos = (SELECT COALESCE(SUM(cantidad * costo_unitario), 0) FROM orden_repuestos WHERE orden_id = ?) WHERE id = ? AND tenant_id = @tenant',
        [ordenId, ordenId]
      );
      await conn.commit();
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }

    const [[cotizacion]] = await req.db.query(
      'SELECT id, costo_mano_obra, costo_repuestos, descuento, (costo_mano_obra + costo_repuestos - descuento) AS total FROM ordenes_trabajo WHERE id = ? AND tenant_id = @tenant',
      [ordenId]
    );
    res.status(201).json({ data: cotizacion, message: 'Cotización guardada' });
  } catch (err) {
    fail(res, err);
  }
});

// Enviar cotización: la orden pasa a esperando aprobación del cliente.
router.post('/cotizaciones/:id/enviar', async (req, res) => {
  try {
    const [result] = await req.db.query(
      "UPDATE ordenes_trabajo SET estado = 'esperando_aprobacion', aprobacion_cliente = 'pendiente', motivo_rechazo = NULL WHERE id = ? AND tenant_id = @tenant AND estado IN ('diagnostico','recepcion')",
      [req.params.id]
    );
    if (!result.affectedRows) {
      return res.status(400).json({ error: 'La orden no está en un estado que permita enviar la cotización' });
    }
    // Aviso en el feed del cliente (además del WhatsApp que abre la recepción).
    const [[o]] = await req.db.query(
      `SELECT o.cliente_id, o.numero_orden, m.marca, m.modelo,
              (SELECT id FROM citas WHERE orden_id = o.id AND tenant_id = @tenant LIMIT 1) AS cita_id
       FROM ordenes_trabajo o JOIN motos m ON m.id = o.moto_id AND m.tenant_id = @tenant WHERE o.id = ? AND o.tenant_id = @tenant`,
      [req.params.id]
    );
    // Preferencia del taller: avisar al cliente cuando la cotización está lista.
    const config = await getConfig(req.db);
    if (o && config.notif_cotizacion) {
      const moto = [o.marca, o.modelo].filter(Boolean).join(' ') || 'tu moto';
      await req.db.query(
        "INSERT INTO notificaciones (tenant_id, cliente_id, cita_id, titulo, mensaje, tipo) VALUES (@tenant, ?, ?, ?, ?, 'presupuesto')",
        [o.cliente_id, o.cita_id || null, `Presupuesto listo: ${moto}`, `Tu presupuesto (orden ${o.numero_orden}) está listo. Revisalo y aprobalo desde el portal.`]
      );
    }
    res.json({ message: 'Cotización enviada al cliente' });
  } catch (err) {
    fail(res, err);
  }
});

// ───────────────────────────────────────────────────────────
// Órdenes activas de un cliente (para armar una cotización nueva)
// ───────────────────────────────────────────────────────────
router.get('/clientes/:id/ordenes', async (req, res) => {
  try {
    const [rows] = await req.db.query(
      `SELECT o.id, o.numero_orden, o.estado, o.problema_reportado, o.sucursal_id,
              m.marca, m.modelo, m.placa
       FROM ordenes_trabajo o
       JOIN motos m ON o.moto_id = m.id AND m.tenant_id = @tenant
       WHERE o.tenant_id = @tenant AND o.cliente_id = ? AND o.estado NOT IN ('entregada','cancelada')
       ORDER BY o.fecha_ingreso DESC`,
      [req.params.id]
    );
    res.json({ data: rows });
  } catch (err) {
    fail(res, err);
  }
});

// Técnicos activos (recepción no puede usar /api/usuarios, que es solo admin).
// Con ?sucursal_id devuelve los de esa sede + los de "ambas" (sucursal_id NULL);
// sin parámetro, todos (lo usa la mensajería interna, que no es por sede).
router.get('/tecnicos', async (req, res) => {
  try {
    let sql = "SELECT id, nombre, sucursal_id FROM usuarios WHERE tenant_id = @tenant AND rol = 'tecnico' AND activo = 1";
    const params = [];
    if (req.query.sucursal_id) {
      sql += ' AND (sucursal_id = ? OR sucursal_id IS NULL)';
      params.push(req.query.sucursal_id);
    }
    sql += ' ORDER BY nombre';
    const [rows] = await req.db.query(sql, params);
    res.json({ data: rows });
  } catch (err) {
    fail(res, err);
  }
});

// Catálogo de servicios (para el formulario de agendar). Solo los activos: es lo que
// el taller ofrece hoy. Se administra desde el panel, en Servicios.
router.get('/servicios', async (req, res) => {
  try {
    res.json({ data: await getServicios(req.db) });
  } catch (err) {
    fail(res, err);
  }
});

// Sucursales activas (para elegir local al ingresar un cliente sin cita).
router.get('/sucursales', async (req, res) => {
  try {
    const data = await getSucursales(req.db, { soloActivas: true });
    res.json({ data });
  } catch (err) {
    fail(res, err);
  }
});

// ── Perfil del recepcionista (su propia cuenta) ──
// Datos de la cuenta + sede asignada (read-only, la fija el admin) + foto.
const SELECT_PERFIL = `
  SELECT u.id, u.nombre, u.email, u.telefono, u.rol, u.foto, u.sucursal_id, u.created_at,
         s.nombre AS sucursal_nombre
  FROM usuarios u
  LEFT JOIN sucursales s ON s.id = u.sucursal_id AND s.tenant_id = @tenant
  WHERE u.id = ? AND u.tenant_id = @tenant`;

router.get('/perfil', async (req, res) => {
  try {
    const [[u]] = await req.db.query(SELECT_PERFIL, [req.usuario.id]);
    if (!u) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json({ data: u });
  } catch (err) {
    fail(res, err);
  }
});

router.put('/perfil', async (req, res) => {
  try {
    const { nombre, email, telefono } = req.body;
    if (!nombre || !nombre.trim() || !email || !email.trim()) {
      return res.status(400).json({ error: 'Nombre y correo son requeridos' });
    }
    await req.db.query(
      'UPDATE usuarios SET nombre = ?, email = ?, telefono = ? WHERE id = ? AND tenant_id = @tenant',
      [nombre.trim(), email.trim(), (telefono || '').trim() || null, req.usuario.id]
    );
    const [[u]] = await req.db.query(SELECT_PERFIL, [req.usuario.id]);
    res.json({ data: u, message: 'Perfil actualizado' });
  } catch (err) {
    fail(res, err);
  }
});

// Foto de perfil (data URL base64) o null para quitarla.
router.put('/perfil/foto', async (req, res) => {
  try {
    const { foto } = req.body;
    if (!fotoValida(foto)) return res.status(400).json({ error: 'Imagen inválida' });
    await req.db.query('UPDATE usuarios SET foto = ? WHERE id = ? AND tenant_id = @tenant', [foto || null, req.usuario.id]);
    res.json({ data: { foto: foto || null }, message: foto ? 'Foto actualizada' : 'Foto eliminada' });
  } catch (err) {
    fail(res, err);
  }
});

router.put('/perfil/password', async (req, res) => {
  try {
    const { actual, nueva } = req.body;
    if (!actual || !nueva) return res.status(400).json({ error: 'Contraseña actual y nueva son requeridas' });
    if (String(nueva).length < 8) return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 8 caracteres' });
    const [[u]] = await req.db.query('SELECT password_hash FROM usuarios WHERE id = ? AND tenant_id = @tenant', [req.usuario.id]);
    if (!u) return res.status(404).json({ error: 'Usuario no encontrado' });
    const ok = await bcrypt.compare(String(actual), u.password_hash);
    if (!ok) return res.status(400).json({ error: 'La contraseña actual no es correcta' });
    const hash = await bcrypt.hash(String(nueva), 10);
    await req.db.query('UPDATE usuarios SET password_hash = ? WHERE id = ? AND tenant_id = @tenant', [hash, req.usuario.id]);
    res.json({ message: 'Contraseña actualizada' });
  } catch (err) {
    fail(res, err);
  }
});

// Disponibilidad de horas para una fecha (agendar manual). Reusa la config del
// taller: mismas horas/cupos que ve el cliente en el portal. El cupo se cuenta por
// sucursal (igual que el portal) cuando se indica sucursal_id; si no, global.
router.get('/disponibilidad', async (req, res) => {
  try {
    const { fecha, sucursal_id } = req.query;
    if (!fecha) return res.status(400).json({ error: 'Fecha requerida' });
    const config = await getConfig(req.db);
    const horas = horasDisponibles(fecha, config);
    let sql = `SELECT TIME_FORMAT(hora, '%H:%i') AS hora, COUNT(*) AS n
               FROM citas WHERE tenant_id = @tenant AND fecha = ? AND estado != 'cancelado'`;
    const params = [fecha];
    if (sucursal_id) { sql += ' AND sucursal_id = ?'; params.push(sucursal_id); }
    sql += ' GROUP BY 1';
    const [rows] = await req.db.query(sql, params);
    const ocupacion = {};
    for (const r of rows) ocupacion[r.hora] = r.n;
    res.json({ data: { horas, max: config.max_citas_hora, ocupacion } });
  } catch (err) {
    fail(res, err);
  }
});

// Asignar técnico a una orden (al crear/editar una cotización)
router.patch('/ordenes/:id/tecnico', async (req, res) => {
  try {
    const { tecnico_id } = req.body;
    const [[orden]] = await req.db.query('SELECT id, sucursal_id FROM ordenes_trabajo WHERE id = ? AND tenant_id = @tenant', [req.params.id]);
    if (!orden) return res.status(404).json({ error: 'Orden no encontrada' });
    if (tecnico_id) {
      const [[tec]] = await req.db.query("SELECT id FROM usuarios WHERE id = ? AND rol = 'tecnico' AND activo = 1 AND tenant_id = @tenant", [tecnico_id]);
      if (!tec) return res.status(400).json({ error: 'El técnico no existe o está inactivo' });
      if (!(await tecnicoEnSucursal(req.db, tecnico_id, orden.sucursal_id))) {
        return res.status(400).json({ error: 'El mecánico no atiende en la sucursal de la orden' });
      }
    }
    await req.db.query('UPDATE ordenes_trabajo SET tecnico_id = ? WHERE id = ? AND tenant_id = @tenant', [tecnico_id || null, req.params.id]);
    await req.db.query('UPDATE citas SET tecnico_id = ? WHERE orden_id = ? AND tenant_id = @tenant', [tecnico_id || null, req.params.id]);
    if (tecnico_id) {
      const [[o]] = await req.db.query('SELECT numero_orden, problema_reportado FROM ordenes_trabajo WHERE id = ? AND tenant_id = @tenant', [req.params.id]);
      if (o) await notificarMecanico(req.db, tecnico_id, `Te asignaron la orden ${o.numero_orden}: ${(o.problema_reportado || '').slice(0, 80)}`, req.usuario.id);
    }
    res.json({ message: 'Técnico asignado' });
  } catch (err) {
    fail(res, err);
  }
});

// Marcar una cotización como aprobada por el cliente (atajo desde recepción, p. ej.
// cuando aprueba verbalmente en el mostrador). Solo recepción/admin: no es una acción
// que un técnico deba poder forjar en nombre del cliente.
router.post('/cotizaciones/:id/aprobar', soloRoles('recepcion', 'admin'), async (req, res) => {
  try {
    const [[orden]] = await req.db.query('SELECT id, estado FROM ordenes_trabajo WHERE id = ? AND tenant_id = @tenant', [req.params.id]);
    if (!orden) return res.status(404).json({ error: 'Orden no encontrada' });
    // Igual que el endpoint del portal: solo se puede "aprobar" una orden que
    // efectivamente está esperando esa aprobación (evita marcar como aprobada, con
    // fecha y todo, una orden ya entregada/cancelada o en cualquier otro estado).
    if (orden.estado !== 'esperando_aprobacion') {
      return res.status(400).json({ error: 'La orden no está esperando aprobación' });
    }
    await req.db.query(
      "UPDATE ordenes_trabajo SET aprobacion_cliente = 'aprobado', aprobado_por_cliente = 1, fecha_aprobacion = NOW() WHERE id = ? AND tenant_id = @tenant",
      [req.params.id]
    );
    await avanzarEstadoOrden(req.db, req.params.id, await estadoTrasAprobacion(req.db, req.params.id));
    res.json({ message: 'Cotización aprobada' });
  } catch (err) {
    fail(res, err);
  }
});

// ───────────────────────────────────────────────────────────
// 1.8 Directorio de clientes (con búsqueda ?q=)
// ───────────────────────────────────────────────────────────
router.get('/clientes', async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    let sql = `
      SELECT c.id, c.nombre, c.apellido, c.telefono, c.email,
             (SELECT COUNT(*) FROM motos WHERE cliente_id = c.id AND activa = 1 AND tenant_id = @tenant) AS total_motos,
             (SELECT COUNT(*) FROM citas WHERE cliente_id = c.id AND tenant_id = @tenant) AS total_citas
      FROM clientes c
      WHERE c.tenant_id = @tenant AND c.activo = 1`;
    const params = [];
    if (q) {
      sql += ` AND (c.nombre LIKE ? OR c.apellido LIKE ? OR c.telefono LIKE ? OR c.email LIKE ? OR c.cedula LIKE ?
               OR CONCAT(c.nombre, " ", c.apellido) LIKE ?
               OR EXISTS (SELECT 1 FROM motos mm WHERE mm.cliente_id = c.id AND mm.activa = 1 AND mm.tenant_id = @tenant AND mm.placa LIKE ?))`;
      const like = `%${q}%`;
      params.push(like, like, like, like, like, like, like);
    }
    sql += ' ORDER BY c.nombre, c.apellido';
    const [rows] = await req.db.query(sql, params);
    res.json({ data: rows });
  } catch (err) {
    fail(res, err);
  }
});

// ───────────────────────────────────────────────────────────
// 1.9 Mensajes: avances de mecánicos (entrada) y notificaciones a clientes (salida)
// ───────────────────────────────────────────────────────────

// Avances recientes registrados por los mecánicos en órdenes activas.
router.get('/avances', async (req, res) => {
  try {
    const [rows] = await req.db.query(
      `SELECT a.id, a.descripcion, a.created_at,
              o.id AS orden_id, o.numero_orden, o.estado,
              c.id AS cliente_id, c.nombre AS cliente_nombre, c.apellido AS cliente_apellido, c.telefono AS cliente_telefono,
              m.marca, m.modelo, m.placa,
              u.nombre AS tecnico_nombre, u.rol AS tecnico_rol,
              (SELECT COUNT(*) FROM orden_fotos WHERE orden_id = o.id AND tenant_id = @tenant) AS total_fotos
       FROM orden_avances a
       JOIN ordenes_trabajo o ON o.id = a.orden_id AND o.tenant_id = @tenant
       JOIN clientes c ON c.id = o.cliente_id AND c.tenant_id = @tenant
       JOIN motos m ON m.id = o.moto_id AND m.tenant_id = @tenant
       JOIN usuarios u ON u.id = a.usuario_id AND u.tenant_id = @tenant
       WHERE a.tenant_id = @tenant
       ORDER BY a.created_at DESC LIMIT 40`
    );
    res.json({ data: rows });
  } catch (err) {
    fail(res, err);
  }
});

// Notificaciones enviadas a clientes (feed de salida).
router.get('/notificaciones', async (req, res) => {
  try {
    const [rows] = await req.db.query(
      `SELECT n.id, n.titulo, n.mensaje, n.leida, n.created_at,
              c.id AS cliente_id, c.nombre AS cliente_nombre, c.apellido AS cliente_apellido, c.telefono AS cliente_telefono
       FROM notificaciones n
       JOIN clientes c ON c.id = n.cliente_id AND c.tenant_id = @tenant
       WHERE n.tenant_id = @tenant
       ORDER BY n.created_at DESC LIMIT 40`
    );
    res.json({ data: rows });
  } catch (err) {
    fail(res, err);
  }
});

// Enviar una notificación manual al cliente.
router.post('/notificar', async (req, res) => {
  try {
    const { cliente_id, cita_id, titulo, mensaje } = req.body;
    if (!cliente_id || !titulo || !mensaje) {
      return res.status(400).json({ error: 'cliente_id, titulo y mensaje son requeridos' });
    }
    const [result] = await req.db.query(
      "INSERT INTO notificaciones (tenant_id, cliente_id, cita_id, titulo, mensaje, tipo) VALUES (@tenant, ?, ?, ?, ?, 'mensaje')",
      [cliente_id, cita_id || null, titulo, mensaje]
    );
    const [[nueva]] = await req.db.query('SELECT * FROM notificaciones WHERE id = ? AND tenant_id = @tenant', [result.insertId]);
    res.status(201).json({ data: nueva, message: 'Notificación enviada' });
  } catch (err) {
    fail(res, err);
  }
});

// ───────────────────────────────────────────────────────────
// Mensajería interna con los mecánicos (lado recepción)
// @deprecated — el chat del personal migró a /api/mensajeria (1:1 por persona).
// Estos endpoints de buzón por rol quedan operativos por compatibilidad y se
// eliminarán en un release futuro. No agregar features acá.
// ───────────────────────────────────────────────────────────
// LEIDO_POR_MI trae un `?` (mi id): va SIEMPRE como primer parámetro de cada query.
const SELECT_MSG_INT = `
  SELECT m.id, m.mensaje, m.foto, m.orden_id, m.tipo, m.created_at,
         m.remitente_id, m.destino_rol, m.destino_id, m.sucursal_id,
         ru.nombre AS remitente_nombre, ru.rol AS remitente_rol, ru.sucursal_id AS remitente_sucursal_id,
         du.nombre AS destino_nombre, du.sucursal_id AS destino_sucursal_id,
         o.numero_orden,
         COALESCE(sm.nombre, sr.nombre, sd.nombre) AS sucursal_nombre,
         ${LEIDO_POR_MI}, ${VISTO_POR_OTRO}
  FROM mensajes_internos m
  JOIN usuarios ru ON ru.id = m.remitente_id AND ru.tenant_id = @tenant
  LEFT JOIN usuarios du ON du.id = m.destino_id AND du.tenant_id = @tenant
  LEFT JOIN ordenes_trabajo o ON o.id = m.orden_id AND o.tenant_id = @tenant
  LEFT JOIN sucursales sm ON sm.id = m.sucursal_id AND sm.tenant_id = @tenant
  LEFT JOIN sucursales sr ON sr.id = ru.sucursal_id AND sr.tenant_id = @tenant
  LEFT JOIN sucursales sd ON sd.id = du.sucursal_id AND sd.tenant_id = @tenant`;

// Bandeja de la oficina, separada por rol del que consulta:
//  · admin ve el bolsón 'admin' (lo que los mecánicos le mandan a admin + sus hilos)
//  · recepción ve el bolsón 'recepcion', filtrado por su sucursal
// "Lado oficina" de un mensaje = el rol del remitente si es oficina; si lo mandó un
// mecánico, el bolsón al que escribió (destino_rol).
router.get('/mensajes-internos', async (req, res) => {
  try {
    const yo = req.usuario.id;
    const [[me]] = await req.db.query('SELECT rol, sucursal_id FROM usuarios WHERE id = ? AND tenant_id = @tenant', [yo]);
    const rol = me.rol === 'admin' ? 'admin' : 'recepcion';
    const params = [yo, rol, rol];
    let where = `WHERE m.tenant_id = @tenant AND ( (ru.rol = 'tecnico' AND m.destino_rol = ? AND m.tipo <> 'broadcast') OR ru.rol = ? )`;
    if (rol === 'recepcion' && me.sucursal_id) {
      where += ' AND (m.sucursal_id = ? OR m.sucursal_id IS NULL)';
      params.push(me.sucursal_id);
    }
    const [rows] = await req.db.query(`${SELECT_MSG_INT} ${where} ORDER BY m.created_at DESC LIMIT 100`, params);
    await marcarLeidos(req.db, yo, rows);
    res.json({ data: rows });
  } catch (err) {
    fail(res, err);
  }
});

router.get('/mensajes-internos/no-leidos', async (req, res) => {
  try {
    const yo = req.usuario.id;
    const [[me]] = await req.db.query('SELECT rol, sucursal_id FROM usuarios WHERE id = ? AND tenant_id = @tenant', [yo]);
    const rol = me.rol === 'admin' ? 'admin' : 'recepcion';
    // Solo cuentan los mensajes que un mecánico mandó a mi bolsón y que yo no leí.
    const params = [rol, yo, yo];
    let where = `WHERE m.tenant_id = @tenant AND ru.rol = 'tecnico' AND m.destino_rol = ? AND m.tipo <> 'broadcast'
                 AND m.remitente_id <> ?
                 AND NOT EXISTS(SELECT 1 FROM mensaje_lecturas ml WHERE ml.mensaje_id = m.id AND ml.usuario_id = ? AND ml.tenant_id = @tenant)`;
    if (rol === 'recepcion' && me.sucursal_id) {
      where += ' AND (m.sucursal_id = ? OR m.sucursal_id IS NULL)';
      params.push(me.sucursal_id);
    }
    const [[{ count }]] = await req.db.query(
      `SELECT COUNT(*) AS count FROM mensajes_internos m JOIN usuarios ru ON ru.id = m.remitente_id AND ru.tenant_id = @tenant ${where}`,
      params
    );
    res.json({ data: { count } });
  } catch (err) {
    fail(res, err);
  }
});

router.post('/mensajes-internos', async (req, res) => {
  try {
    const { destino_id, mensaje, foto, orden_id } = req.body;
    if (!destino_id || ((!mensaje || !mensaje.trim()) && !foto)) {
      return res.status(400).json({ error: 'Destinatario y mensaje (o foto) son requeridos' });
    }
    if (!fotoValida(foto)) return res.status(400).json({ error: 'Imagen inválida' });
    // La sede del mensaje = la del mecánico destinatario (para el filtro por sucursal).
    const [r] = await req.db.query(
      `INSERT INTO mensajes_internos (tenant_id, remitente_id, destino_id, mensaje, foto, orden_id, sucursal_id)
       VALUES (@tenant, ?, ?, ?, ?, ?,
               (SELECT sucursal_id FROM usuarios WHERE id = ? AND tenant_id = @tenant))`,
      [req.usuario.id, destino_id, (mensaje || '').trim(), foto || null, orden_id || null, destino_id]
    );
    const [[nuevo]] = await req.db.query(`${SELECT_MSG_INT} WHERE m.id = ?`, [req.usuario.id, r.insertId]);
    res.status(201).json({ data: nuevo, message: 'Respuesta enviada' });
  } catch (err) {
    fail(res, err);
  }
});

router.post('/mensajes-internos/broadcast', async (req, res) => {
  try {
    const { mensaje, foto } = req.body;
    if ((!mensaje || !mensaje.trim()) && !foto) {
      return res.status(400).json({ error: 'El mensaje o una foto es requerido' });
    }
    if (!fotoValida(foto)) return res.status(400).json({ error: 'Imagen inválida' });
    const [r] = await req.db.query(
      "INSERT INTO mensajes_internos (tenant_id, remitente_id, destino_rol, tipo, mensaje, foto) VALUES (@tenant, ?, 'tecnico', 'broadcast', ?, ?)",
      [req.usuario.id, (mensaje || '').trim(), foto || null]
    );
    const [[nuevo]] = await req.db.query(`${SELECT_MSG_INT} WHERE m.id = ?`, [req.usuario.id, r.insertId]);
    res.status(201).json({ data: nuevo, message: 'Mensaje enviado a todos los mecánicos' });
  } catch (err) {
    fail(res, err);
  }
});

module.exports = router;
