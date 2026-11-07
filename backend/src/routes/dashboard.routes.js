const router = require('express').Router();
const { pool } = require('../db/pool');
const { fail } = require('../utils/responder');
const auth = require('../middleware/auth');
const requireRol = require('../middleware/roles');
const { getConfig } = require('../utils/configuracion');
const { enPeriodo, hoySQL } = require('../utils/sql-fechas');

router.use(auth, requireRol('admin'));

router.get('/resumen', async (req, res) => {
  try {
    // Hoy, la semana y el mes del taller, no los de la base (utils/sql-fechas.js).
    const off = (await getConfig()).zona_horaria_offset;
    const [[{ motos_activas }]] = await pool.query(
      "SELECT COUNT(*) AS motos_activas FROM ordenes_trabajo WHERE estado NOT IN ('entregada','cancelada')"
    );
    const [[{ motos_atrasadas }]] = await pool.query(
      `SELECT COUNT(*) AS motos_atrasadas FROM ordenes_trabajo WHERE estado NOT IN ('entregada','cancelada') AND fecha_estimada_entrega < ${hoySQL(off)}`
    );
    const [[{ facturacion_hoy }]] = await pool.query(
      `SELECT COALESCE(SUM(costo_mano_obra + costo_repuestos - descuento), 0) AS facturacion_hoy FROM ordenes_trabajo WHERE ${enPeriodo('fecha_entrega_real', 'hoy', { momento: true, offset: off })} AND estado = 'entregada'`
    );
    const [[{ facturacion_semana }]] = await pool.query(
      `SELECT COALESCE(SUM(costo_mano_obra + costo_repuestos - descuento), 0) AS facturacion_semana FROM ordenes_trabajo WHERE estado = 'entregada' AND ${enPeriodo('fecha_entrega_real', 'semana', { momento: true, offset: off })}`
    );
    const [[{ facturacion_mes }]] = await pool.query(
      `SELECT COALESCE(SUM(costo_mano_obra + costo_repuestos - descuento), 0) AS facturacion_mes FROM ordenes_trabajo WHERE estado = 'entregada' AND ${enPeriodo('fecha_entrega_real', 'mes', { momento: true, offset: off })}`
    );
    // Facturación TOTAL del mes = órdenes + citas, sin doble conteo (una orden ligada
    // a una cita cuenta por la cita). Mismo criterio que el PDF / admin resumen.
    const [[{ facturacion_mes_total }]] = await pool.query(
      `SELECT
         (SELECT COALESCE(SUM(monto),0) FROM citas
            WHERE estado='entregado' AND ${enPeriodo('fecha_fin', 'mes', { momento: true, offset: off })})
       + (SELECT COALESCE(SUM(costo_mano_obra + costo_repuestos - descuento),0) FROM ordenes_trabajo
            WHERE estado='entregada' AND ${enPeriodo('fecha_entrega_real', 'mes', { momento: true, offset: off })}
              AND id NOT IN (SELECT orden_id FROM citas WHERE orden_id IS NOT NULL)) AS facturacion_mes_total`
    );
    const [[{ ticket_promedio }]] = await pool.query(
      "SELECT COALESCE(AVG(costo_mano_obra + costo_repuestos - descuento), 0) AS ticket_promedio FROM ordenes_trabajo WHERE estado = 'entregada'"
    );
    const [[{ tiempo_promedio_horas }]] = await pool.query(
      "SELECT ROUND(AVG(TIMESTAMPDIFF(HOUR, fecha_ingreso, fecha_entrega_real)), 1) AS tiempo_promedio_horas FROM ordenes_trabajo WHERE estado = 'entregada' AND fecha_entrega_real IS NOT NULL"
    );
    // Ingresos por citas (lo que cobra el mecánico al entregar una cita).
    // Es un canal de facturación distinto al de las órdenes de trabajo.
    const [[{ ingresos_citas_hoy }]] = await pool.query(
      `SELECT COALESCE(SUM(monto), 0) AS ingresos_citas_hoy FROM citas WHERE estado = 'entregado' AND ${enPeriodo('fecha_fin', 'hoy', { momento: true, offset: off })}`
    );
    const [[{ ingresos_citas_mes }]] = await pool.query(
      `SELECT COALESCE(SUM(monto), 0) AS ingresos_citas_mes FROM citas WHERE estado = 'entregado' AND ${enPeriodo('fecha_fin', 'mes', { momento: true, offset: off })}`
    );
    const [[{ citas_entregadas_mes }]] = await pool.query(
      `SELECT COUNT(*) AS citas_entregadas_mes FROM citas WHERE estado = 'entregado' AND ${enPeriodo('fecha_fin', 'mes', { momento: true, offset: off })}`
    );
    const [[{ repuestos_pendientes }]] = await pool.query(
      "SELECT COUNT(*) AS repuestos_pendientes FROM orden_repuestos r JOIN ordenes_trabajo o ON o.id = r.orden_id WHERE r.estado IN ('pendiente','pedido_especial') AND o.estado NOT IN ('entregada','cancelada')"
    );
    // Satisfacción: el cliente califica sobre todo en la CITA (citas.calificacion),
    // no en la orden. Unimos citas + órdenes sin doble conteo (una orden ligada a una
    // cita cuenta solo por la cita), igual que el feed de opiniones. Antes solo miraba
    // ordenes_trabajo y por eso el KPI salía vacío ("—").
    const [[satisfaccion]] = await pool.query(
      `SELECT ROUND(AVG(calificacion), 1) AS promedio, COUNT(calificacion) AS total
       FROM (
         SELECT c.calificacion FROM citas c
           WHERE c.calificacion IS NOT NULL AND c.calificacion > 0
         UNION ALL
         SELECT o.calificacion FROM ordenes_trabajo o
           WHERE o.calificacion IS NOT NULL AND o.calificacion > 0
             AND o.id NOT IN (SELECT orden_id FROM citas WHERE orden_id IS NOT NULL)
       ) x`
    );
    const [[conversion]] = await pool.query(
      `SELECT
         (SELECT COUNT(DISTINCT orden_id) FROM orden_tiempos WHERE etapa = 'diagnostico') AS con_diagnostico,
         (SELECT COUNT(DISTINCT orden_id) FROM orden_tiempos WHERE etapa = 'en_reparacion') AS con_reparacion`
    );
    const conversion_pct = conversion.con_diagnostico > 0
      ? Math.round((conversion.con_reparacion / conversion.con_diagnostico) * 100)
      : 0;
    const [ordenes_por_estado] = await pool.query(
      "SELECT estado, COUNT(*) AS total FROM ordenes_trabajo WHERE estado NOT IN ('entregada','cancelada') GROUP BY estado"
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
    const [rows] = await pool.query(
      `SELECT o.id, o.numero_orden, o.estado, o.fecha_estimada_entrega,
              DATEDIFF(o.fecha_estimada_entrega, ${hoySQL((await getConfig()).zona_horaria_offset)}) AS dias_restantes,
              m.marca, m.modelo, m.placa,
              c.nombre AS cliente_nombre, c.apellido AS cliente_apellido,
              t.nombre AS tecnico_nombre
       FROM ordenes_trabajo o
       JOIN motos m    ON m.id = o.moto_id
       JOIN clientes c ON c.id = o.cliente_id
       LEFT JOIN usuarios t ON t.id = o.tecnico_id
       WHERE o.estado NOT IN ('entregada','cancelada')
       ORDER BY (o.fecha_estimada_entrega IS NULL), o.fecha_estimada_entrega ASC`
    );
    res.json({ data: rows });
  } catch (err) {
    fail(res, err);
  }
});

router.get('/tecnicos', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT u.id, u.nombre,
              COUNT(ot.id) AS ordenes_completadas,
              ROUND(AVG(TIMESTAMPDIFF(HOUR, ot.fecha_ingreso, ot.fecha_entrega_real)), 1) AS horas_promedio
       FROM usuarios u
       LEFT JOIN ordenes_trabajo ot ON ot.tecnico_id = u.id AND ot.estado = 'entregada'
       WHERE u.rol = 'tecnico' AND u.activo = 1
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
    const [rows] = await pool.query(
      `SELECT etapa,
              COUNT(*) AS total,
              ROUND(AVG(TIMESTAMPDIFF(HOUR, inicio, COALESCE(fin, NOW()))), 1) AS horas_promedio
       FROM orden_tiempos
       GROUP BY etapa
       ORDER BY FIELD(etapa,'recepcion','diagnostico','esperando_aprobacion','esperando_repuestos','en_reparacion','lista_entrega')`
    );
    res.json({ data: rows });
  } catch (err) {
    fail(res, err);
  }
});

module.exports = router;
