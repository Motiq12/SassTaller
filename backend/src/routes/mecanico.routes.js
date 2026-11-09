const router = require('express').Router();
// Sin `pool`: todo el acceso pasa por req.db, scopeado al taller.
const { fail } = require('../utils/responder');
const auth = require('../middleware/auth');
const requireRol = require('../middleware/roles');
const { notificarCambioEstado } = require('../utils/notificaciones');
const { TRANSICIONES_CITA, transicionPermitida } = require('../utils/transiciones');
const { LEIDO_POR_MI, VISTO_POR_OTRO, marcarLeidos } = require('../utils/mensajes');

// Panel del mecánico: opera sobre SUS citas asignadas. Accesible a técnico o superior.
router.use(auth, requireRol('tecnico'));
// Foto y contraseña propias: el mismo tramo que monta el panel de recepción.
router.use(require('./perfil-propio.routes'));

const ESTADOS = ['agendado', 'en_revision', 'en_mantenimiento', 'listo', 'entregado', 'cancelado'];
const EN_PROCESO = ['en_revision', 'en_mantenimiento'];

// Campos que devuelve cada cita del mecánico (con datos de moto y cliente).
const SELECT_CITA = `
  SELECT ci.id, to_char(ci.fecha, 'YYYY-MM-DD') AS fecha, to_char(ci.hora, 'HH24:MI') AS hora,
         ci.motivo, ci.tipo_servicio, ci.estado,
         ci.monto, ci.calificacion, ci.comentario_satisfaccion, ci.fecha_inicio, ci.fecha_fin,
         ci.confirmada_cliente,
         ci.orden_id, o.numero_orden, o.estado AS orden_estado,
         o.aprobacion_cliente, o.motivo_rechazo,
         (o.costo_mano_obra + o.costo_repuestos - o.descuento) AS orden_total,
         m.marca, m.modelo, m.placa,
         c.nombre AS cliente_nombre, c.apellido AS cliente_apellido, c.telefono AS cliente_telefono
  FROM citas ci
  LEFT JOIN vehiculos m    ON m.id = ci.vehiculo_id AND m.tenant_id = @tenant
  JOIN clientes c      ON c.id = ci.cliente_id AND c.tenant_id = @tenant
  LEFT JOIN ordenes_trabajo o ON o.id = ci.orden_id AND o.tenant_id = @tenant`;

// GET /api/mecanico/resumen — KPIs del técnico logueado
router.get('/resumen', async (req, res) => {
  try {
    const yo = req.usuario.id;
    const [[{ citas_hoy }]] = await req.db.query(
      'SELECT COUNT(*) AS citas_hoy FROM citas WHERE tenant_id = @tenant AND tecnico_id = ? AND fecha = CURRENT_DATE',
      [yo]
    );
    const [[{ completadas_hoy }]] = await req.db.query(
      "SELECT COUNT(*) AS completadas_hoy FROM citas WHERE tenant_id = @tenant AND tecnico_id = ? AND estado = 'entregado' AND DATE(fecha_fin) = CURRENT_DATE",
      [yo]
    );
    const [[{ en_proceso }]] = await req.db.query(
      "SELECT COUNT(*) AS en_proceso FROM citas WHERE tenant_id = @tenant AND tecnico_id = ? AND estado IN ('en_revision','en_mantenimiento')",
      [yo]
    );
    const [[{ monto_promedio }]] = await req.db.query(
      "SELECT COALESCE(AVG(monto), 0) AS monto_promedio FROM citas WHERE tenant_id = @tenant AND tecnico_id = ? AND estado = 'entregado' AND monto > 0",
      [yo]
    );
    const [[{ generado_hoy }]] = await req.db.query(
      "SELECT COALESCE(SUM(monto), 0) AS generado_hoy FROM citas WHERE tenant_id = @tenant AND tecnico_id = ? AND estado = 'entregado' AND DATE(fecha_fin) = CURRENT_DATE",
      [yo]
    );
    const [[{ tiempo_promedio_min }]] = await req.db.query(
      `SELECT ROUND(AVG(TRUNC(EXTRACT(EPOCH FROM (COALESCE(fecha_listo, fecha_fin)) - (fecha_inicio)) / 60))) AS tiempo_promedio_min
       FROM citas WHERE tenant_id = @tenant AND tecnico_id = ? AND estado = 'entregado' AND fecha_inicio IS NOT NULL AND (fecha_listo IS NOT NULL OR fecha_fin IS NOT NULL)`,
      [yo]
    );
    const [[calif]] = await req.db.query(
      'SELECT ROUND(AVG(calificacion), 1) AS promedio, COUNT(calificacion) AS total FROM citas WHERE tenant_id = @tenant AND tecnico_id = ? AND calificacion IS NOT NULL',
      [yo]
    );
    res.json({
      data: {
        citas_hoy,
        completadas_hoy,
        en_proceso,
        monto_promedio,
        generado_hoy,
        tiempo_promedio_min: tiempo_promedio_min || 0,
        calificacion_promedio: calif.promedio,
        calificacion_total: calif.total,
      },
    });
  } catch (err) {
    fail(res, err);
  }
});

// GET /api/mecanico/citas?fecha=&estado= — citas asignadas a mí
router.get('/citas', async (req, res) => {
  try {
    const { fecha, estado } = req.query;
    let sql = `${SELECT_CITA} WHERE ci.tenant_id = @tenant AND ci.tecnico_id = ?`;
    const params = [req.usuario.id];
    if (fecha) { sql += ' AND ci.fecha = ?'; params.push(fecha); }
    if (estado) { sql += ' AND ci.estado = ?'; params.push(estado); }
    sql += ' ORDER BY ci.fecha ASC, ci.hora ASC';
    const [rows] = await req.db.query(sql, params);
    res.json({ data: rows });
  } catch (err) {
    fail(res, err);
  }
});

// GET /api/mecanico/agenda?desde=&hasta= — mis citas en un rango (agenda de la semana)
router.get('/agenda', async (req, res) => {
  try {
    const { desde, hasta } = req.query;
    if (!desde || !hasta) return res.status(400).json({ error: 'desde y hasta son requeridos' });
    const [rows] = await req.db.query(
      `${SELECT_CITA} WHERE ci.tenant_id = @tenant AND ci.tecnico_id = ? AND ci.fecha BETWEEN ? AND ?
       ORDER BY ci.fecha ASC, ci.hora ASC`,
      [req.usuario.id, desde, hasta]
    );
    res.json({ data: rows });
  } catch (err) {
    fail(res, err);
  }
});

// PATCH /api/mecanico/citas/:id/estado — cambia estado de MI cita (+ monto opcional)
router.patch('/citas/:id/estado', async (req, res) => {
  try {
    const { estado, monto } = req.body;
    if (!ESTADOS.includes(estado)) return res.status(400).json({ error: 'Estado inválido' });

    const [[cita]] = await req.db.query(
      'SELECT id, estado, orden_id FROM citas WHERE tenant_id = @tenant AND id = ? AND tecnico_id = ?',
      [req.params.id, req.usuario.id]
    );
    if (!cita) return res.status(404).json({ error: 'Cita no encontrada o no asignada a vos' });

    if (cita.orden_id) {
      return res.status(400).json({ error: 'Esta cita tiene una orden vinculada. Cambiá el estado desde la orden.' });
    }

    if (!transicionPermitida(TRANSICIONES_CITA, cita.estado, estado)) {
      return res.status(400).json({ error: `Transición no permitida: ${cita.estado} → ${estado}` });
    }

    // Marca inicio al arrancar el trabajo y fin al entregar.
    const arrancaTrabajo = cita.estado === 'agendado' && estado !== 'agendado' && estado !== 'cancelado';
    const sets = ['estado = ?'];
    const params = [estado];
    if (arrancaTrabajo) sets.push('fecha_inicio = COALESCE(fecha_inicio, NOW())');
    if (estado === 'listo') sets.push('fecha_listo = COALESCE(fecha_listo, NOW())');
    if (estado === 'entregado') sets.push('fecha_fin = NOW()');
    if (monto !== undefined && monto !== null && monto !== '') {
      sets.push('monto = ?');
      params.push(Number(monto) || 0);
    }
    params.push(req.params.id);

    await req.db.query(`UPDATE citas SET ${sets.join(', ')} WHERE id = ? AND tenant_id = @tenant`, params);
    await notificarCambioEstado(req.db, req.params.id, estado);
    res.json({ message: 'Estado actualizado' });
  } catch (err) {
    fail(res, err);
  }
});

// ───────────────────────────────────────────────────────────
// Solicitar repuestos (el mecánico pide, recepción pone precio)
// ───────────────────────────────────────────────────────────
router.post('/ordenes/:id/repuestos', async (req, res) => {
  try {
    const { nombre, cantidad } = req.body;
    if (!nombre || !nombre.trim()) return res.status(400).json({ error: 'Nombre del repuesto requerido' });
    const [[orden]] = await req.db.query(
      'SELECT id FROM ordenes_trabajo WHERE tenant_id = @tenant AND id = ? AND tecnico_id = ?',
      [req.params.id, req.usuario.id]
    );
    if (!orden) return res.status(404).json({ error: 'Orden no encontrada o no asignada a vos' });
    const [result] = await req.db.query(
      "INSERT INTO orden_repuestos (tenant_id,orden_id, nombre, cantidad, costo_unitario, estado) VALUES (@tenant, ?, ?, ?, 0, 'solicitado')",
      [req.params.id, nombre.trim(), cantidad || 1]
    );
    const [[nuevo]] = await req.db.query('SELECT * FROM orden_repuestos WHERE tenant_id = @tenant AND id = ?', [result.insertId]);
    // Notificar a recepción vía mensaje interno
    const [[ordenInfo]] = await req.db.query(
      'SELECT numero_orden FROM ordenes_trabajo WHERE tenant_id = @tenant AND id = ?', [req.params.id]
    );
    const piezas = `${nombre.trim()} ×${cantidad || 1}`;
    await req.db.query(
      `INSERT INTO mensajes_internos (tenant_id,remitente_id, destino_rol, mensaje, orden_id, tipo, sucursal_id)
       VALUES (@tenant, ?, 'recepcion', ?, ?, 'directo', (SELECT sucursal_id FROM usuarios WHERE id = ?))`,
      [req.usuario.id, `Solicitud de repuesto: ${piezas}`, req.params.id, req.usuario.id]
    );
    res.status(201).json({ data: nuevo, message: 'Repuesto solicitado' });
  } catch (err) {
    fail(res, err);
  }
});

// ───────────────────────────────────────────────────────────
// Tareas pendientes del mecánico (checklist propio)
// ───────────────────────────────────────────────────────────
router.get('/tareas', async (req, res) => {
  try {
    const [rows] = await req.db.query(
      `SELECT t.*, a.nombre AS asignado_por_nombre
       FROM tareas_mecanico t
       LEFT JOIN usuarios a ON a.id = t.asignado_por AND a.tenant_id = @tenant
       WHERE t.tenant_id = @tenant AND t.tecnico_id = ?
       ORDER BY t.hecha ASC, array_position(ARRAY['urgente', 'alta', 'normal', 'baja']::text[], t.prioridad::text),
                (t.vence IS NULL), t.vence ASC, t.created_at DESC`,
      [req.usuario.id]
    );
    res.json({ data: rows });
  } catch (err) {
    fail(res, err);
  }
});

router.post('/tareas', async (req, res) => {
  try {
    const { titulo, detalle, prioridad } = req.body;
    if (!titulo || !titulo.trim()) return res.status(400).json({ error: 'El título es requerido' });
    const prio = ['baja', 'normal', 'alta', 'urgente'].includes(prioridad) ? prioridad : 'normal';
    const [r] = await req.db.query(
      'INSERT INTO tareas_mecanico (tenant_id,tecnico_id, titulo, detalle, prioridad) VALUES (@tenant, ?, ?, ?, ?)',
      [req.usuario.id, titulo.trim(), (detalle || '').trim() || null, prio]
    );
    const [[nueva]] = await req.db.query('SELECT * FROM tareas_mecanico WHERE tenant_id = @tenant AND id = ?', [r.insertId]);
    res.status(201).json({ data: nueva, message: 'Tarea creada' });
  } catch (err) {
    fail(res, err);
  }
});

// Alterna (o fija) el estado "hecha" de una tarea propia.
router.patch('/tareas/:id', async (req, res) => {
  try {
    const [[t]] = await req.db.query('SELECT id, hecha FROM tareas_mecanico WHERE tenant_id = @tenant AND id = ? AND tecnico_id = ?', [req.params.id, req.usuario.id]);
    if (!t) return res.status(404).json({ error: 'Tarea no encontrada' });
    const hecha = req.body.hecha !== undefined ? (req.body.hecha ? 1 : 0) : (t.hecha ? 0 : 1);
    await req.db.query('UPDATE tareas_mecanico SET hecha = ? WHERE tenant_id = @tenant AND id = ?', [hecha, req.params.id]);
    res.json({ data: { id: Number(req.params.id), hecha }, message: 'Tarea actualizada' });
  } catch (err) {
    fail(res, err);
  }
});

router.delete('/tareas/:id', async (req, res) => {
  try {
    // El técnico solo borra sus propias tareas; las asignadas por el admin las completa, no las borra.
    await req.db.query(
      'DELETE FROM tareas_mecanico WHERE tenant_id = @tenant AND id = ? AND tecnico_id = ? AND asignado_por IS NULL',
      [req.params.id, req.usuario.id]
    );
    res.json({ message: 'Tarea eliminada' });
  } catch (err) {
    fail(res, err);
  }
});

// ───────────────────────────────────────────────────────────
// Mensajería con recepción
// @deprecated — el chat del personal migró a /api/mensajeria (1:1 por persona).
// Estos endpoints de buzón por rol quedan operativos por compatibilidad y se
// eliminarán en un release futuro. No agregar features acá.
// ───────────────────────────────────────────────────────────
// El fragmento LEIDO_POR_MI trae un `?` (mi id): va SIEMPRE como primer parámetro.
const SELECT_MENSAJE = `
  SELECT m.id, m.mensaje, m.foto, m.orden_id, m.tipo, m.created_at,
         m.remitente_id, m.destino_rol, m.destino_id,
         u.nombre AS remitente_nombre, u.rol AS remitente_rol,
         o.numero_orden,
         ${LEIDO_POR_MI}, ${VISTO_POR_OTRO}
  FROM mensajes_internos m
  JOIN usuarios u ON u.id = m.remitente_id AND u.tenant_id = @tenant
  LEFT JOIN ordenes_trabajo o ON o.id = m.orden_id AND o.tenant_id = @tenant`;

router.get('/mensajes', async (req, res) => {
  try {
    const yo = req.usuario.id;
    const [rows] = await req.db.query(
      `${SELECT_MENSAJE}
       WHERE m.tenant_id = @tenant
         AND (m.remitente_id = ? OR m.destino_id = ? OR (m.tipo = 'broadcast' AND m.destino_rol = 'tecnico'))
       ORDER BY m.created_at ASC LIMIT 100`,
      [yo, yo, yo]
    );
    await marcarLeidos(req.db, yo, rows);
    res.json({ data: rows });
  } catch (err) {
    fail(res, err);
  }
});

router.get('/mensajes/no-leidos', async (req, res) => {
  try {
    const yo = req.usuario.id;
    const [[{ count }]] = await req.db.query(
      `SELECT COUNT(*) AS count FROM mensajes_internos m
       WHERE m.tenant_id = @tenant AND (m.destino_id = ? OR (m.tipo = 'broadcast' AND m.destino_rol = 'tecnico'))
         AND m.remitente_id <> ?
         AND NOT EXISTS(SELECT 1 FROM mensaje_lecturas ml WHERE ml.mensaje_id = m.id AND ml.usuario_id = ? AND ml.tenant_id = @tenant)`,
      [yo, yo, yo]
    );
    res.json({ data: { count } });
  } catch (err) {
    fail(res, err);
  }
});

router.post('/mensajes', async (req, res) => {
  try {
    const { mensaje, foto, orden_id, destino } = req.body;
    if ((!mensaje || !mensaje.trim()) && !foto) return res.status(400).json({ error: 'El mensaje o una foto es requerido' });
    // El mecánico elige a quién escribe: recepción (default) o admin.
    const destino_rol = destino === 'admin' ? 'admin' : 'recepcion';
    const [[me]] = await req.db.query('SELECT sucursal_id FROM usuarios WHERE tenant_id = @tenant AND id = ?', [req.usuario.id]);
    const [r] = await req.db.query(
      "INSERT INTO mensajes_internos (tenant_id,remitente_id, destino_rol, mensaje, foto, orden_id, sucursal_id, tipo) VALUES (@tenant, ?, ?, ?, ?, ?, ?, 'directo')",
      [req.usuario.id, destino_rol, (mensaje || '').trim(), foto || null, orden_id || null, me?.sucursal_id || null]
    );
    const [[nuevo]] = await req.db.query(`${SELECT_MENSAJE} WHERE m.tenant_id = @tenant AND m.id = ?`, [req.usuario.id, r.insertId]);
    res.status(201).json({ data: nuevo, message: 'Mensaje enviado' });
  } catch (err) {
    fail(res, err);
  }
});

router.get('/recepcion-contacto', async (req, res) => {
  try {
    const [rows] = await req.db.query(
      "SELECT id, nombre, telefono, foto FROM usuarios WHERE tenant_id = @tenant AND rol = 'recepcion' AND activo = 1 ORDER BY nombre"
    );
    res.json({ data: rows.length ? rows[0] : null, equipo: rows });
  } catch (err) {
    fail(res, err);
  }
});

// ───────────────────────────────────────────────────────────
// Perfil del mecánico (datos + estadísticas + calificaciones)
// ───────────────────────────────────────────────────────────
router.get('/perfil', async (req, res) => {
  try {
    const yo = req.usuario.id;
    const [[u]] = await req.db.query(
      `SELECT u.id, u.nombre, u.email, u.rol, u.telefono, u.especialidades, u.horario, u.created_at,
              s.nombre AS sucursal_nombre, s.direccion AS sucursal_direccion
       FROM usuarios u LEFT JOIN sucursales s ON s.id = u.sucursal_id AND s.tenant_id = @tenant WHERE u.tenant_id = @tenant AND u.id = ?`, [yo]);
    const [[g]] = await req.db.query(
      `SELECT COUNT(*) AS completadas, COALESCE(SUM(monto), 0) AS ingresos_generados,
              ROUND(AVG(TRUNC(EXTRACT(EPOCH FROM (COALESCE(fecha_listo, fecha_fin)) - (fecha_inicio)) / 60))) AS tiempo_promedio_min
       FROM citas WHERE tenant_id = @tenant AND tecnico_id = ? AND estado = 'entregado'`,
      [yo]
    );
    const [[calif]] = await req.db.query(
      'SELECT ROUND(AVG(calificacion), 1) AS promedio, COUNT(calificacion) AS total FROM citas WHERE tenant_id = @tenant AND tecnico_id = ? AND calificacion IS NOT NULL',
      [yo]
    );
    const [[sat]] = await req.db.query(
      'SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE calificacion >= 4) AS buenas FROM citas WHERE tenant_id = @tenant AND tecnico_id = ? AND calificacion IS NOT NULL',
      [yo]
    );
    const satisfechos_pct = sat.total ? Math.round((sat.buenas / sat.total) * 100) : null;
    const [[mes]] = await req.db.query(
      `SELECT COUNT(*) AS citas_mes, COALESCE(SUM(monto), 0) AS ingresos_mes
       FROM citas WHERE tenant_id = @tenant AND tecnico_id = ? AND estado = 'entregado'
         AND date_trunc('month', fecha_fin) = date_trunc('month', CURRENT_DATE)`,
      [yo]
    );
    const [calificaciones] = await req.db.query(
      `SELECT ci.calificacion, ci.comentario_satisfaccion, ci.tipo_servicio, ci.fecha_fin,
              c.nombre AS cliente_nombre, c.apellido AS cliente_apellido
       FROM citas ci JOIN clientes c ON c.id = ci.cliente_id AND c.tenant_id = @tenant
       WHERE ci.tenant_id = @tenant AND ci.tecnico_id = ? AND ci.calificacion IS NOT NULL
       ORDER BY ci.fecha_fin DESC LIMIT 8`,
      [yo]
    );
    res.json({
      data: {
        ...u,
        especialidades_list: u.especialidades ? u.especialidades.split(',').map(s => s.trim()).filter(Boolean) : [],
        completadas: g.completadas,
        ingresos_generados: g.ingresos_generados,
        tiempo_promedio_min: g.tiempo_promedio_min || 0,
        calificacion_promedio: calif.promedio,
        calificacion_total: calif.total,
        satisfechos_pct,
        citas_mes: mes.citas_mes,
        ingresos_mes: mes.ingresos_mes,
        calificaciones,
      },
    });
  } catch (err) {
    fail(res, err);
  }
});

// El mecánico edita su propio perfil (teléfono, especialidades, horario).
router.patch('/perfil', async (req, res) => {
  try {
    const { telefono, especialidades, horario } = req.body;
    await req.db.query(
      'UPDATE usuarios SET telefono = ?, especialidades = ?, horario = ? WHERE tenant_id = @tenant AND id = ?',
      [telefono || null, especialidades || null, horario || null, req.usuario.id]
    );
    res.json({ message: 'Perfil actualizado' });
  } catch (err) {
    fail(res, err);
  }
});

// Alertas del mecánico: mensajes no leídos + citas asignadas recientes + cambios en órdenes
router.get('/alertas', async (req, res) => {
  try {
    const yo = req.usuario.id;
    const [mensajes] = await req.db.query(
      `SELECT 'mensaje' AS tipo, m.created_at, m.mensaje AS texto,
              u.nombre AS remitente_nombre
       FROM mensajes_internos m
       JOIN usuarios u ON u.id = m.remitente_id AND u.tenant_id = @tenant
       WHERE m.tenant_id = @tenant AND (m.destino_id = ? OR (m.tipo = 'broadcast' AND m.destino_rol = 'tecnico'))
         AND m.remitente_id != ?
         AND m.created_at >= NOW() - INTERVAL '24 hours'
       ORDER BY m.created_at DESC LIMIT 10`,
      [yo, yo]
    );
    const [citas] = await req.db.query(
      `SELECT 'cita_asignada' AS tipo, ci.created_at,
              to_char(ci.fecha, 'YYYY-MM-DD') AS fecha, to_char(ci.hora, 'HH24:MI') AS hora,
              ci.tipo_servicio, m.marca, m.modelo
       FROM citas ci
       LEFT JOIN vehiculos m ON m.id = ci.vehiculo_id AND m.tenant_id = @tenant
       WHERE ci.tenant_id = @tenant AND ci.tecnico_id = ? AND ci.created_at >= NOW() - INTERVAL '24 hours'
       ORDER BY ci.created_at DESC LIMIT 10`,
      [yo]
    );
    const [ordenes] = await req.db.query(
      `SELECT 'orden_estado' AS tipo, o.updated_at AS created_at,
              o.numero_orden, o.id AS orden_id, o.estado,
              o.aprobacion_cliente, m.marca, m.modelo
       FROM ordenes_trabajo o
       JOIN vehiculos m ON m.id = o.vehiculo_id AND m.tenant_id = @tenant
       WHERE o.tenant_id = @tenant AND o.tecnico_id = ? AND o.updated_at >= NOW() - INTERVAL '24 hours'
         AND o.estado NOT IN ('recepcion')
       ORDER BY o.updated_at DESC LIMIT 10`,
      [yo]
    );
    const todas = [...mensajes, ...citas, ...ordenes]
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 20);
    res.json({ data: todas });
  } catch (err) {
    fail(res, err);
  }
});

// La foto y la contraseña propias las sirve el tramo compartido (montado arriba).

module.exports = router;
