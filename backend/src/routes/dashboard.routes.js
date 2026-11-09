const router = require('express').Router();
// Sin `pool`: todo el acceso pasa por req.db, scopeado al taller.
const { fail } = require('../utils/responder');
const auth = require('../middleware/auth');
const requireRol = require('../middleware/roles');

router.use(auth, requireRol('admin'));

router.get('/resumen', async (req, res) => {
  try {
    const [[{ motos_activas }]] = await req.db.query(
      "SELECT COUNT(*) AS motos_activas FROM ordenes_trabajo WHERE tenant_id = @tenant AND estado NOT IN ('entregada','cancelada')"
    );
    const [[{ motos_atrasadas }]] = await req.db.query(
      "SELECT COUNT(*) AS motos_atrasadas FROM ordenes_trabajo WHERE tenant_id = @tenant AND estado NOT IN ('entregada','cancelada') AND fecha_estimada_entrega < CURRENT_DATE"
    );
    const [[{ facturacion_hoy }]] = await req.db.query(
      "SELECT COALESCE(SUM(costo_mano_obra + costo_repuestos - descuento), 0) AS facturacion_hoy FROM ordenes_trabajo WHERE tenant_id = @tenant AND DATE(fecha_entrega_real) = CURRENT_DATE AND estado = 'entregada'"
    );
    const [[{ facturacion_semana }]] = await req.db.query(
      "SELECT COALESCE(SUM(costo_mano_obra + costo_repuestos - descuento), 0) AS facturacion_semana FROM ordenes_trabajo WHERE tenant_id = @tenant AND estado = 'entregada' AND date_trunc('week', fecha_entrega_real) = date_trunc('week', CURRENT_DATE)"
    );
    const [[{ facturacion_mes }]] = await req.db.query(
      "SELECT COALESCE(SUM(costo_mano_obra + costo_repuestos - descuento), 0) AS facturacion_mes FROM ordenes_trabajo WHERE tenant_id = @tenant AND estado = 'entregada' AND date_trunc('month', fecha_entrega_real) = date_trunc('month', CURRENT_DATE)"
    );
    // Facturación TOTAL del mes = órdenes + citas, sin doble conteo (una orden ligada
    // a una cita cuenta por la cita). Mismo criterio que el PDF / admin resumen.
    const [[{ facturacion_mes_total }]] = await req.db.query(
      `SELECT
         (SELECT COALESCE(SUM(monto),0) FROM citas
            WHERE tenant_id = @tenant AND estado='entregado' AND date_trunc('month', fecha_fin) = date_trunc('month', CURRENT_DATE))
       + (SELECT COALESCE(SUM(costo_mano_obra + costo_repuestos - descuento),0) FROM ordenes_trabajo
            WHERE tenant_id = @tenant AND estado='entregada' AND date_trunc('month', fecha_entrega_real) = date_trunc('month', CURRENT_DATE)
              AND id NOT IN (SELECT orden_id FROM citas WHERE orden_id IS NOT NULL AND tenant_id = @tenant)) AS facturacion_mes_total`
    );
    const [[{ ticket_promedio }]] = await req.db.query(
      "SELECT COALESCE(AVG(costo_mano_obra + costo_repuestos - descuento), 0) AS ticket_promedio FROM ordenes_trabajo WHERE tenant_id = @tenant AND estado = 'entregada'"
    );
    const [[{ tiempo_promedio_horas }]] = await req.db.query(
      "SELECT ROUND(AVG(TRUNC(EXTRACT(EPOCH FROM (fecha_entrega_real) - (fecha_ingreso)) / 3600)), 1) AS tiempo_promedio_horas FROM ordenes_trabajo WHERE tenant_id = @tenant AND estado = 'entregada' AND fecha_entrega_real IS NOT NULL"
    );
    // Ingresos por citas (lo que cobra el mecánico al entregar una cita).
    // Es un canal de facturación distinto al de las órdenes de trabajo.
    const [[{ ingresos_citas_hoy }]] = await req.db.query(
      "SELECT COALESCE(SUM(monto), 0) AS ingresos_citas_hoy FROM citas WHERE tenant_id = @tenant AND estado = 'entregado' AND DATE(fecha_fin) = CURRENT_DATE"
    );
    const [[{ ingresos_citas_mes }]] = await req.db.query(
      "SELECT COALESCE(SUM(monto), 0) AS ingresos_citas_mes FROM citas WHERE tenant_id = @tenant AND estado = 'entregado' AND date_trunc('month', fecha_fin) = date_trunc('month', CURRENT_DATE)"
    );
    const [[{ citas_entregadas_mes }]] = await req.db.query(
      "SELECT COUNT(*) AS citas_entregadas_mes FROM citas WHERE tenant_id = @tenant AND estado = 'entregado' AND date_trunc('month', fecha_fin) = date_trunc('month', CURRENT_DATE)"
    );
    const [[{ repuestos_pendientes }]] = await req.db.query(
      "SELECT COUNT(*) AS repuestos_pendientes FROM orden_repuestos r JOIN ordenes_trabajo o ON o.id = r.orden_id AND o.tenant_id = @tenant WHERE r.tenant_id = @tenant AND r.estado IN ('pendiente','pedido_especial') AND o.estado NOT IN ('entregada','cancelada')"
    );
    // Satisfacción: el cliente califica sobre todo en la CITA (citas.calificacion),
    // no en la orden. Unimos citas + órdenes sin doble conteo (una orden ligada a una
    // cita cuenta solo por la cita), igual que el feed de opiniones. Antes solo miraba
    // ordenes_trabajo y por eso el KPI salía vacío ("—").
    const [[satisfaccion]] = await req.db.query(
      `SELECT ROUND(AVG(calificacion), 1) AS promedio, COUNT(calificacion) AS total
       FROM (
         SELECT c.calificacion FROM citas c
           WHERE c.tenant_id = @tenant AND c.calificacion IS NOT NULL AND c.calificacion > 0
         UNION ALL
         SELECT o.calificacion FROM ordenes_trabajo o
           WHERE o.tenant_id = @tenant AND o.calificacion IS NOT NULL AND o.calificacion > 0
             AND o.id NOT IN (SELECT orden_id FROM citas WHERE orden_id IS NOT NULL AND tenant_id = @tenant)
       ) x`
    );
    const [[conversion]] = await req.db.query(
      `SELECT
         (SELECT COUNT(DISTINCT orden_id) FROM orden_tiempos WHERE tenant_id = @tenant AND etapa = 'diagnostico') AS con_diagnostico,
         (SELECT COUNT(DISTINCT orden_id) FROM orden_tiempos WHERE tenant_id = @tenant AND etapa = 'en_reparacion') AS con_reparacion`
    );
    const conversion_pct = conversion.con_diagnostico > 0
      ? Math.round((conversion.con_reparacion / conversion.con_diagnostico) * 100)
      : 0;
    const [ordenes_por_estado] = await req.db.query(
      "SELECT estado, COUNT(*) AS total FROM ordenes_trabajo WHERE tenant_id = @tenant AND estado NOT IN ('entregada','cancelada') GROUP BY estado"
    );
    res.json({
      data: {
        motos_activas,
        motos_atrasadas,
        facturacion_hoy,
        facturacion_semana,
        facturacion_mes,
        facturacion_mes_total,
        ingresos_citas_hoy,
        ingresos_citas_mes,
        citas_entregadas_mes,
        ticket_promedio,
        tiempo_promedio_horas,
        repuestos_pendientes,
        conversion_pct,
        satisfaccion_promedio: satisfaccion.promedio,
        satisfaccion_total: satisfaccion.total,
        ordenes_por_estado,
      },
    });
  } catch (err) {
    fail(res, err);
  }
});

// GET /api/dashboard/atrasos — órdenes activas con semáforo de entrega
router.get('/atrasos', async (req, res) => {
  try {
    const [rows] = await req.db.query(
      `SELECT o.id, o.numero_orden, o.estado, o.fecha_estimada_entrega,
              (o.fecha_estimada_entrega::date - CURRENT_DATE::date) AS dias_restantes,
              m.marca, m.modelo, m.placa,
              c.nombre AS cliente_nombre, c.apellido AS cliente_apellido,
              t.nombre AS tecnico_nombre
       FROM ordenes_trabajo o
       JOIN vehiculos m    ON m.id = o.vehiculo_id AND m.tenant_id = @tenant
       JOIN clientes c ON c.id = o.cliente_id AND c.tenant_id = @tenant
       LEFT JOIN usuarios t ON t.id = o.tecnico_id AND t.tenant_id = @tenant
       WHERE o.tenant_id = @tenant AND o.estado NOT IN ('entregada','cancelada')
       ORDER BY (o.fecha_estimada_entrega IS NULL), o.fecha_estimada_entrega ASC`
    );
    res.json({ data: rows });
  } catch (err) {
    fail(res, err);
  }
});

router.get('/tecnicos', async (req, res) => {
  try {
    const [rows] = await req.db.query(
      `SELECT u.id, u.nombre,
              COUNT(ot.id) AS ordenes_completadas,
              ROUND(AVG(TRUNC(EXTRACT(EPOCH FROM (ot.fecha_entrega_real) - (ot.fecha_ingreso)) / 3600)), 1) AS horas_promedio
       FROM usuarios u
       LEFT JOIN ordenes_trabajo ot ON ot.tecnico_id = u.id AND ot.estado = 'entregada' AND ot.tenant_id = @tenant
       WHERE u.tenant_id = @tenant AND u.rol = 'tecnico' AND u.activo = 1
       GROUP BY u.id, u.nombre
       ORDER BY ordenes_completadas DESC`
    );
    res.json({ data: rows });
  } catch (err) {
    fail(res, err);
  }
});

router.get('/tiempos', async (req, res) => {
  try {
    const [rows] = await req.db.query(
      `SELECT etapa,
              COUNT(*) AS total,
              ROUND(AVG(TRUNC(EXTRACT(EPOCH FROM (COALESCE(fin, NOW())) - (inicio)) / 3600)), 1) AS horas_promedio
       FROM orden_tiempos WHERE tenant_id = @tenant
       GROUP BY etapa
       ORDER BY array_position(ARRAY['recepcion', 'diagnostico', 'esperando_aprobacion', 'esperando_repuestos', 'en_reparacion', 'lista_entrega']::text[], etapa::text)`
    );
    res.json({ data: rows });
  } catch (err) {
    fail(res, err);
  }
});

module.exports = router;
