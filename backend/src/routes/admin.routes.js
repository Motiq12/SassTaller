const router = require('express').Router();
const bcrypt = require('bcrypt');
// Sin `pool`: todo el acceso pasa por req.db, scopeado al taller.
const { anotar } = require('../utils/actividad');
const { registrarEvento } = require('../utils/eventos-seguridad');
const { fail, invalido } = require('../utils/responder');
const auth = require('../middleware/auth');
const requireRol = require('../middleware/roles');
const { getConfig, clearCache } = require('../utils/configuracion');
const { topeAlcanzado, puedeMarcaPropia } = require('../utils/cuenta');
const { cargarEjemplo, borrarEjemplo } = require('../utils/ejemplo');
const { getSucursales, clearCache: clearSucursalesCache } = require('../utils/sucursales');
const { getServiciosFilas, clearCache: clearServicios } = require('../utils/servicios');
const { fotoValida, textoDentroDeLimite } = require('../utils/validar');
const { fechaLocalISO } = require('../utils/fecha');
const { horasDeCita, horasDeBloqueo, fechasEntre } = require('../utils/agenda');
const { FERIADOS_CR, fechaValida, proximaFecha } = require('../utils/feriados');
const { politica, problemaDeContrasena } = require('../utils/contrasena');
const { cerrarSesiones } = require('../utils/sesiones');
const { CORREO_FABRICA, normalizarPlantillas } = require('../utils/plantillas');
const { textosParaGuardar } = require('../utils/textos-portal');
const { horasDisponibles } = require('../utils/configuracion');
const { estadoCorreo, enviarCorreoPrueba } = require('../services/mailer');
const { enPeriodo, diasDelPeriodo } = require('../utils/sql-fechas');
const {
  BASES, CATALOGO, ROLES_FABRICA, BASES_PROPIAS, BASE_DE_ROL, ROL_DE_BASE, FIJAS, ajustables, validarRolPropio, permisosEfectivos,
} = require('../utils/permisos');

// Panel del administrador: métricas ejecutivas. Solo admin.
router.use(auth, requireRol('admin'));

// ───────────────────────────────────────────────────────────
// Arranque: los primeros pasos de un taller recién registrado.
// ───────────────────────────────────────────────────────────

// GET /api/admin/arranque — qué le falta al taller para estar andando.
//
// Los cuatro pasos se DERIVAN de los datos, no se guardan. Un progreso guardado aparte
// puede terminar afirmando que algo está hecho cuando ya no lo está (borraron al único
// empleado, quitaron el logo), y entonces el checklist miente. Lo único que se persiste
// es si lo cerraron a mano.
router.get('/arranque', async (req, res) => {
  try {
    const [[p]] = await req.db.query(
      `SELECT
         (SELECT COUNT(*) FROM configuracion
            WHERE tenant_id = @tenant AND (logo IS NOT NULL OR color_primario IS NOT NULL)) AS marca,
         (SELECT COUNT(*) FROM usuarios  WHERE tenant_id = @tenant AND activo = 1)           AS usuarios,
         (SELECT COUNT(*) FROM ordenes_trabajo WHERE tenant_id = @tenant)                    AS ordenes,
         (SELECT COUNT(*) FROM clientes  WHERE tenant_id = @tenant AND password_hash IS NOT NULL) AS con_portal,
         (SELECT COUNT(*) FROM clientes  WHERE tenant_id = @tenant AND es_ejemplo = 1)       AS ejemplo,
         (SELECT COALESCE(MAX(arranque_oculto), 0) FROM configuracion WHERE tenant_id = @tenant) AS oculto`
    );

    const pasos = {
      marca:  Number(p.marca) > 0,
      equipo: Number(p.usuarios) > 1,   // el admin que registró el taller ya cuenta como uno
      orden:  Number(p.ordenes) > 0,
      portal: Number(p.con_portal) > 0,
    };
    const completo = Object.values(pasos).every(Boolean);

    res.json({ data: { pasos, completo, oculto: Number(p.oculto) === 1, hay_ejemplo: Number(p.ejemplo) > 0 } });
  } catch (err) {
    fail(res, err);
  }
});

// POST /api/admin/arranque/ocultar — "ya entendí, sacámelo de encima".
router.post('/arranque/ocultar', async (req, res) => {
  try {
    await req.db.query('UPDATE configuracion SET arranque_oculto = 1 WHERE id = 1 AND tenant_id = @tenant');
    clearCache(req.db.tenantId);
    res.json({ message: 'Listo' });
  } catch (err) {
    fail(res, err);
  }
});

// POST /api/admin/ejemplo — llenar el taller con datos de mentira para poder mirarlo.
router.post('/ejemplo', async (req, res) => {
  try {
    const r = await cargarEjemplo(req.db);
    res.status(201).json({
      data: r,
      message: r.ya ? 'Los datos de ejemplo ya estaban cargados' : 'Datos de ejemplo cargados',
    });
  } catch (err) {
    fail(res, err);
  }
});

// DELETE /api/admin/ejemplo — sacarlos. Solo toca lo marcado como ejemplo.
router.delete('/ejemplo', async (req, res) => {
  try {
    const r = await borrarEjemplo(req.db);
    res.json({ data: r, message: 'Datos de ejemplo eliminados' });
  } catch (err) {
    fail(res, err);
  }
});

// GET /api/admin/resumen — KPIs del mes + distribución de citas + ingresos por servicio.
router.get('/resumen', async (req, res) => {
  try {
    // El mes del taller, no el de la base (utils/sql-fechas.js).
    const off = (await getConfig(req.db)).zona_horaria_offset;
    const [[{ total_citas }]] = await req.db.query(
      `SELECT COUNT(*) AS total_citas FROM citas WHERE tenant_id = @tenant AND ${enPeriodo('fecha', 'mes', { offset: off })}`
    );
    const [[{ citas_pendientes }]] = await req.db.query(
      "SELECT COUNT(*) AS citas_pendientes FROM citas WHERE tenant_id = @tenant AND estado NOT IN ('entregado','cancelado')"
    );
    // Ingresos del mes unificados (mismo criterio del #3: sin doble conteo de la cita y su orden).
    const [[{ ingresos_mes }]] = await req.db.query(
      `SELECT
         (SELECT COALESCE(SUM(monto),0) FROM citas
            WHERE tenant_id = @tenant AND estado='entregado' AND ${enPeriodo('fecha_fin', 'mes', { momento: true, offset: off })})
       + (SELECT COALESCE(SUM(costo_mano_obra+costo_repuestos-descuento),0) FROM ordenes_trabajo
            WHERE tenant_id = @tenant AND estado='entregada' AND ${enPeriodo('fecha_entrega_real', 'mes', { momento: true, offset: off })}
              AND id NOT IN (SELECT orden_id FROM citas WHERE tenant_id = @tenant AND orden_id IS NOT NULL)) AS ingresos_mes`
    );
    // Tasa de éxito del mes: entregadas / (entregadas + canceladas).
    const [[exito]] = await req.db.query(
      `SELECT COALESCE(SUM(estado='entregado'),0) AS entregadas, COALESCE(SUM(estado='cancelado'),0) AS canceladas
       FROM citas WHERE tenant_id = @tenant AND ${enPeriodo('fecha', 'mes', { offset: off })}`
    );
    const cerradas = Number(exito.entregadas) + Number(exito.canceladas);
    const tasa_exito = cerradas ? Math.round((Number(exito.entregadas) / cerradas) * 100) : 0;

    // Cada servicio de la cita cuenta por separado: una con aceite y frenos suma uno a
    // cada uno (cita_servicios). La que no tiene ninguno va como "Sin especificar".
    const [top_servicios] = await req.db.query(
      `SELECT COALESCE(cs.servicio,'Sin especificar') AS servicio, COUNT(*) AS total
       FROM citas ci LEFT JOIN cita_servicios cs ON cs.cita_id = ci.id AND cs.tenant_id = @tenant
       WHERE ci.tenant_id = @tenant AND ${enPeriodo('ci.fecha', 'mes', { offset: off })}
       GROUP BY servicio ORDER BY total DESC LIMIT 5`
    );

    const [[estado_citas]] = await req.db.query(
      `SELECT
         COALESCE(SUM(estado='agendado'),0) AS agendadas,
         COALESCE(SUM(estado IN ('en_revision','en_mantenimiento','listo')),0) AS en_proceso,
         COALESCE(SUM(estado='entregado'),0) AS completadas,
         COALESCE(SUM(estado='cancelado'),0) AS canceladas,
         COUNT(*) AS total
       FROM citas WHERE tenant_id = @tenant AND ${enPeriodo('fecha', 'mes', { offset: off })}`
    );

    const [ingresos_por_servicio] = await req.db.query(
      `SELECT COALESCE(tipo_servicio,'Sin especificar') AS servicio,
              COUNT(*) AS citas, COALESCE(SUM(monto),0) AS ingreso, COALESCE(AVG(monto),0) AS promedio
       FROM citas
       WHERE tenant_id = @tenant AND estado='entregado' AND ${enPeriodo('fecha_fin', 'mes', { momento: true, offset: off })}
       GROUP BY servicio ORDER BY ingreso DESC`
    );

    res.json({
      data: { total_citas, ingresos_mes, citas_pendientes, tasa_exito, top_servicios, estado_citas, ingresos_por_servicio },
    });
  } catch (err) {
    fail(res, err);
  }
});

// GET /api/admin/opiniones?estrellas=&empleado=&limit= — calificaciones REALES del cliente.
// Une citas + órdenes sin doble conteo (mismo criterio de ingresos: una orden ligada
// a una cita cuenta solo por la cita). Filtros opcionales por estrellas y mecánico.
// Sin filtros (dashboard) devuelve las últimas 40 + resumen global.
router.get('/opiniones', async (req, res) => {
  try {
    const estRaw = Number(req.query.estrellas);
    const estrellas = Number.isInteger(estRaw) && estRaw >= 1 && estRaw <= 5 ? estRaw : null;
    const empRaw = Number(req.query.empleado);
    const empleado = Number.isInteger(empRaw) && empRaw > 0 ? empRaw : null;
    const limRaw = Number(req.query.limit);
    const limit = Number.isInteger(limRaw) && limRaw > 0 ? Math.min(limRaw, 300) : 40;

    // Subconsulta base (una orden ligada a cita solo cuenta por la cita).
    const UNION = `
      SELECT c.id AS ref_id, 'cita' AS origen, c.orden_id, o.numero_orden,
             c.calificacion, c.comentario_satisfaccion AS comentario,
             COALESCE(c.fecha_fin, c.fecha) AS fecha,
             cl.nombre AS cliente_nombre, cl.apellido AS cliente_apellido,
             m.marca, m.modelo, m.placa,
             c.tecnico_id, u.nombre AS tecnico_nombre
      FROM citas c
        JOIN clientes cl ON cl.id = c.cliente_id AND cl.tenant_id = @tenant
        LEFT JOIN vehiculos m ON m.id = c.vehiculo_id AND m.tenant_id = @tenant
        LEFT JOIN usuarios u ON u.id = c.tecnico_id AND u.tenant_id = @tenant
        LEFT JOIN ordenes_trabajo o ON o.id = c.orden_id AND o.tenant_id = @tenant
      WHERE c.tenant_id = @tenant AND c.calificacion IS NOT NULL AND c.calificacion > 0
      UNION ALL
      SELECT o.id AS ref_id, 'orden' AS origen, o.id AS orden_id, o.numero_orden,
             o.calificacion, o.comentario_satisfaccion AS comentario,
             COALESCE(o.fecha_entrega_real, o.fecha_ingreso) AS fecha,
             cl.nombre AS cliente_nombre, cl.apellido AS cliente_apellido,
             m.marca, m.modelo, m.placa,
             o.tecnico_id, u.nombre AS tecnico_nombre
      FROM ordenes_trabajo o
        JOIN clientes cl ON cl.id = o.cliente_id AND cl.tenant_id = @tenant
        LEFT JOIN vehiculos m ON m.id = o.vehiculo_id AND m.tenant_id = @tenant
        LEFT JOIN usuarios u ON u.id = o.tecnico_id AND u.tenant_id = @tenant
      WHERE o.tenant_id = @tenant AND o.calificacion IS NOT NULL AND o.calificacion > 0
        AND o.id NOT IN (SELECT orden_id FROM citas WHERE orden_id IS NOT NULL AND tenant_id = @tenant)`;

    // Cláusula de filtro (aplica igual a la lista y al resumen).
    let filtro = '';
    const params = [];
    if (estrellas) { filtro += ' AND t.calificacion = ?'; params.push(estrellas); }
    if (empleado)  { filtro += ' AND t.tecnico_id = ?'; params.push(empleado); }

    const [opiniones] = await req.db.query(
      `SELECT * FROM (${UNION}) t WHERE 1=1${filtro} ORDER BY t.fecha DESC LIMIT ?`,
      [...params, limit]
    );
    // Resumen con los mismos filtros aplicados.
    const [[agg]] = await req.db.query(
      `SELECT COUNT(*) AS total, COALESCE(AVG(t.calificacion),0) AS promedio,
              COALESCE(SUM(t.calificacion <= 2),0) AS bajas
       FROM (${UNION}) t WHERE 1=1${filtro}`,
      params
    );
    // Mecánicos activos para el filtro (siempre completo, no depende de los filtros).
    const [tecnicos] = await req.db.query(
      "SELECT id, nombre FROM usuarios WHERE tenant_id = @tenant AND rol = 'tecnico' AND activo = 1 ORDER BY nombre"
    );
    res.json({
      data: {
        opiniones,
        tecnicos,
        resumen: {
          total: Number(agg.total),
          promedio: Number(Number(agg.promedio).toFixed(1)),
          bajas: Number(agg.bajas),
        },
      },
    });
  } catch (err) {
    fail(res, err);
  }
});

// GET /api/admin/reportes?periodo=mes|mes_pasado|anio&empleado=<tecnico_id>
// Analítica por período: KPIs, serie temporal, ingresos por servicio,
// rendimiento por mecánico y cotizaciones por recepción.
router.get('/reportes', async (req, res) => {
  try {
    const periodos = { mes: 'Este mes', mes_pasado: 'Mes pasado', anio: 'Este año' };
    const periodo = periodos[req.query.periodo] ? req.query.periodo : 'mes';
    const empRaw = Number(req.query.empleado);
    const empleado = Number.isInteger(empRaw) && empRaw > 0 ? empRaw : null;

    // El período en la hora del taller (utils/sql-fechas.js). c.fecha es un día; las
    // demás, un momento.
    const off = (await getConfig(req.db)).zona_horaria_offset;
    const COLUMNAS_RANGO = { 'c.fecha': false, 'c.fecha_fin': true, 'o.fecha_entrega_real': true, 'o.fecha_ingreso': true };
    const rango = (col) => {
      if (!(col in COLUMNAS_RANGO)) throw new Error(`Columna no permitida en rango: ${col}`);
      return enPeriodo(col, periodo, { momento: COLUMNAS_RANGO[col], offset: off });
    };
    // Filtro opcional por mecánico (aplica a métricas basadas en citas).
    const empCita = empleado ? ' AND c.tecnico_id = ?' : '';
    const pEmp = empleado ? [empleado] : [];

    // KPIs del período.
    const [[k]] = await req.db.query(
      `SELECT COUNT(*) AS total_citas,
              COALESCE(SUM(estado='entregado'),0) AS entregadas,
              COALESCE(SUM(estado='cancelado'),0) AS canceladas,
              COALESCE(AVG(NULLIF(calificacion,0)),0) AS calificacion_promedio
       FROM citas c WHERE c.tenant_id = @tenant AND ${rango('c.fecha')}${empCita}`, pEmp
    );
    const cerradas = Number(k.entregadas) + Number(k.canceladas);
    const tasa_exito = cerradas ? Math.round((Number(k.entregadas) / cerradas) * 100) : 0;

    // Ticket promedio y total cobrado en citas entregadas (por fecha de entrega).
    const [[tk]] = await req.db.query(
      `SELECT COALESCE(AVG(NULLIF(monto,0)),0) AS ticket_promedio
       FROM citas c WHERE c.tenant_id = @tenant AND c.estado='entregado' AND ${rango('c.fecha_fin')}${empCita}`, pEmp
    );

    // Ingresos unificados del período (mismo criterio del #3, sin doble conteo).
    const [[ing]] = await req.db.query(
      `SELECT
         (SELECT COALESCE(SUM(monto),0) FROM citas c
            WHERE c.tenant_id = @tenant AND c.estado='entregado' AND ${rango('c.fecha_fin')}${empCita})
       + (SELECT COALESCE(SUM(costo_mano_obra+costo_repuestos-descuento),0) FROM ordenes_trabajo o
            WHERE o.tenant_id = @tenant AND o.estado='entregada' AND ${rango('o.fecha_entrega_real')}
              ${empleado ? 'AND o.tecnico_id = ?' : ''}
              AND o.id NOT IN (SELECT orden_id FROM citas WHERE orden_id IS NOT NULL AND tenant_id = @tenant)) AS ingresos`,
      empleado ? [empleado, empleado] : []
    );

    // Serie temporal: citas e ingreso por día (mes) o por mes (año), con huecos en cero.
    const bucket = periodo === 'anio' ? 'MONTH(c.fecha)' : 'DAY(c.fecha)';
    const [serieRows] = await req.db.query(
      `SELECT ${bucket} AS b, COUNT(*) AS citas,
              COALESCE(SUM(CASE WHEN estado='entregado' THEN monto ELSE 0 END),0) AS ingreso
       FROM citas c WHERE c.tenant_id = @tenant AND ${rango('c.fecha')}${empCita}
       GROUP BY b ORDER BY b`, pEmp
    );
    const mapSerie = {};
    serieRows.forEach(r => { mapSerie[Number(r.b)] = r; });
    let serie;
    if (periodo === 'anio') {
      const meses = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
      serie = meses.map((m, i) => {
        const r = mapSerie[i + 1];
        return { label: m, citas: r ? Number(r.citas) : 0, ingreso: r ? Number(r.ingreso) : 0 };
      });
    } else {
      const dias = diasDelPeriodo(periodo, off);
      serie = Array.from({ length: Number(dias) }, (_, i) => {
        const r = mapSerie[i + 1];
        return { label: String(i + 1), citas: r ? Number(r.citas) : 0, ingreso: r ? Number(r.ingreso) : 0 };
      });
    }

    // Ingresos por servicio (citas entregadas en el período).
    const [ingresos_por_servicio] = await req.db.query(
      `SELECT COALESCE(tipo_servicio,'Sin especificar') AS servicio,
              COUNT(*) AS citas, COALESCE(SUM(monto),0) AS ingreso, COALESCE(AVG(monto),0) AS promedio
       FROM citas c WHERE c.tenant_id = @tenant AND c.estado='entregado' AND ${rango('c.fecha_fin')}${empCita}
       GROUP BY servicio ORDER BY ingreso DESC`, pEmp
    );

    // Rendimiento por mecánico: citas, entregas, ingresos, tiempo y calificación.
    const [rendimiento] = await req.db.query(
      `SELECT u.id AS tecnico_id, u.nombre,
              COUNT(*) AS citas,
              COALESCE(SUM(c.estado='entregado'),0) AS entregadas,
              COALESCE(SUM(c.estado='cancelado'),0) AS canceladas,
              COALESCE(SUM(CASE WHEN c.estado='entregado' THEN c.monto ELSE 0 END),0) AS ingresos,
              AVG(CASE WHEN c.estado='entregado' AND c.fecha_inicio IS NOT NULL AND (c.fecha_listo IS NOT NULL OR c.fecha_fin IS NOT NULL)
                       THEN TIMESTAMPDIFF(MINUTE, c.fecha_inicio, COALESCE(c.fecha_listo, c.fecha_fin)) END) AS tiempo_prom_min,
              AVG(CASE WHEN c.estado='entregado' AND c.fecha_listo IS NOT NULL AND c.fecha_fin IS NOT NULL
                       THEN TIMESTAMPDIFF(MINUTE, c.fecha_listo, c.fecha_fin) END) AS tiempo_entrega_min,
              AVG(NULLIF(c.calificacion,0)) AS calificacion
       FROM citas c JOIN usuarios u ON u.id = c.tecnico_id AND u.tenant_id = @tenant
       WHERE c.tenant_id = @tenant AND ${rango('c.fecha')}${empCita}
       GROUP BY u.id, u.nombre
       ORDER BY ingresos DESC, citas DESC`, pEmp
    );

    // Cotizaciones por recepción (órdenes creadas y su aprobación por el cliente).
    const [recepcion] = await req.db.query(
      `SELECT u.id, u.nombre,
              COUNT(*) AS ordenes,
              COALESCE(SUM(o.aprobacion_cliente='aprobado'),0) AS aprobadas,
              COALESCE(SUM(o.aprobacion_cliente='rechazado'),0) AS rechazadas
       FROM ordenes_trabajo o JOIN usuarios u ON u.id = o.recepcionista_id AND u.tenant_id = @tenant
       WHERE o.tenant_id = @tenant AND ${rango('o.fecha_ingreso')}
       GROUP BY u.id, u.nombre ORDER BY ordenes DESC`
    );

    res.json({
      data: {
        periodo: { clave: periodo, label: periodos[periodo] },
        kpis: {
          total_citas: Number(k.total_citas),
          entregadas: Number(k.entregadas),
          canceladas: Number(k.canceladas),
          tasa_exito,
          ingresos: Number(ing.ingresos),
          ticket_promedio: Math.round(Number(tk.ticket_promedio)),
          calificacion_promedio: Number(Number(k.calificacion_promedio).toFixed(1)),
        },
        serie,
        ingresos_por_servicio,
        rendimiento,
        recepcion,
      },
    });
  } catch (err) {
    fail(res, err);
  }
});

// ───────────────────────────────────────────────────────────
// Asignar tareas a los mecánicos (Fase C)
// ───────────────────────────────────────────────────────────
const PRIORIDADES = ['baja', 'normal', 'alta', 'urgente'];
// Topes de la tabla (titulo VARCHAR(150), detalle VARCHAR(300)). Sin comprobarlos,
// un texto más largo no se recorta: MySQL en modo estricto corta la petición con un
// 500 en vez de decir qué pasó.
const MAX_TITULO = 150;
const MAX_DETALLE = 300;

// Validación común de alta y edición de tareas. Devuelve el mensaje de error, o null.
function validarTarea({ titulo, detalle, tecnico_id }) {
  if (!tecnico_id) return 'Elegí un mecánico';
  if (!titulo || !titulo.trim()) return 'El título es requerido';
  if (!textoDentroDeLimite(titulo, MAX_TITULO)) return `El título no puede pasar de ${MAX_TITULO} caracteres`;
  if (!textoDentroDeLimite(detalle, MAX_DETALLE)) return `El detalle no puede pasar de ${MAX_DETALLE} caracteres`;
  return null;
}

// GET /api/admin/tareas?empleado= — tareas asignadas por el admin (monitoreo).
router.get('/tareas', async (req, res) => {
  try {
    const empRaw = Number(req.query.empleado);
    const empleado = Number.isInteger(empRaw) && empRaw > 0 ? empRaw : null;
    let sql =
      `SELECT t.id, t.tecnico_id, t.titulo, t.detalle, t.prioridad, t.hecha, t.vence, t.created_at,
              u.nombre AS tecnico_nombre, a.nombre AS asignado_por_nombre
       FROM tareas_mecanico t
       JOIN usuarios u ON u.id = t.tecnico_id AND u.tenant_id = @tenant
       LEFT JOIN usuarios a ON a.id = t.asignado_por AND a.tenant_id = @tenant
       WHERE t.tenant_id = @tenant AND t.asignado_por IS NOT NULL`;
    const params = [];
    if (empleado) { sql += ' AND t.tecnico_id = ?'; params.push(empleado); }
    sql += ` ORDER BY t.hecha ASC, FIELD(t.prioridad,'urgente','alta','normal','baja'),
             (t.vence IS NULL), t.vence ASC, t.created_at DESC`;
    const [rows] = await req.db.query(sql, params);
    res.json({ data: rows });
  } catch (err) {
    fail(res, err);
  }
});

// POST /api/admin/tareas — asignar una tarea a un mecánico.
router.post('/tareas', async (req, res) => {
  try {
    const { tecnico_id, titulo, detalle, prioridad, vence } = req.body;
    const error = validarTarea({ titulo, detalle, tecnico_id });
    if (error) return res.status(400).json({ error });
    const [[tec]] = await req.db.query(
      "SELECT id FROM usuarios WHERE tenant_id = @tenant AND id = ? AND rol = 'tecnico' AND activo = 1", [tecnico_id]
    );
    if (!tec) return res.status(400).json({ error: 'Mecánico no válido' });
    const prio = PRIORIDADES.includes(prioridad) ? prioridad : 'normal';
    const [r] = await req.db.query(
      'INSERT INTO tareas_mecanico (tenant_id,tecnico_id, titulo, detalle, prioridad, vence, asignado_por) VALUES (@tenant, ?, ?, ?, ?, ?, ?)',
      [tecnico_id, titulo.trim(), (detalle || '').trim() || null, prio, vence || null, req.usuario.id]
    );
    const [[nueva]] = await req.db.query('SELECT * FROM tareas_mecanico WHERE tenant_id = @tenant AND id = ?', [r.insertId]);
    res.status(201).json({ data: nueva, message: 'Tarea asignada' });
  } catch (err) {
    fail(res, err);
  }
});

// PUT /api/admin/tareas/:id — corregir una tarea ya asignada (se puso mal el mecánico,
// cambió la prioridad, se movió la fecha). Mismas validaciones que al crearla.
// El estado `hecha` no se toca acá a propósito: eso lo marca el mecánico desde su panel.
router.put('/tareas/:id', async (req, res) => {
  try {
    const { tecnico_id, titulo, detalle, prioridad, vence } = req.body;
    const error = validarTarea({ titulo, detalle, tecnico_id });
    if (error) return res.status(400).json({ error });

    // Igual que el DELETE: el admin solo administra lo que él asignó. Las tareas que
    // el técnico se crea a sí mismo (asignado_por NULL) son suyas y no se tocan.
    const [[existente]] = await req.db.query(
      'SELECT id FROM tareas_mecanico WHERE tenant_id = @tenant AND id = ? AND asignado_por IS NOT NULL', [req.params.id]
    );
    if (!existente) return res.status(404).json({ error: 'Tarea no encontrada' });

    const [[tec]] = await req.db.query(
      "SELECT id FROM usuarios WHERE tenant_id = @tenant AND id = ? AND rol = 'tecnico' AND activo = 1", [tecnico_id]
    );
    if (!tec) return res.status(400).json({ error: 'Mecánico no válido' });

    const prio = PRIORIDADES.includes(prioridad) ? prioridad : 'normal';
    await req.db.query(
      'UPDATE tareas_mecanico SET tecnico_id = ?, titulo = ?, detalle = ?, prioridad = ?, vence = ? WHERE tenant_id = @tenant AND id = ?',
      [tecnico_id, titulo.trim(), (detalle || '').trim() || null, prio, vence || null, req.params.id]
    );
    const [[actualizada]] = await req.db.query('SELECT * FROM tareas_mecanico WHERE tenant_id = @tenant AND id = ?', [req.params.id]);
    res.json({ data: actualizada, message: 'Tarea actualizada' });
  } catch (err) {
    fail(res, err);
  }
});

// DELETE /api/admin/tareas/:id — cancelar una tarea asignada (solo asignadas, no las propias del técnico).
router.delete('/tareas/:id', async (req, res) => {
  try {
    await req.db.query('DELETE FROM tareas_mecanico WHERE tenant_id = @tenant AND id = ? AND asignado_por IS NOT NULL', [req.params.id]);
    res.json({ message: 'Tarea eliminada' });
  } catch (err) {
    fail(res, err);
  }
});

// ───────────────────────────────────────────────────────────
// Catálogo de servicios (lo que se puede agendar).
// El nombre se guarda como texto en citas.tipo_servicio, así que editar o borrar acá
// nunca reescribe el historial: las citas viejas conservan el nombre con el que se
// agendaron. Por eso mismo, desactivar es lo normal y borrar es la excepción.
// ───────────────────────────────────────────────────────────
const MAX_SERVICIO = 120;

// GET /api/admin/servicios — catálogo completo, incluidos los desactivados.
router.get('/servicios', async (req, res) => {
  try {
    res.json({ data: await getServiciosFilas(req.db) });
  } catch (err) {
    fail(res, err);
  }
});

router.post('/servicios', async (req, res) => {
  try {
    const nombre = String(req.body.nombre || '').trim();
    if (!nombre) return invalido(res, 'nombre', 'Falta el nombre');
    if (!textoDentroDeLimite(nombre, MAX_SERVICIO)) {
      return invalido(res, 'nombre', `El nombre no puede pasar de ${MAX_SERVICIO} caracteres`);
    }
    const [[dup]] = await req.db.query('SELECT id FROM servicios WHERE tenant_id = @tenant AND nombre = ?', [nombre]);
    if (dup) return invalido(res, 'nombre', 'Ya existe un servicio con ese nombre', 409);

    const [[max]] = await req.db.query('SELECT COALESCE(MAX(orden), 0) AS m FROM servicios WHERE tenant_id = @tenant');
    const [r] = await req.db.query('INSERT INTO servicios (tenant_id,nombre, orden) VALUES (@tenant, ?, ?)', [nombre, max.m + 1]);
    clearServicios(req.db.tenantId);
    const [[nuevo]] = await req.db.query('SELECT id, nombre, activo, orden FROM servicios WHERE tenant_id = @tenant AND id = ?', [r.insertId]);
    res.status(201).json({ data: nuevo, message: 'Servicio creado' });
  } catch (err) {
    fail(res, err);
  }
});

router.put('/servicios/:id', async (req, res) => {
  try {
    const nombre = String(req.body.nombre || '').trim();
    if (!nombre) return invalido(res, 'nombre', 'Falta el nombre');
    if (!textoDentroDeLimite(nombre, MAX_SERVICIO)) {
      return invalido(res, 'nombre', `El nombre no puede pasar de ${MAX_SERVICIO} caracteres`);
    }
    const [[existe]] = await req.db.query('SELECT id FROM servicios WHERE tenant_id = @tenant AND id = ?', [req.params.id]);
    if (!existe) return res.status(404).json({ error: 'Servicio no encontrado' });
    const [[dup]] = await req.db.query('SELECT id FROM servicios WHERE tenant_id = @tenant AND nombre = ? AND id <> ?', [nombre, req.params.id]);
    if (dup) return invalido(res, 'nombre', 'Ya existe un servicio con ese nombre', 409);

    const activo = req.body.activo === undefined ? undefined : (req.body.activo ? 1 : 0);
    if (activo === undefined) {
      await req.db.query('UPDATE servicios SET nombre = ? WHERE tenant_id = @tenant AND id = ?', [nombre, req.params.id]);
    } else {
      await req.db.query('UPDATE servicios SET nombre = ?, activo = ? WHERE tenant_id = @tenant AND id = ?', [nombre, activo, req.params.id]);
    }
    clearServicios(req.db.tenantId);
    const [[actualizado]] = await req.db.query('SELECT id, nombre, activo, orden FROM servicios WHERE tenant_id = @tenant AND id = ?', [req.params.id]);
    res.json({ data: actualizado, message: 'Servicio actualizado' });
  } catch (err) {
    fail(res, err);
  }
});

// PATCH /api/admin/servicios/:id/activo — alternar disponibilidad sin borrar nada.
router.patch('/servicios/:id/activo', async (req, res) => {
  try {
    const [[s]] = await req.db.query('SELECT id, activo FROM servicios WHERE tenant_id = @tenant AND id = ?', [req.params.id]);
    if (!s) return res.status(404).json({ error: 'Servicio no encontrado' });
    const activo = req.body.activo === undefined ? (s.activo ? 0 : 1) : (req.body.activo ? 1 : 0);
    await req.db.query('UPDATE servicios SET activo = ? WHERE tenant_id = @tenant AND id = ?', [activo, req.params.id]);
    clearServicios(req.db.tenantId);
    res.json({ data: { id: Number(req.params.id), activo }, message: activo ? 'Servicio activado' : 'Servicio desactivado' });
  } catch (err) {
    fail(res, err);
  }
});

// DELETE /api/admin/servicios/:id — solo si nunca se usó. Si ya hay citas con ese
// nombre se rechaza y se sugiere desactivarlo: borrarlo dejaría en los reportes un
// servicio que ya no se puede volver a ofrecer ni explicar.
router.delete('/servicios/:id', async (req, res) => {
  try {
    const [[s]] = await req.db.query('SELECT id, nombre FROM servicios WHERE tenant_id = @tenant AND id = ?', [req.params.id]);
    if (!s) return res.status(404).json({ error: 'Servicio no encontrado' });

    const [[uso]] = await req.db.query(
      `SELECT COUNT(*) AS n FROM citas ci
       WHERE ci.tenant_id = @tenant
         AND (ci.tipo_servicio = ? OR EXISTS (SELECT 1 FROM cita_servicios cs WHERE cs.tenant_id = @tenant AND cs.cita_id = ci.id AND cs.servicio = ?))`,
      [s.nombre, s.nombre]
    );
    if (uso.n > 0) {
      return res.status(409).json({
        error: `No se puede borrar: ${uso.n} cita${uso.n > 1 ? 's' : ''} lo usaron. Desactivalo para dejar de ofrecerlo.`,
        en_uso: uso.n,
      });
    }
    await req.db.query('DELETE FROM servicios WHERE tenant_id = @tenant AND id = ?', [req.params.id]);
    clearServicios(req.db.tenantId);
    res.json({ message: 'Servicio eliminado' });
  } catch (err) {
    fail(res, err);
  }
});

// ───────────────────────────────────────────────────────────
// Calendario: citas del mes agrupadas por día y por mecánico.
// ───────────────────────────────────────────────────────────
// GET /api/admin/calendario?anio=&mes=  (mes 1-12)
router.get('/calendario', async (req, res) => {
  try {
    const anio = parseInt(req.query.anio, 10) || new Date().getFullYear();
    const mes = Math.min(12, Math.max(1, parseInt(req.query.mes, 10) || (new Date().getMonth() + 1)));
    const [celdas] = await req.db.query(
      `SELECT DAY(ci.fecha) AS dia, ci.tecnico_id, t.nombre AS tecnico_nombre, COUNT(*) AS n
       FROM citas ci
       LEFT JOIN usuarios t ON t.id = ci.tecnico_id AND t.tenant_id = @tenant
       WHERE ci.tenant_id = @tenant AND YEAR(ci.fecha) = ? AND MONTH(ci.fecha) = ? AND ci.estado != 'cancelado'
       GROUP BY dia, ci.tecnico_id, t.nombre
       ORDER BY dia`,
      [anio, mes]
    );
    const [tecnicos] = await req.db.query(
      "SELECT id, nombre FROM usuarios WHERE tenant_id = @tenant AND rol = 'tecnico' AND activo = 1 ORDER BY nombre"
    );
    res.json({ data: { anio, mes, celdas, tecnicos } });
  } catch (err) {
    fail(res, err);
  }
});

// ───────────────────────────────────────────────────────────
// Configuración del taller (fila única).
// ───────────────────────────────────────────────────────────
// GET /api/admin/configuracion
router.get('/configuracion', async (req, res) => {
  try {
    // Los correos de fábrica, para que la pantalla de mensajes los muestre (los de
    // WhatsApp están en el frontend).
    res.json({ data: { ...(await getConfig(req.db)), plantillas_fabrica: { correo: CORREO_FABRICA } } });
  } catch (err) {
    fail(res, err);
  }
});

// PUT /api/admin/configuracion — datos del taller, horarios, capacidad y notificaciones.
router.put('/configuracion', async (req, res) => {
  try {
    const b = req.body || {};
    const num = (v, def) => {
      const n = parseInt(v, 10);
      return Number.isFinite(n) && n > 0 ? n : def;
    };
    // Igual que num pero admite 0 (p. ej. "sin límite" de horas para cancelar).
    const numNoNeg = (v, def) => {
      const n = parseInt(v, 10);
      return Number.isFinite(n) && n >= 0 ? n : def;
    };
    const bit = (v) => (v ? 1 : 0);
    // Texto opcional: recortado y con tope; vacío = NULL.
    const texto = (v, max) => String(v ?? '').trim().slice(0, max) || null;
    // Normaliza horarios: solo los 7 días válidos con campos saneados.
    const horarios = Array.isArray(b.horarios)
      ? b.horarios
          .filter((h) => Number.isInteger(Number(h?.dia)) && Number(h.dia) >= 0 && Number(h.dia) <= 6)
          .map((h) => ({
            dia: Number(h.dia),
            abre: String(h.abre || '08:00').slice(0, 5),
            cierra: String(h.cierra || '17:00').slice(0, 5),
            activo: bit(h.activo),
          }))
      : null;

    // Formas de pago. `valor` es lo que queda escrito en ordenes_trabajo.metodo_pago,
    // así que se normaliza a un identificador estable (sin espacios ni acentos) y, si
    // el nombre viene vacío, la fila se descarta en vez de guardar una opción muda.
    const metodos = Array.isArray(b.metodos_pago)
      ? b.metodos_pago
          .map((m) => ({
            valor: String(m?.valor || m?.etiqueta || '').trim().toLowerCase()
              .normalize('NFD').replace(/[̀-ͯ]/g, '')   // saca los acentos
              .replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
              .slice(0, 30),
            etiqueta: String(m?.etiqueta || '').trim().slice(0, 40),
          }))
          .filter((m) => m.valor && m.etiqueta)
      : null;
    // Una sola variable decide, para que la columna del UPDATE y el parámetro no puedan
    // desalinearse. Si quedó vacío tras normalizar, no se guarda: mejor conservar las
    // formas de pago anteriores que dejar el cierre de orden sin ninguna opción.
    const metodosJson = metodos && metodos.length ? JSON.stringify(metodos) : null;
    // Mensajes al cliente: solo si vienen (un panel viejo no los manda y no se borran).
    const plantillasJson = b.plantillas && typeof b.plantillas === 'object' ? JSON.stringify(normalizarPlantillas(b.plantillas)) : null;
    // Textos del portal, igual: solo si vienen. La fecha de las condiciones se pone sola.
    let portalJson = null;
    if (b.portal_textos && typeof b.portal_textos === 'object') {
      const previa = await getConfig(req.db);
      portalJson = JSON.stringify(textosParaGuardar(b.portal_textos, previa.portal_textos, fechaLocalISO(previa.zona_horaria_offset)));
    }

    // Marca propia según el plan. Si no le toca, logo y color quedan fuera del UPDATE en
    // vez de borrarse: quien los puso en la prueba no los pierde al pasar a gratis.
    const marcaPropia = puedeMarcaPropia(req.db.tenantId);

    await req.db.query(
      `UPDATE configuracion SET
         nombre_taller = ?, telefono = ?, email = ?, direccion = ?,
         ${marcaPropia ? 'logo = ?, color_primario = ?,' : ''}
         razon_social = ?, cedula_juridica = ?, nota_factura = ?,
         pass_min_largo = ?, pass_variedad = ?,
         max_citas_hora = ?, dias_anticipacion = ?, duracion_cita_min = ?, cancelacion_horas_min = ?,
         garantia_dias = ?,
         ${horarios ? 'horarios = ?,' : ''}
         ${metodosJson ? 'metodos_pago = ?,' : ''}
         ${plantillasJson ? 'plantillas = ?,' : ''}
         ${portalJson ? 'portal_textos = ?,' : ''}
         notif_estado = ?, notif_recordatorio = ?, notif_cotizacion = ?, notif_email_entrega = ?
       WHERE id = 1 AND tenant_id = @tenant`,
      [
        // Sin nombre se deja el del propio taller, no uno inventado: poner acá el
        // nombre de otro taller fue justamente el problema que estamos corrigiendo.
        (b.nombre_taller || '').trim() || 'Mi taller',
        (b.telefono || '').trim() || null,
        (b.email || '').trim() || null,
        (b.direccion || '').trim() || null,
        ...(marcaPropia ? [b.logo || null, /^#[0-9a-fA-F]{6}$/.test(b.color_primario || '') ? b.color_primario : null] : []),
        texto(b.razon_social, 150),
        texto(b.cedula_juridica, 30),
        texto(b.nota_factura, 300),
        politica(b).minimo,
        bit(b.pass_variedad),
        num(b.max_citas_hora, 2),
        num(b.dias_anticipacion, 30),
        num(b.duracion_cita_min, 90),
        numNoNeg(b.cancelacion_horas_min, 2),
        numNoNeg(b.garantia_dias, 30),
        ...(horarios ? [JSON.stringify(horarios)] : []),
        ...(metodosJson ? [metodosJson] : []),
        ...(plantillasJson ? [plantillasJson] : []),
        ...(portalJson ? [portalJson] : []),
        bit(b.notif_estado),
        bit(b.notif_recordatorio),
        bit(b.notif_cotizacion),
        bit(b.notif_email_entrega),
      ]
    );
    clearCache(req.db.tenantId);
    // Si mandó logo o color y su plan no los incluye, se lo dice. Guardar en silencio
    // algo que no se aplicó lo dejaría preguntándose por qué su portal sigue igual.
    const aviso = !marcaPropia && (b.logo || b.color_primario)
      ? 'El logo y el color propios son del plan Pro. El resto se guardó.'
      : null;
    res.json({ data: await getConfig(req.db), message: 'Configuración guardada', aviso });
  } catch (err) {
    fail(res, err);
  }
});

// ───────────────────────────────────────────────────────────
// Correo de envío: remitente, dominio en Resend y un correo de prueba.
// ───────────────────────────────────────────────────────────
// GET /api/admin/correo
router.get('/correo', async (req, res) => {
  try {
    res.json({ data: await estadoCorreo() });
  } catch (err) {
    fail(res, err);
  }
});

// POST /api/admin/correo/prueba — al correo de quien lo pide; uno por minuto por persona.
const ultimaPrueba = new Map();
router.post('/correo/prueba', async (req, res) => {
  try {
    const antes = ultimaPrueba.get(req.usuario.id) || 0;
    if (Date.now() - antes < 60 * 1000) {
      return res.status(429).json({ error: 'Esperá un minuto antes de mandar otra prueba' });
    }
    const [[u]] = await req.db.query('SELECT nombre, email FROM usuarios WHERE tenant_id = @tenant AND id = ?', [req.usuario.id]);
    if (!u || !u.email) return res.status(400).json({ error: 'Tu usuario no tiene correo' });
    ultimaPrueba.set(req.usuario.id, Date.now());
    if (!process.env.RESEND_API_KEY) {
      return res.json({ data: { enviado: false, email: u.email }, message: 'El servidor no tiene clave de Resend: el correo no salió (modo desarrollo)' });
    }
    const cfg = await getConfig(req.db);
    const ok = await enviarCorreoPrueba(u.email, { nombre: u.nombre, taller: cfg.nombre_taller });
    if (!ok) return res.status(502).json({ error: 'Resend no aceptó el correo. Revisá el remitente y el dominio.' });
    res.json({ data: { enviado: true, email: u.email }, message: `Correo de prueba enviado a ${u.email}` });
  } catch (err) {
    fail(res, err);
  }
});

// ───────────────────────────────────────────────────────────
// Seguridad del personal: quién tiene verificación en dos pasos, cuándo entró cada
// uno y cerrar sesiones (utils/sesiones.js). La política de contraseñas se guarda con
// el resto de la configuración (pass_min_largo, pass_variedad).
// ───────────────────────────────────────────────────────────
// GET /api/admin/seguridad
router.get('/seguridad', async (req, res) => {
  try {
    const [personal] = await req.db.query(
      `SELECT id, nombre, email, rol, activo, totp_activado, ultimo_ingreso, sesiones_desde_ms
       FROM usuarios WHERE tenant_id = @tenant ORDER BY activo DESC, nombre`
    );
    for (const p of personal) {
      p.es_yo = p.id === req.usuario.id;
      p.sesiones_cerradas = p.sesiones_desde_ms ? new Date(Number(p.sesiones_desde_ms)).toISOString() : null;
      delete p.sesiones_desde_ms;
    }
    res.json({ data: { personal, politica: politica(await getConfig(req.db)) } });
  } catch (err) {
    fail(res, err);
  }
});

// POST /api/admin/seguridad/cerrar — { usuario_id } o { todos: true } (todos menos uno
// mismo). Quien tenga la sesión abierta tiene que volver a entrar.
router.post('/seguridad/cerrar', async (req, res) => {
  try {
    let ids;
    if (req.body?.todos) {
      const [filas] = await req.db.query('SELECT id FROM usuarios WHERE id <> ? AND tenant_id = @tenant', [req.usuario.id]);
      ids = filas.map((f) => f.id);
    } else {
      const id = Number(req.body?.usuario_id);
      if (!id) return invalido(res, 'usuario_id', 'Elegí a quién');
      if (id === req.usuario.id) return invalido(res, 'usuario_id', 'Para cerrar tu propia sesión, salí desde el menú');
      const [[u]] = await req.db.query('SELECT id FROM usuarios WHERE tenant_id = @tenant AND id = ?', [id]);
      if (!u) return res.status(404).json({ error: 'Empleado no encontrado' });
      ids = [id];
    }
    const n = await cerrarSesiones(ids);
    anotar(req.usuario.id, 'cierre_equipo', req.body?.todos ? 'Todo el equipo' : `${n} persona${n === 1 ? '' : 's'}`);
    res.json({
      data: { cerradas: n },
      message: req.body?.todos ? `Sesiones cerradas: ${n} persona${n === 1 ? '' : 's'} tiene${n === 1 ? '' : 'n'} que volver a entrar` : 'Sesión cerrada: tiene que volver a entrar',
    });
  } catch (err) {
    fail(res, err);
  }
});

// ───────────────────────────────────────────────────────────
// Cuenta del administrador logueado.
// ───────────────────────────────────────────────────────────
// PUT /api/admin/cuenta — nombre y correo del propio admin.
router.put('/cuenta', async (req, res) => {
  try {
    const { nombre, email } = req.body;
    if (!nombre || !nombre.trim() || !email || !email.trim()) {
      return res.status(400).json({ error: 'Nombre y correo son requeridos' });
    }
    await req.db.query('UPDATE usuarios SET nombre = ?, email = ? WHERE tenant_id = @tenant AND id = ?', [nombre.trim(), email.trim(), req.usuario.id]);
    anotar(req.usuario.id, 'cuenta');
    const [[u]] = await req.db.query('SELECT id, nombre, email, rol FROM usuarios WHERE tenant_id = @tenant AND id = ?', [req.usuario.id]);
    res.json({ data: u, message: 'Cuenta actualizada' });
  } catch (err) {
    fail(res, err);
  }
});

// PUT /api/admin/cuenta/password — cambia la contraseña verificando la actual.
router.put('/cuenta/password', async (req, res) => {
  try {
    const { actual, nueva } = req.body;
    if (!actual || !nueva) return res.status(400).json({ error: 'Contraseña actual y nueva son requeridas' });
    const [[u]] = await req.db.query('SELECT password_hash, email, nombre FROM usuarios WHERE tenant_id = @tenant AND id = ?', [req.usuario.id]);
    if (!u) return res.status(404).json({ error: 'Usuario no encontrado' });
    const malaClave = problemaDeContrasena(nueva, politica(await getConfig(req.db)), u);
    if (malaClave) return invalido(res, 'nueva', malaClave);
    const ok = await bcrypt.compare(String(actual), u.password_hash);
    if (!ok) return invalido(res, 'actual', 'La contraseña actual no es correcta');
    const hash = await bcrypt.hash(String(nueva), 10);
    await req.db.query('UPDATE usuarios SET password_hash = ? WHERE tenant_id = @tenant AND id = ?', [hash, req.usuario.id]);
    anotar(req.usuario.id, 'contrasena');
    res.json({ message: 'Contraseña actualizada' });
  } catch (err) {
    fail(res, err);
  }
});

router.put('/cuenta/foto', async (req, res) => {
  try {
    const { foto } = req.body;
    if (!fotoValida(foto)) return res.status(400).json({ error: 'Imagen inválida' });
    await req.db.query('UPDATE usuarios SET foto = ? WHERE tenant_id = @tenant AND id = ?', [foto || null, req.usuario.id]);
    if (foto) anotar(req.usuario.id, 'foto');
    res.json({ data: { foto: foto || null }, message: foto ? 'Foto actualizada' : 'Foto eliminada' });
  } catch (err) {
    fail(res, err);
  }
});

// ───────────────────────────────────────────────────────────
// Sucursales (locales del taller). El admin las administra desde Configuración.
// ───────────────────────────────────────────────────────────
// GET /api/admin/sucursales — todas (incluidas las inactivas).
router.get('/sucursales', async (req, res) => {
  try {
    res.json({ data: await getSucursales(req.db) });
  } catch (err) {
    fail(res, err);
  }
});

// POST /api/admin/sucursales — alta de una sucursal nueva.
router.post('/sucursales', async (req, res) => {
  try {
    const nombre = (req.body.nombre || '').trim();
    if (!nombre) return invalido(res, 'nombre', 'Falta el nombre de la sucursal');

    // Tope del plan (ver utils/limites). El plan gratuito incluye una sucursal; el
    // taller que abre la segunda es justamente con el que hay que hablar.
    const tope = await topeAlcanzado(req.db, 'sucursales');
    if (tope) return res.status(402).json({ error: tope, tope: 'sucursales' });

    const [[{ orden }]] = await req.db.query('SELECT COALESCE(MAX(orden), 0) + 1 AS orden FROM sucursales WHERE tenant_id = @tenant');
    const [result] = await req.db.query(
      'INSERT INTO sucursales (tenant_id, nombre, direccion, telefono, orden) VALUES (@tenant, ?, ?, ?, ?)',
      [nombre, (req.body.direccion || '').trim() || null, (req.body.telefono || '').trim() || null, orden]
    );
    clearSucursalesCache(req.db.tenantId);
    const [[nueva]] = await req.db.query('SELECT id, nombre, direccion, telefono, activa, orden FROM sucursales WHERE tenant_id = @tenant AND id = ?', [result.insertId]);
    res.status(201).json({ data: nueva, message: 'Sucursal creada' });
  } catch (err) {
    fail(res, err);
  }
});

// PUT /api/admin/sucursales/:id — edita nombre/dirección/teléfono.
router.put('/sucursales/:id', async (req, res) => {
  try {
    const nombre = (req.body.nombre || '').trim();
    if (!nombre) return invalido(res, 'nombre', 'Falta el nombre de la sucursal');
    const [result] = await req.db.query(
      'UPDATE sucursales SET nombre = ?, direccion = ?, telefono = ? WHERE tenant_id = @tenant AND id = ?',
      [nombre, (req.body.direccion || '').trim() || null, (req.body.telefono || '').trim() || null, req.params.id]
    );
    if (!result.affectedRows) return res.status(404).json({ error: 'Sucursal no encontrada' });
    clearSucursalesCache(req.db.tenantId);
    const [[actualizada]] = await req.db.query('SELECT id, nombre, direccion, telefono, activa, orden FROM sucursales WHERE tenant_id = @tenant AND id = ?', [req.params.id]);
    res.json({ data: actualizada, message: 'Sucursal actualizada' });
  } catch (err) {
    fail(res, err);
  }
});

// PATCH /api/admin/sucursales/:id/activa — activa/desactiva (no deja cero activas).
router.patch('/sucursales/:id/activa', async (req, res) => {
  try {
    const activa = req.body.activa ? 1 : 0;
    if (!activa) {
      const [[{ activas }]] = await req.db.query('SELECT COUNT(*) AS activas FROM sucursales WHERE tenant_id = @tenant AND activa = 1 AND id <> ?', [req.params.id]);
      if (!activas) return res.status(400).json({ error: 'Debe quedar al menos una sucursal activa' });
    } else {
      // Reactivar suma una sucursal igual que el alta: mismo tope (ver usuarios.routes,
      // que tenía el mismo hueco). Solo cuenta si de verdad pasa de inactiva a activa.
      const [[s]] = await req.db.query('SELECT activa FROM sucursales WHERE tenant_id = @tenant AND id = ?', [req.params.id]);
      if (!s) return res.status(404).json({ error: 'Sucursal no encontrada' });
      if (!s.activa) {
        const tope = await topeAlcanzado(req.db, 'sucursales');
        if (tope) return res.status(402).json({ error: tope, tope: 'sucursales' });
      }
    }
    const [result] = await req.db.query('UPDATE sucursales SET activa = ? WHERE tenant_id = @tenant AND id = ?', [activa, req.params.id]);
    if (!result.affectedRows) return res.status(404).json({ error: 'Sucursal no encontrada' });
    clearSucursalesCache(req.db.tenantId);
    res.json({ message: activa ? 'Sucursal activada' : 'Sucursal desactivada' });
  } catch (err) {
    fail(res, err);
  }
});

// ───────────────────────────────────────────────────────────
// Roles (Equipo → Roles). Los cuatro de fábrica más los propios, que parten de
// Mostrador o de Taller y solo pueden quitar casillas (ver utils/permisos.js). El
// servidor las respeta en cada ruta (middleware/permisos.js).
// ───────────────────────────────────────────────────────────
const MAX_ROLES_PROPIOS = 30;
// Los de fábrica que se pueden editar: sus casillas, no el nombre. Administrador puede
// todo siempre, y Contenido se arma por persona (permisos del sitio web).
const FABRICA_EDITABLE = ['recepcion', 'tecnico'];

function leerPermisos(r) {
  try { return JSON.parse(r.permisos || '[]'); } catch { return []; }
}

async function cargarRol(db, id) {
  const [[r]] = await db.query(
    'SELECT id, clave, nombre, base, descripcion, permisos, de_fabrica FROM roles WHERE tenant_id = @tenant AND id = ?',
    [id]
  );
  return r ? { ...r, permisos: leerPermisos(r) } : null;
}

// GET /api/admin/roles — los roles con sus casillas y cuántos empleados activos tiene
// cada uno, más el catálogo y, por base, qué casillas se eligen y cuáles van siempre.
router.get('/roles', async (req, res) => {
  try {
    const [roles] = await req.db.query(
      `SELECT id, clave, nombre, base, descripcion, permisos, de_fabrica
       FROM roles WHERE tenant_id = @tenant ORDER BY de_fabrica DESC, id`
    );
    // Se cuenta en JavaScript y no con un JOIN: así no se compara usuarios.rol con
    // roles.clave en SQL (ver la collation de roles en auto-migrate.js).
    const [usuarios] = await req.db.query('SELECT rol, rol_id FROM usuarios WHERE tenant_id = @tenant AND activo = 1');
    const porId = new Map(roles.map((r) => [r.id, r]));
    const conteo = new Map();
    for (const u of usuarios) {
      const propio = u.rol_id && porId.get(u.rol_id);
      const rol = propio && propio.base === BASE_DE_ROL[u.rol] ? propio : roles.find((r) => r.clave === u.rol);
      if (rol) conteo.set(rol.id, (conteo.get(rol.id) || 0) + 1);
    }
    const todos = CATALOGO.flatMap((g) => g.permisos.map((p) => p.id));
    const datos = roles.map((r) => {
      const fabrica = !!r.de_fabrica;
      return {
        ...r,
        // Lo que de verdad puede: con las fijas de su base, que no se guardan.
        permisos: r.clave === 'admin' ? todos : permisosEfectivos(ROL_DE_BASE[r.base], { base: r.base, permisos: leerPermisos(r) }),
        de_fabrica: fabrica ? 1 : 0,
        empleados: conteo.get(r.id) || 0,
        editable: !fabrica || FABRICA_EDITABLE.includes(r.clave),
        borrable: !fabrica,
      };
    });
    const porBase = Object.fromEntries(BASES_PROPIAS.map((b) => [b, { ajustables: ajustables(b), fijas: FIJAS[b] }]));
    res.json({ data: { roles: datos, catalogo: CATALOGO, bases: BASES, bases_propias: porBase } });
  } catch (err) {
    fail(res, err);
  }
});

// POST /api/admin/roles — crea un rol propio.
router.post('/roles', async (req, res) => {
  try {
    const v = validarRolPropio(req.body);
    if (v.error) return invalido(res, v.campo, v.error);
    const [[{ n }]] = await req.db.query('SELECT COUNT(*) AS n FROM roles WHERE tenant_id = @tenant AND de_fabrica = 0');
    if (n >= MAX_ROLES_PROPIOS) return res.status(400).json({ error: `Se pueden tener hasta ${MAX_ROLES_PROPIOS} roles propios` });
    const [[repetido]] = await req.db.query('SELECT id FROM roles WHERE tenant_id = @tenant AND LOWER(nombre) = LOWER(?)', [v.datos.nombre]);
    if (repetido) return invalido(res, 'nombre', 'Ya hay un rol con ese nombre');
    const [r] = await req.db.query(
      'INSERT INTO roles (tenant_id, clave, nombre, base, descripcion, permisos, de_fabrica) VALUES (@tenant, NULL, ?, ?, ?, ?, 0)',
      [v.datos.nombre, v.datos.base, v.datos.descripcion, JSON.stringify(v.datos.permisos)]
    );
    registrarEvento('rol_editado', { ip: req.ip, actorId: req.usuario.id, detalle: `Creó el rol «${v.datos.nombre}»` });
    res.status(201).json({ data: await cargarRol(req.db, r.insertId), message: `Rol «${v.datos.nombre}» creado` });
  } catch (err) {
    fail(res, err);
  }
});

// PUT /api/admin/roles/:id — cambia las casillas (y, en uno propio, el nombre y la
// descripción). La base no cambia: movería de pantalla a todos los que lo tienen.
router.put('/roles/:id', async (req, res) => {
  try {
    const rol = await cargarRol(req.db, req.params.id);
    if (!rol) return res.status(404).json({ error: 'Rol no encontrado' });
    if (rol.de_fabrica && !FABRICA_EDITABLE.includes(rol.clave)) {
      return res.status(409).json({ error: `El rol ${rol.nombre} no se puede cambiar` });
    }
    // En uno de fábrica solo cambian las casillas: el nombre y la descripción quedan.
    const cuerpo = rol.de_fabrica ? { ...req.body, nombre: rol.nombre, descripcion: rol.descripcion } : req.body;
    const v = validarRolPropio(cuerpo, { baseFija: rol.base });
    if (v.error) return invalido(res, v.campo, v.error);
    if (!rol.de_fabrica) {
      const [[repetido]] = await req.db.query('SELECT id FROM roles WHERE tenant_id = @tenant AND LOWER(nombre) = LOWER(?) AND id <> ?', [v.datos.nombre, rol.id]);
      if (repetido) return invalido(res, 'nombre', 'Ya hay un rol con ese nombre');
    }
    await req.db.query(
      'UPDATE roles SET nombre = ?, descripcion = ?, permisos = ? WHERE tenant_id = @tenant AND id = ?',
      [v.datos.nombre, v.datos.descripcion, JSON.stringify(v.datos.permisos), rol.id]
    );
    registrarEvento('rol_editado', { ip: req.ip, actorId: req.usuario.id, detalle: `Cambió las casillas de «${v.datos.nombre}»` });
    res.json({ data: await cargarRol(req.db, rol.id), message: `Rol «${v.datos.nombre}» guardado` });
  } catch (err) {
    fail(res, err);
  }
});

// POST /api/admin/roles/:id/restablecer — un rol de fábrica vuelve a sus casillas de
// siempre.
router.post('/roles/:id/restablecer', async (req, res) => {
  try {
    const rol = await cargarRol(req.db, req.params.id);
    if (!rol) return res.status(404).json({ error: 'Rol no encontrado' });
    const original = ROLES_FABRICA.find((r) => r.clave === rol.clave);
    if (!rol.de_fabrica || !original || !FABRICA_EDITABLE.includes(rol.clave)) {
      return res.status(409).json({ error: 'Solo se restablecen los roles de fábrica que se pueden editar' });
    }
    await req.db.query('UPDATE roles SET permisos = ? WHERE tenant_id = @tenant AND id = ?', [JSON.stringify(original.permisos), rol.id]);
    registrarEvento('rol_editado', { ip: req.ip, actorId: req.usuario.id, detalle: `Volvió «${rol.nombre}» a las casillas de fábrica` });
    res.json({ data: await cargarRol(req.db, rol.id), message: `${rol.nombre} volvió a sus casillas de fábrica` });
  } catch (err) {
    fail(res, err);
  }
});

// DELETE /api/admin/roles/:id — borra un rol propio. Si alguien activo lo tiene, no:
// primero hay que pasarlo a otro rol. Los inactivos que lo tenían vuelven al de fábrica.
router.delete('/roles/:id', async (req, res) => {
  try {
    const rol = await cargarRol(req.db, req.params.id);
    if (!rol) return res.status(404).json({ error: 'Rol no encontrado' });
    if (rol.de_fabrica) return res.status(409).json({ error: 'Los roles de fábrica no se pueden eliminar' });
    const [[{ n }]] = await req.db.query('SELECT COUNT(*) AS n FROM usuarios WHERE tenant_id = @tenant AND rol_id = ? AND activo = 1', [rol.id]);
    if (n) {
      return res.status(409).json({
        error: n === 1
          ? 'Un empleado tiene este rol. Pasalo a otro rol en Gestión de empleados antes de eliminarlo.'
          : `${n} empleados tienen este rol. Pasalos a otro rol en Gestión de empleados antes de eliminarlo.`,
      });
    }
    await req.db.query('UPDATE usuarios SET rol_id = NULL WHERE tenant_id = @tenant AND rol_id = ?', [rol.id]);
    await req.db.query('DELETE FROM roles WHERE tenant_id = @tenant AND id = ? AND de_fabrica = 0', [rol.id]);
    registrarEvento('rol_editado', { ip: req.ip, actorId: req.usuario.id, detalle: `Eliminó el rol «${rol.nombre}»` });
    res.json({ message: `Rol «${rol.nombre}» eliminado` });
  } catch (err) {
    fail(res, err);
  }
});

// ───────────────────────────────────────────────────────────
// Bloquear horario: horas o días en que no se agenda (feriado, capacitación, un
// trabajo grande). En esas horas el portal no ofrece nada y recepción no puede
// agendar. Las citas que ya estaban NO se cancelan: se avisa cuántas hay para que
// administración las reprograme.
// ───────────────────────────────────────────────────────────
const MAX_DIAS_BLOQUEO = 366;
const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;
const HORA_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

// Citas (no canceladas) que caen dentro de un bloqueo.
async function citasDentroDeBloqueo(db, b, config) {
  let sql = `SELECT id, DATE_FORMAT(fecha, '%Y-%m-%d') AS fecha, TIME_FORMAT(hora, '%H:%i') AS hora, duracion_horas
             FROM citas WHERE tenant_id = @tenant AND fecha BETWEEN ? AND ? AND estado <> 'cancelado'`;
  const params = [b.fecha_desde, b.fecha_hasta];
  if (b.sucursal_id) { sql += ' AND sucursal_id = ?'; params.push(b.sucursal_id); }
  const [citas] = await db.query(sql, params);
  return citas.filter((c) => {
    const horasDia = horasDisponibles(c.fecha, config);
    const tapadas = horasDeBloqueo(b, horasDia);
    return horasDeCita(c.hora, c.duracion_horas, horasDia).some((h) => tapadas.includes(h));
  }).length;
}

const SELECT_BLOQUEOS = `
  SELECT b.id, b.sucursal_id, s.nombre AS sucursal_nombre,
         DATE_FORMAT(b.fecha_desde, '%Y-%m-%d') AS fecha_desde, DATE_FORMAT(b.fecha_hasta, '%Y-%m-%d') AS fecha_hasta,
         TIME_FORMAT(b.hora_desde, '%H:%i') AS hora_desde, TIME_FORMAT(b.hora_hasta, '%H:%i') AS hora_hasta,
         b.motivo, u.nombre AS creado_por_nombre, b.created_at
  FROM bloqueos_horario b
  LEFT JOIN sucursales s ON s.id = b.sucursal_id AND s.tenant_id = @tenant
  LEFT JOIN usuarios u ON u.id = b.creado_por AND u.tenant_id = @tenant
  WHERE b.tenant_id = @tenant`;

// GET /api/admin/bloqueos — los que todavía no terminaron, del más próximo al más lejano.
router.get('/bloqueos', async (req, res) => {
  try {
    const config = await getConfig(req.db);
    const hoy = fechaLocalISO(config.zona_horaria_offset);
    const [rows] = await req.db.query(`${SELECT_BLOQUEOS} AND b.fecha_hasta >= ? ORDER BY b.fecha_desde, b.hora_desde`, [hoy]);
    for (const b of rows) b.citas_afectadas = await citasDentroDeBloqueo(req.db, b, config);
    res.json({ data: rows });
  } catch (err) {
    fail(res, err);
  }
});

// POST /api/admin/bloqueos — { sucursal_id?, fecha_desde, fecha_hasta?, hora_desde?, hora_hasta?, motivo }
// Sin sucursal = las dos sedes. Sin horas = el día entero.
router.post('/bloqueos', async (req, res) => {
  try {
    const b = req.body || {};
    const fechaDesde = String(b.fecha_desde || '').slice(0, 10);
    const fechaHasta = String(b.fecha_hasta || fechaDesde).slice(0, 10);
    if (!FECHA_RE.test(fechaDesde) || !FECHA_RE.test(fechaHasta)) return invalido(res, 'fecha_desde', 'Elegí las fechas');
    if (fechaHasta < fechaDesde) return invalido(res, 'fecha_hasta', 'La fecha final no puede ser antes de la inicial');
    if (fechasEntre(fechaDesde, fechaHasta).length > MAX_DIAS_BLOQUEO) {
      return invalido(res, 'fecha_hasta', 'Un bloqueo puede durar hasta un año');
    }
    const config = await getConfig(req.db);
    if (fechaHasta < fechaLocalISO(config.zona_horaria_offset)) {
      return invalido(res, 'fecha_desde', 'Esas fechas ya pasaron');
    }
    let horaDesde = null;
    let horaHasta = null;
    if (!b.todo_el_dia) {
      horaDesde = String(b.hora_desde || '').slice(0, 5);
      horaHasta = String(b.hora_hasta || '').slice(0, 5);
      if (!HORA_RE.test(horaDesde) || !HORA_RE.test(horaHasta)) return invalido(res, 'hora_desde', 'Elegí las horas, o marcá «Todo el día»');
      if (horaHasta <= horaDesde) return invalido(res, 'hora_hasta', 'La hora final tiene que ser después de la inicial');
    }
    let sucursalId = null;
    if (b.sucursal_id) {
      const [[s]] = await req.db.query('SELECT id FROM sucursales WHERE tenant_id = @tenant AND id = ?', [b.sucursal_id]);
      if (!s) return invalido(res, 'sucursal_id', 'Sucursal no válida');
      sucursalId = s.id;
    }
    const motivo = String(b.motivo || '').trim();
    if (motivo.length < 3) return invalido(res, 'motivo', 'Escribí el motivo (lo ve el equipo)');
    if (motivo.length > 150) return invalido(res, 'motivo', 'El motivo no puede pasar de 150 caracteres');

    const [r] = await req.db.query(
      `INSERT INTO bloqueos_horario (tenant_id, sucursal_id, fecha_desde, fecha_hasta, hora_desde, hora_hasta, motivo, creado_por)
       VALUES (@tenant, ?, ?, ?, ?, ?, ?, ?)`,
      [sucursalId, fechaDesde, fechaHasta, horaDesde, horaHasta, motivo, req.usuario.id]
    );
    const [[nuevo]] = await req.db.query(`${SELECT_BLOQUEOS} AND b.id = ?`, [r.insertId]);
    nuevo.citas_afectadas = await citasDentroDeBloqueo(req.db, nuevo, config);
    res.status(201).json({ data: nuevo, message: 'Horario bloqueado' });
  } catch (err) {
    fail(res, err);
  }
});

// ───────────────────────────────────────────────────────────
// Feriados que se repiten (utils/feriados.js).
// ───────────────────────────────────────────────────────────
// GET /api/admin/feriados — los marcados, con su próxima fecha y cuántas citas ya hay
// ese día; y los de ley que todavía no se marcaron.
router.get('/feriados', async (req, res) => {
  try {
    const config = await getConfig(req.db);
    const hoy = fechaLocalISO(config.zona_horaria_offset);
    const [rows] = await req.db.query(
      `SELECT f.id, f.mes, f.dia, f.nombre, f.sucursal_id, s.nombre AS sucursal_nombre
       FROM feriados f LEFT JOIN sucursales s ON s.id = f.sucursal_id AND s.tenant_id = @tenant
       WHERE f.tenant_id = @tenant ORDER BY f.mes, f.dia`
    );
    for (const f of rows) {
      f.proxima = proximaFecha(f.mes, f.dia, hoy);
      let sql = "SELECT COUNT(*) AS n FROM citas WHERE tenant_id = @tenant AND fecha = ? AND estado <> 'cancelado'";
      const params = [f.proxima];
      if (f.sucursal_id) { sql += ' AND sucursal_id = ?'; params.push(f.sucursal_id); }
      const [[c]] = await req.db.query(sql, params);
      f.citas_afectadas = Number(c.n) || 0;
    }
    rows.sort((a, b) => String(a.proxima).localeCompare(String(b.proxima)));
    const sugeridos = FERIADOS_CR.filter((d) => !rows.some((f) => f.mes === d.mes && f.dia === d.dia && !f.sucursal_id))
      .map((d) => ({ ...d, proxima: proximaFecha(d.mes, d.dia, hoy) }));
    res.json({ data: { feriados: rows, sugeridos } });
  } catch (err) {
    fail(res, err);
  }
});

// POST /api/admin/feriados — { mes, dia, nombre, sucursal_id? } o { lista: [...] }
// para marcar varios de una vez. Sin sucursal = todas las sedes.
router.post('/feriados', async (req, res) => {
  try {
    const lista = Array.isArray(req.body?.lista) ? req.body.lista : [req.body || {}];
    if (!lista.length || lista.length > 40) return invalido(res, 'lista', 'Elegí al menos un feriado');
    const [actuales] = await req.db.query('SELECT mes, dia, sucursal_id FROM feriados WHERE tenant_id = @tenant');
    const nuevos = [];
    for (const f of lista) {
      const mes = Number(f.mes);
      const dia = Number(f.dia);
      if (!fechaValida(mes, dia)) return invalido(res, 'dia', 'Esa fecha no existe');
      const nombre = String(f.nombre || '').trim();
      if (nombre.length < 3) return invalido(res, 'nombre', 'Escribí el nombre del feriado');
      if (nombre.length > 80) return invalido(res, 'nombre', 'El nombre no puede pasar de 80 caracteres');
      let sucursalId = null;
      if (f.sucursal_id) {
        const [[s]] = await req.db.query('SELECT id FROM sucursales WHERE id = ? AND tenant_id = @tenant', [f.sucursal_id]);
        if (!s) return invalido(res, 'sucursal_id', 'Sucursal no válida');
        sucursalId = s.id;
      }
      const repetido = (x) => Number(x.mes) === mes && Number(x.dia) === dia && (x.sucursal_id || null) === sucursalId;
      if (actuales.some(repetido) || nuevos.some(repetido)) continue; // ya estaba: no se duplica
      nuevos.push({ mes, dia, nombre, sucursal_id: sucursalId });
    }
    for (const f of nuevos) {
      await req.db.query('INSERT INTO feriados (tenant_id, mes, dia, nombre, sucursal_id, creado_por) VALUES (@tenant, ?, ?, ?, ?, ?)',
        [f.mes, f.dia, f.nombre, f.sucursal_id, req.usuario.id]);
    }
    const n = nuevos.length;
    res.status(201).json({
      data: { agregados: n },
      message: n ? `${n === 1 ? 'Feriado marcado' : n + ' feriados marcados'}: se bloquean todos los años` : 'Ya estaba marcado',
    });
  } catch (err) {
    fail(res, err);
  }
});

// DELETE /api/admin/feriados/:id — deja de bloquearse (desde este año).
router.delete('/feriados/:id', async (req, res) => {
  try {
    const [r] = await req.db.query('DELETE FROM feriados WHERE tenant_id = @tenant AND id = ?', [req.params.id]);
    if (!r.affectedRows) return res.status(404).json({ error: 'Feriado no encontrado' });
    res.json({ message: 'Feriado quitado: ese día se vuelve a ofrecer' });
  } catch (err) {
    fail(res, err);
  }
});

// DELETE /api/admin/bloqueos/:id — quita el bloqueo (esas horas se vuelven a ofrecer).
router.delete('/bloqueos/:id', async (req, res) => {
  try {
    const [r] = await req.db.query('DELETE FROM bloqueos_horario WHERE tenant_id = @tenant AND id = ?', [req.params.id]);
    if (!r.affectedRows) return res.status(404).json({ error: 'Bloqueo no encontrado' });
    res.json({ message: 'Bloqueo quitado' });
  } catch (err) {
    fail(res, err);
  }
});

module.exports = router;
