const router = require('express').Router();
const bcrypt = require('bcrypt');
// Sin `pool`: todo el acceso pasa por req.db, scopeado al taller.
const { anotar } = require('../utils/actividad');
const { filtrarAvisos } = require('../utils/preferencias');
const { fail, invalido } = require('../utils/responder');
const auth = require('../middleware/auth');
const requireRol = require('../middleware/roles');
const { soloRoles } = require('../middleware/roles');
const { generarNumeroOrden, sincronizarCitaDesdeOrden, cerrarOrden, totalOrden, esAdicional, registrarAprobacion, revisarAdicional } = require('../utils/ordenes');
const { ESTADOS_REPUESTO, estadoAlEditarRepuesto } = require('../utils/reglas-orden');
const { getConfig, horasDisponibles } = require('../utils/configuracion');
const { politica, problemaDeContrasena } = require('../utils/contrasena');
const { agendaDia, horasPasadas } = require('../utils/agenda');
const { getServicios } = require('../utils/servicios');
const { getSucursales, tecnicoEnSucursal } = require('../utils/sucursales');
const { cargarAlcance, soloSucursal, exigirSucursal, SUCURSAL_DE_ORDEN, SUCURSAL_DE_CITA } = require('../utils/alcance');
const { notificarMecanico } = require('../utils/notificaciones');
const { LEIDO_POR_MI, VISTO_POR_OTRO, marcarLeidos } = require('../utils/mensajes');
const { fotoValida } = require('../utils/validar');
const { exigirPermiso } = require('../middleware/permisos');
const { hoySQL } = require('../utils/sql-fechas');

// Panel de recepción: intermediaria entre cliente y mecánico.
// Accesible a recepción y superiores.
// Solo mostrador y administración. Con requireRol('recepcion') pasaba también el
// mecánico (la jerarquía es recepcion < tecnico < admin): podía armar y enviar
// cotizaciones, tocar costos, abrir órdenes y avisar a clientes. Sus pantallas no
// usan esta API: lo suyo está en /api/mecanico.
router.use(auth, soloRoles('recepcion', 'admin'));
// Quien tiene una sucursal ve solo lo de ella (utils/alcance.js): las listas se
// filtran abajo, y una cita u orden de la otra sucursal da 404.
router.use(cargarAlcance);
router.use('/citas/:id', exigirSucursal(SUCURSAL_DE_CITA));
router.use('/ordenes/:id', exigirSucursal(SUCURSAL_DE_ORDEN));
router.use('/cotizaciones/:id', exigirSucursal(SUCURSAL_DE_ORDEN));

// Estados de la orden que NO se consideran activos.
const ORDEN_CERRADA = ['entregada', 'cancelada'];

// ───────────────────────────────────────────────────────────
// 1.1 Resumen del día
// ───────────────────────────────────────────────────────────
router.get('/resumen', async (req, res) => {
  try {
    // Hoy del taller, no el de la base (utils/sql-fechas.js).
    const hoy = hoySQL((await getConfig(req.db)).zona_horaria_offset);
    const [[{ citas_hoy }]] = await req.db.query(
      `SELECT COUNT(*) AS citas_hoy FROM citas WHERE tenant_id = @tenant AND fecha = ${hoy}${soloSucursal(req, 'sucursal_id')}`
    );
    const [[{ ordenes_activas }]] = await req.db.query(
      `SELECT COUNT(*) AS ordenes_activas FROM ordenes_trabajo WHERE tenant_id = @tenant AND estado NOT IN ('entregada','cancelada')${soloSucursal(req, 'sucursal_id')}`
    );
    const [[{ cotizaciones_pendientes }]] = await req.db.query(
      `SELECT COUNT(*) AS cotizaciones_pendientes FROM ordenes_trabajo WHERE tenant_id = @tenant AND estado = 'esperando_aprobacion' AND aprobacion_cliente = 'pendiente'${soloSucursal(req, 'sucursal_id')}`
    );
    // "Ocupado" = el técnico tiene trabajo activo en cualquiera de los dos mundos
    // (una cita en proceso hoy, o una orden de trabajo abierta). Misma población
    // que mecanicos_totales, así el cociente X/Y es coherente.
    const [[{ mecanicos_ocupados }]] = await req.db.query(
      `SELECT COUNT(*) AS mecanicos_ocupados FROM usuarios u
       WHERE u.tenant_id = @tenant AND u.rol = 'tecnico' AND u.activo = 1${soloSucursal(req, 'u.sucursal_id')} AND (
         EXISTS (SELECT 1 FROM citas c
                 WHERE c.tenant_id = @tenant AND c.tecnico_id = u.id AND c.fecha = ${hoy}
                   AND c.estado IN ('en_revision','en_mantenimiento'))
         OR EXISTS (SELECT 1 FROM ordenes_trabajo o
                    WHERE o.tecnico_id = u.id AND o.estado NOT IN ('entregada','cancelada')
                      AND o.tenant_id = @tenant)
       )`
    );
    const [[{ mecanicos_totales }]] = await req.db.query(
      `SELECT COUNT(*) AS mecanicos_totales FROM usuarios WHERE tenant_id = @tenant AND rol = 'tecnico' AND activo = 1${soloSucursal(req, 'sucursal_id')}`
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
      `SELECT ci.id, ci.fecha, to_char(ci.hora, 'HH24:MI') AS hora, ci.motivo, ci.tipo_servicio, ci.servicios, ci.estado, ci.monto, ci.vehiculo_id,
              ci.confirmada_cliente, ci.hora_llegada, ci.no_show, ci.orden_id, o.numero_orden,
              c.id AS cliente_id, c.nombre AS cliente_nombre, c.apellido AS cliente_apellido, c.telefono AS cliente_telefono,
              m.marca, m.modelo, m.placa,
              t.nombre AS tecnico_nombre,
              ci.sucursal_id, s.nombre AS sucursal_nombre
       FROM citas ci
       JOIN clientes c ON ci.cliente_id = c.id AND c.tenant_id = @tenant
       LEFT JOIN vehiculos m ON ci.vehiculo_id = m.id AND m.tenant_id = @tenant
       LEFT JOIN usuarios t ON ci.tecnico_id = t.id AND t.tenant_id = @tenant
       LEFT JOIN ordenes_trabajo o ON o.id = ci.orden_id AND o.tenant_id = @tenant
       LEFT JOIN sucursales s ON s.id = ci.sucursal_id AND s.tenant_id = @tenant
       WHERE ci.tenant_id = @tenant AND ci.fecha = ${hoySQL((await getConfig(req.db)).zona_horaria_offset)} AND ci.estado <> 'cancelado'${soloSucursal(req, 'ci.sucursal_id')}
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
      `SELECT ci.id, to_char(ci.fecha, 'YYYY-MM-DD') AS fecha, to_char(ci.hora, 'HH24:MI') AS hora,
              ci.motivo, ci.tipo_servicio, ci.servicios, ci.estado, ci.confirmada_cliente, ci.hora_llegada,
              ci.no_show, ci.orden_id, o.numero_orden,
              c.id AS cliente_id, c.nombre AS cliente_nombre, c.apellido AS cliente_apellido, c.telefono AS cliente_telefono,
              m.marca, m.modelo, m.placa,
              t.nombre AS tecnico_nombre,
              ci.sucursal_id, s.nombre AS sucursal_nombre
       FROM citas ci
       JOIN clientes c ON ci.cliente_id = c.id AND c.tenant_id = @tenant
       LEFT JOIN vehiculos m ON ci.vehiculo_id = m.id AND m.tenant_id = @tenant
       LEFT JOIN usuarios t ON ci.tecnico_id = t.id AND t.tenant_id = @tenant
       LEFT JOIN ordenes_trabajo o ON o.id = ci.orden_id AND o.tenant_id = @tenant
       LEFT JOIN sucursales s ON s.id = ci.sucursal_id AND s.tenant_id = @tenant
       WHERE ci.tenant_id = @tenant AND ci.fecha BETWEEN ? AND ? AND ci.estado <> 'cancelado'${soloSucursal(req, 'ci.sucursal_id')}
       ORDER BY ci.fecha ASC, ci.hora ASC`,
      [desde, hasta]
    );
    res.json({ data: rows });
  } catch (err) {
    fail(res, err);
  }
});

// Crear (o recuperar) la orden de trabajo de una cita: activa el puente cita ↔ orden.
// Lo usan recepción (Inicio → citas de hoy) y administración (Gestión de citas →
// Citas, cualquier fecha). Body opcional { vehiculo_id }: una cita agendada sin moto
// necesita una para la orden; la pantalla la pide (una del cliente, o una que se
// registra en el momento) y se le asigna también a la cita.
router.post('/citas/:id/crear-orden', exigirPermiso('ordenes.crear'), async (req, res) => {
  try {
    const [[cita]] = await req.db.query(
      'SELECT id, cliente_id, vehiculo_id, motivo, tecnico_id, sucursal_id, orden_id, estado FROM citas WHERE tenant_id = @tenant AND id = ?',
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
    if (['cancelado', 'entregado'].includes(cita.estado)) {
      return res.status(409).json({ error: cita.estado === 'cancelado' ? 'La cita está cancelada' : 'La cita ya se entregó' });
    }
    let motoId = cita.vehiculo_id;
    if (req.body?.vehiculo_id) {
      const [[moto]] = await req.db.query('SELECT id FROM vehiculos WHERE tenant_id = @tenant AND id = ? AND cliente_id = ? AND activa = 1', [req.body.vehiculo_id, cita.cliente_id]);
      if (!moto) return invalido(res, 'vehiculo_id', 'Ese vehículo no es de este cliente');
      motoId = moto.id;
    }
    if (!motoId) {
      return res.status(400).json({ error: 'La cita no tiene vehículo: elegí o registrá una para abrir la orden', campo: 'vehiculo_id', codigo: 'sin_moto' });
    }

    const conn = await req.db.conexion();
    try {
      await conn.beginTransaction();
      // Si dos personas tocan "Crear orden" a la vez, la segunda espera aquí y
      // recibe la orden que creó la primera, en vez de abrir otra. El número de
      // orden se pide después, para que ese segundo clic no gaste uno.
      const [[actual]] = await conn.query('SELECT orden_id FROM citas WHERE tenant_id = @tenant AND id = ? FOR UPDATE', [req.params.id]);
      if (actual?.orden_id) {
        await conn.rollback();
        const [[o]] = await req.db.query('SELECT id, numero_orden FROM ordenes_trabajo WHERE tenant_id = @tenant AND id = ?', [actual.orden_id]);
        return res.json({ data: { orden_id: o.id, numero_orden: o.numero_orden }, message: 'La cita ya tiene una orden' });
      }
      const numero_orden = await generarNumeroOrden(conn);
      const [result] = await conn.query(
        `INSERT INTO ordenes_trabajo
          (tenant_id, numero_orden, vehiculo_id, cliente_id, sucursal_id, recepcionista_id, tecnico_id, problema_reportado, estado)
         VALUES (@tenant, ?, ?, ?, ?, ?, ?, ?, 'diagnostico')`,
        [numero_orden, motoId, cita.cliente_id, cita.sucursal_id || null, req.usuario.id, cita.tecnico_id || null, cita.motivo || 'Orden generada desde la cita']
      );
      await conn.query('INSERT INTO orden_tiempos (tenant_id, orden_id, etapa) VALUES (@tenant, ?, ?)', [result.insertId, 'diagnostico']);
      await conn.query('UPDATE citas SET orden_id = ?, vehiculo_id = ? WHERE tenant_id = @tenant AND id = ?', [result.insertId, motoId, req.params.id]);
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
router.patch('/citas/:id/llegada', exigirPermiso('citas.agendar'), async (req, res) => {
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
router.delete('/citas/:id/llegada', exigirPermiso('citas.agendar'), async (req, res) => {
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
//   sin_entregar → una orden o cita sin orden lista hace más de 2 días (va primero)
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
       JOIN vehiculos m ON m.id = o.vehiculo_id AND m.tenant_id = @tenant
       LEFT JOIN usuarios u ON u.id = o.tecnico_id AND u.tenant_id = @tenant
       WHERE f.tenant_id = @tenant AND o.estado NOT IN ('entregada','cancelada')${soloSucursal(req, 'o.sucursal_id')}
         AND f.created_at >= NOW() - INTERVAL '24 hours'
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
       JOIN vehiculos m ON m.id = o.vehiculo_id AND m.tenant_id = @tenant
       WHERE t.tenant_id = @tenant AND t.etapa = 'lista_entrega' AND t.fin IS NULL
         AND o.estado = 'lista_entrega'${soloSucursal(req, 'o.sucursal_id')}
         AND t.inicio >= NOW() - INTERVAL '24 hours'
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
       JOIN vehiculos m ON m.id = o.vehiculo_id AND m.tenant_id = @tenant
       WHERE o.tenant_id = @tenant AND o.aprobacion_cliente IN ('aprobado','rechazado')${soloSucursal(req, 'o.sucursal_id')}
         AND o.fecha_aprobacion >= NOW() - INTERVAL '24 hours'
       ORDER BY o.fecha_aprobacion DESC LIMIT 10`
    );
    // Citas que el cliente agendó solo desde el portal (sin usuario de mostrador).
    const [citasNuevas] = await req.db.query(
      `SELECT 'cita_nueva' AS tipo, ci.created_at,
              ci.id AS cita_id, to_char(ci.fecha, 'DD/MM') AS fecha_corta,
              to_char(ci.hora, 'HH24:MI') AS hora,
              c.nombre AS cliente_nombre, c.apellido AS cliente_apellido,
              m.marca, m.modelo
       FROM citas ci
       JOIN clientes c ON c.id = ci.cliente_id AND c.tenant_id = @tenant
       LEFT JOIN vehiculos m ON m.id = ci.vehiculo_id AND m.tenant_id = @tenant
       WHERE ci.tenant_id = @tenant AND ci.usuario_id IS NULL AND ci.estado <> 'cancelado'${soloSucursal(req, 'ci.sucursal_id')}
         AND ci.created_at >= NOW() - INTERVAL '24 hours'
       ORDER BY ci.created_at DESC LIMIT 10`
    );
    // Citas que el cliente canceló desde el portal: el taller tiene que enterarse
    // para liberar/reasignar el espacio (antes la cita solo desaparecía de la agenda).
    const [citasCanceladas] = await req.db.query(
      `SELECT 'cita_cancelada' AS tipo, ci.fecha_cancelacion AS created_at,
              ci.id AS cita_id, to_char(ci.fecha, 'DD/MM') AS fecha_corta,
              to_char(ci.hora, 'HH24:MI') AS hora,
              c.nombre AS cliente_nombre, c.apellido AS cliente_apellido,
              m.marca, m.modelo
       FROM citas ci
       JOIN clientes c ON c.id = ci.cliente_id AND c.tenant_id = @tenant
       LEFT JOIN vehiculos m ON m.id = ci.vehiculo_id AND m.tenant_id = @tenant
       WHERE ci.tenant_id = @tenant AND ci.estado = 'cancelado' AND ci.fecha_cancelacion IS NOT NULL${soloSucursal(req, 'ci.sucursal_id')}
         AND ci.fecha_cancelacion >= NOW() - INTERVAL '24 hours'
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
       JOIN vehiculos m ON m.id = o.vehiculo_id AND m.tenant_id = @tenant
       LEFT JOIN usuarios u ON u.id = o.tecnico_id AND u.tenant_id = @tenant
       WHERE r.tenant_id = @tenant AND r.estado = 'solicitado'${soloSucursal(req, 'o.sucursal_id')}
         AND r.created_at >= NOW() - INTERVAL '24 hours'
       ORDER BY r.created_at DESC LIMIT 10`
    );
    // Motos listas hace más de 2 días que nadie marcó como entregadas: o el cliente
    // no ha pasado, o ya se la llevó y faltó marcarlo. Van primero y no vencen a las
    // 24 h como las demás: siguen ahí hasta que se resuelvan.
    const [olvidadasOrdenes] = await req.db.query(
      `SELECT 'sin_entregar' AS tipo, t.inicio AS created_at,
              (NOW()::date - t.inicio::date) AS dias,
              o.numero_orden, o.id AS orden_id, NULL AS cita_id,
              c.nombre AS cliente_nombre, c.apellido AS cliente_apellido,
              m.marca, m.modelo
       FROM orden_tiempos t
       JOIN ordenes_trabajo o ON o.id = t.orden_id AND o.tenant_id = @tenant
       JOIN clientes c ON c.id = o.cliente_id AND c.tenant_id = @tenant
       JOIN vehiculos m ON m.id = o.vehiculo_id AND m.tenant_id = @tenant
       WHERE t.tenant_id = @tenant AND t.etapa = 'lista_entrega' AND t.fin IS NULL
         AND o.estado = 'lista_entrega'${soloSucursal(req, 'o.sucursal_id')}
         AND t.inicio < NOW() - INTERVAL '2 days'
       ORDER BY t.inicio ASC LIMIT 10`
    );
    const [olvidadasCitas] = await req.db.query(
      `SELECT 'sin_entregar' AS tipo, COALESCE(ci.fecha_listo, (ci.fecha + ci.hora)) AS created_at,
              (NOW()::date - COALESCE(ci.fecha_listo, (ci.fecha + ci.hora))::date) AS dias,
              NULL AS numero_orden, NULL AS orden_id, ci.id AS cita_id, ci.monto,
              c.nombre AS cliente_nombre, c.apellido AS cliente_apellido,
              m.marca, m.modelo
       FROM citas ci
       JOIN clientes c ON c.id = ci.cliente_id AND c.tenant_id = @tenant
       LEFT JOIN vehiculos m ON m.id = ci.vehiculo_id AND m.tenant_id = @tenant
       WHERE ci.tenant_id = @tenant AND ci.estado = 'listo' AND ci.orden_id IS NULL${soloSucursal(req, 'ci.sucursal_id')}
         AND COALESCE(ci.fecha_listo, (ci.fecha + ci.hora)) < NOW() - INTERVAL '2 days'
       ORDER BY created_at ASC LIMIT 10`
    );
    const recientes = [...fotos, ...listas, ...aprob, ...citasNuevas, ...citasCanceladas, ...repSolicitados]
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    // Sin los avisos que la persona apagó en Mi perfil.
    const todas = await filtrarAvisos(req.usuario.id, 'recepcion', [...olvidadasOrdenes, ...olvidadasCitas, ...recientes]);
    res.json({ data: todas.slice(0, 20) });
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
       JOIN vehiculos m ON o.vehiculo_id = m.id AND m.tenant_id = @tenant
       LEFT JOIN usuarios t ON o.tecnico_id = t.id AND t.tenant_id = @tenant
       LEFT JOIN sucursales s ON s.id = o.sucursal_id AND s.tenant_id = @tenant
       WHERE ${filtro}${soloSucursal(req, 'o.sucursal_id')}
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
router.post('/ordenes/:id/fotos', exigirPermiso('taller.fotos'), async (req, res) => {
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

// Entregar (cerrar) una orden: registra pago + garantía y la marca entregada. Reusa
// la lógica transaccional de cierre (fidelización + sync de cita).
// Lo normal es que el mecánico ya la haya dejado en 'lista_entrega'. Si no, responde
// 409 con requiere_confirmacion, y con forzar se entrega igual: pasa que el cliente
// se lleva la moto antes de que alguien actualice el estado.
// Entrega quien atiende al cliente (recepción o administración). El mecánico no: el
// router deja pasar al técnico por jerarquía, y entregar es cobrar.
router.post('/ordenes/:id/entregar', soloRoles('recepcion', 'admin'), exigirPermiso('ordenes.entregar'), async (req, res) => {
  try {
    const { metodo_pago, garantia_dias, observaciones_finales, forzar } = req.body;
    const [[actual]] = await req.db.query('SELECT estado FROM ordenes_trabajo WHERE tenant_id = @tenant AND id = ?', [req.params.id]);
    if (!actual) return res.status(404).json({ error: 'Orden no encontrada' });
    if (ORDEN_CERRADA.includes(actual.estado)) {
      return res.status(400).json({ error: actual.estado === 'entregada' ? 'La orden ya estaba entregada' : 'La orden está cancelada' });
    }
    if (actual.estado !== 'lista_entrega' && forzar !== true) {
      return res.status(409).json({ error: 'La orden todavía no está lista para entrega', requiere_confirmacion: true, estado_actual: actual.estado });
    }
    const r = await cerrarOrden(
      req.db,
      req.params.id,
      { metodo_pago, garantia_dias, observaciones_finales },
      { soloDesdeListaEntrega: forzar !== true }
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
       JOIN vehiculos m ON o.vehiculo_id = m.id AND m.tenant_id = @tenant
       LEFT JOIN usuarios t ON o.tecnico_id = t.id AND t.tenant_id = @tenant
       WHERE o.tenant_id = @tenant AND o.estado NOT IN ('entregada','cancelada')
         AND (o.costo_mano_obra > 0 OR o.costo_repuestos > 0)${filtroAprob}${soloSucursal(req, 'o.sucursal_id')}
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

// Respuesta cuando un costo nuevo sube la cuenta de una orden ya aprobada.
const MSG_REAPROBACION = 'La cuenta subió: la orden volvió a «Esperando aprobación» y se le avisó al cliente para que apruebe el adicional.';

// Recalcula costo_repuestos de la orden a partir de sus piezas.
async function recalcularRepuestos(db, ordenId) {
  await db.query(
    'UPDATE ordenes_trabajo SET costo_repuestos = (SELECT COALESCE(SUM(cantidad * costo_unitario), 0) FROM orden_repuestos WHERE orden_id = ? AND tenant_id = @tenant) WHERE id = ? AND tenant_id = @tenant',
    [ordenId, ordenId]
  );
}

// Agregar repuesto
router.post('/cotizaciones/:id/repuestos', exigirPermiso('ordenes.costos'), async (req, res) => {
  try {
    const { nombre, cantidad, costo_unitario, estado } = req.body;
    if (!nombre) return res.status(400).json({ error: 'Nombre del repuesto requerido' });
    if (estado && !ESTADOS_REPUESTO[estado]) return res.status(400).json({ error: 'Estado de repuesto inválido' });
    const totalAntes = await totalOrden(req.db, req.params.id);
    const [result] = await req.db.query(
      'INSERT INTO orden_repuestos (tenant_id, orden_id, nombre, cantidad, costo_unitario, estado, adicional) VALUES (@tenant, ?, ?, ?, ?, ?, ?)',
      [req.params.id, nombre, cantidad || 1, costo_unitario || 0, estado || 'pendiente', await esAdicional(req.db, req.params.id)]
    );
    await recalcularRepuestos(req.db, req.params.id);
    const reaprobacion = await revisarAdicional(req.db, req.params.id, totalAntes);
    const [[nuevo]] = await req.db.query('SELECT * FROM orden_repuestos WHERE tenant_id = @tenant AND id = ?', [result.insertId]);
    res.status(201).json({ data: nuevo, reaprobacion, message: reaprobacion ? MSG_REAPROBACION : 'Repuesto agregado' });
  } catch (err) {
    fail(res, err);
  }
});

// Editar repuesto
router.put('/cotizaciones/:id/repuestos/:rid', exigirPermiso('ordenes.costos'), async (req, res) => {
  try {
    const { nombre, cantidad, costo_unitario, estado } = req.body;
    const [[existe]] = await req.db.query('SELECT id, estado FROM orden_repuestos WHERE tenant_id = @tenant AND id = ? AND orden_id = ?', [req.params.rid, req.params.id]);
    if (!existe) return res.status(404).json({ error: 'Repuesto no encontrado' });
    if (estado && !ESTADOS_REPUESTO[estado]) return res.status(400).json({ error: 'Estado de repuesto inválido' });
    const totalAntes = await totalOrden(req.db, req.params.id);
    await req.db.query(
      'UPDATE orden_repuestos SET nombre=?, cantidad=?, costo_unitario=?, estado=? WHERE tenant_id = @tenant AND id=? AND orden_id=?',
      [nombre, cantidad || 1, costo_unitario || 0, estadoAlEditarRepuesto(existe.estado, estado, costo_unitario), req.params.rid, req.params.id]
    );
    await recalcularRepuestos(req.db, req.params.id);
    const reaprobacion = await revisarAdicional(req.db, req.params.id, totalAntes);
    const [[actualizado]] = await req.db.query('SELECT * FROM orden_repuestos WHERE tenant_id = @tenant AND id = ?', [req.params.rid]);
    res.json({ data: actualizado, reaprobacion, message: reaprobacion ? MSG_REAPROBACION : 'Repuesto actualizado' });
  } catch (err) {
    fail(res, err);
  }
});

// Eliminar repuesto
router.delete('/cotizaciones/:id/repuestos/:rid', exigirPermiso('ordenes.costos'), async (req, res) => {
  try {
    const [result] = await req.db.query('DELETE FROM orden_repuestos WHERE id=? AND orden_id=? AND tenant_id = @tenant', [req.params.rid, req.params.id]);
    if (!result.affectedRows) return res.status(404).json({ error: 'Repuesto no encontrado' });
    await recalcularRepuestos(req.db, req.params.id);
    res.json({ message: 'Repuesto eliminado' });
  } catch (err) {
    fail(res, err);
  }
});

// Actualizar mano de obra y descuento
router.put('/cotizaciones/:id/costos', exigirPermiso('ordenes.costos'), async (req, res) => {
  try {
    const { costo_mano_obra, descuento } = req.body;
    const [[orden]] = await req.db.query('SELECT id FROM ordenes_trabajo WHERE id = ? AND tenant_id = @tenant', [req.params.id]);
    if (!orden) return res.status(404).json({ error: 'Orden no encontrada' });
    const totalAntes = await totalOrden(req.db, req.params.id);
    await req.db.query(
      'UPDATE ordenes_trabajo SET costo_mano_obra = ?, descuento = ? WHERE tenant_id = @tenant AND id = ?',
      [costo_mano_obra || 0, descuento || 0, req.params.id]
    );
    const reaprobacion = await revisarAdicional(req.db, req.params.id, totalAntes);
    const [[actualizada]] = await req.db.query(
      'SELECT id, costo_mano_obra, costo_repuestos, descuento, (costo_mano_obra + costo_repuestos - descuento) AS total FROM ordenes_trabajo WHERE tenant_id = @tenant AND id = ?',
      [req.params.id]
    );
    res.json({ data: actualizada, reaprobacion, message: reaprobacion ? MSG_REAPROBACION : 'Costos actualizados' });
  } catch (err) {
    fail(res, err);
  }
});

// Armar una cotización completa en UNA transacción: asigna técnico (opcional),
// inserta todas las piezas, fija mano de obra + descuento y recalcula los repuestos.
// Si algo falla, no queda nada a medias (antes el front encadenaba varias llamadas).
router.post('/cotizaciones/:id/armar', exigirPermiso('ordenes.costos'), async (req, res) => {
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

    const totalAntes = await totalOrden(req.db, ordenId);
    const adicional = await esAdicional(req.db, ordenId);
    const conn = await req.db.conexion();
    try {
      await conn.beginTransaction();
      if (tecnico_id) {
        await conn.query('UPDATE ordenes_trabajo SET tecnico_id = ? WHERE id = ? AND tenant_id = @tenant', [tecnico_id, ordenId]);
      }
      for (const p of piezasValidas) {
        await conn.query(
          "INSERT INTO orden_repuestos (tenant_id, orden_id, nombre, cantidad, costo_unitario, estado, adicional) VALUES (@tenant, ?, ?, ?, ?, 'pendiente', ?)",
          [ordenId, p.nombre, p.cantidad, p.costo_unitario, adicional]
        );
      }
      await conn.query(
        'UPDATE ordenes_trabajo SET costo_mano_obra = ?, descuento = ? WHERE id = ? AND tenant_id = @tenant',
        [Number(costo_mano_obra) || 0, Number(descuento) || 0, ordenId]
      );
      await conn.query(
        'UPDATE ordenes_trabajo SET costo_repuestos = (SELECT COALESCE(SUM(cantidad * costo_unitario), 0) FROM orden_repuestos WHERE orden_id = ? AND tenant_id = @tenant) WHERE id = ? AND tenant_id = @tenant',
        [ordenId, ordenId]
      );
      await conn.commit();
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }

    const reaprobacion = await revisarAdicional(req.db, ordenId, totalAntes);
    const [[cotizacion]] = await req.db.query(
      'SELECT id, costo_mano_obra, costo_repuestos, descuento, (costo_mano_obra + costo_repuestos - descuento) AS total FROM ordenes_trabajo WHERE tenant_id = @tenant AND id = ?',
      [ordenId]
    );
    res.status(201).json({ data: cotizacion, reaprobacion, message: reaprobacion ? MSG_REAPROBACION : 'Cotización guardada' });
  } catch (err) {
    fail(res, err);
  }
});

// Enviar cotización: la orden pasa a esperando aprobación del cliente.
router.post('/cotizaciones/:id/enviar', exigirPermiso('ordenes.costos'), async (req, res) => {
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
       FROM ordenes_trabajo o JOIN vehiculos m ON m.id = o.vehiculo_id AND m.tenant_id = @tenant WHERE o.id = ? AND o.tenant_id = @tenant`,
      [req.params.id]
    );
    // Preferencia del taller: avisar al cliente cuando la cotización está lista.
    const config = await getConfig(req.db);
    if (o && config.notif_cotizacion) {
      const moto = [o.marca, o.modelo].filter(Boolean).join(' ') || 'tu vehículo';
      await req.db.query(
        "INSERT INTO notificaciones (tenant_id, cliente_id, cita_id, titulo, mensaje, tipo) VALUES (@tenant, ?, ?, ?, ?, 'presupuesto')",
        [o.cliente_id, o.cita_id || null, `Presupuesto listo: ${moto}`, `Tu presupuesto (orden ${o.numero_orden}) está listo. Revísalo y apruébalo desde el portal.`]
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
       JOIN vehiculos m ON o.vehiculo_id = m.id AND m.tenant_id = @tenant
       WHERE o.tenant_id = @tenant AND o.cliente_id = ? AND o.estado NOT IN ('entregada','cancelada')${soloSucursal(req, 'o.sucursal_id')}
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
    // Quien tiene una sucursal ve los mecánicos de ella (y los de las dos).
    const sucursal = req.sucursalAlcance || req.query.sucursal_id;
    if (sucursal) {
      sql += ' AND (sucursal_id = ? OR sucursal_id IS NULL)';
      params.push(sucursal);
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
    const todas = await getSucursales(req.db, { soloActivas: true });
    // Quien tiene una sucursal solo puede abrir órdenes en ella.
    const data = req.sucursalAlcance ? todas.filter((s) => Number(s.id) === req.sucursalAlcance) : todas;
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
    await req.db.query('UPDATE usuarios SET foto = ? WHERE tenant_id = @tenant AND id = ?', [foto || null, req.usuario.id]);
    if (foto) anotar(req.usuario.id, 'foto');
    res.json({ data: { foto: foto || null }, message: foto ? 'Foto actualizada' : 'Foto eliminada' });
  } catch (err) {
    fail(res, err);
  }
});

router.put('/perfil/password', async (req, res) => {
  try {
    const { actual, nueva } = req.body;
    if (!actual || !nueva) return res.status(400).json({ error: 'Contraseña actual y nueva son requeridas' });
    const [[u]] = await req.db.query('SELECT password_hash, email, nombre FROM usuarios WHERE tenant_id = @tenant AND id = ?', [req.usuario.id]);
    if (!u) return res.status(404).json({ error: 'Usuario no encontrado' });
    // La política de Configuración → Seguridad (utils/contrasena.js).
    const malaClave = problemaDeContrasena(nueva, politica(await getConfig(req.db)), u);
    if (malaClave) return res.status(400).json({ error: malaClave, campo: 'nueva' });
    const ok = await bcrypt.compare(String(actual), u.password_hash);
    if (!ok) return res.status(400).json({ error: 'La contraseña actual no es correcta' });
    const hash = await bcrypt.hash(String(nueva), 10);
    await req.db.query('UPDATE usuarios SET password_hash = ? WHERE tenant_id = @tenant AND id = ?', [hash, req.usuario.id]);
    anotar(req.usuario.id, 'contrasena');
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
    // Cada cita cuenta en todas las horas que dura; `bloqueadas` = hora → motivo.
    const dia = await agendaDia(fecha, Number(sucursal_id) || null, config, { db: req.db });
    // Las que ya empezaron (hoy) o todas (un día pasado): la pantalla no las deja elegir.
    const pasadas = horasPasadas(String(fecha).slice(0, 10), dia.horas, config.zona_horaria_offset);
    res.json({ data: { horas: dia.horas, max: config.max_citas_hora, ocupacion: dia.ocupacion, bloqueadas: dia.bloqueadas, pasadas } });
  } catch (err) {
    fail(res, err);
  }
});

// Asignar técnico a una orden (al crear/editar una cotización)
router.patch('/ordenes/:id/tecnico', exigirPermiso('ordenes.asignar'), async (req, res) => {
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
router.post('/cotizaciones/:id/aprobar', soloRoles('recepcion', 'admin'), exigirPermiso('ordenes.costos'), async (req, res) => {
  try {
    const [[orden]] = await req.db.query('SELECT id, estado FROM ordenes_trabajo WHERE id = ? AND tenant_id = @tenant', [req.params.id]);
    if (!orden) return res.status(404).json({ error: 'Orden no encontrada' });
    // Igual que el endpoint del portal: solo se puede "aprobar" una orden que
    // efectivamente está esperando esa aprobación (evita marcar como aprobada, con
    // fecha y todo, una orden ya entregada/cancelada o en cualquier otro estado).
    if (orden.estado !== 'esperando_aprobacion') {
      return res.status(400).json({ error: 'La orden no está esperando aprobación' });
    }
    await registrarAprobacion(req.db, req.params.id);
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
             (SELECT COUNT(*) FROM vehiculos WHERE cliente_id = c.id AND activa = 1 AND tenant_id = @tenant) AS total_motos,
             (SELECT COUNT(*) FROM citas WHERE cliente_id = c.id AND tenant_id = @tenant) AS total_citas
      FROM clientes c
      WHERE c.tenant_id = @tenant AND c.activo = 1`;
    const params = [];
    if (q) {
      sql += ` AND (c.nombre ILIKE ? OR c.apellido ILIKE ? OR c.telefono ILIKE ? OR c.email ILIKE ? OR c.cedula ILIKE ?
               OR (c.nombre || ' ' || c.apellido) ILIKE ?
               OR EXISTS (SELECT 1 FROM vehiculos mm WHERE mm.cliente_id = c.id AND mm.activa = 1 AND mm.tenant_id = @tenant AND mm.placa ILIKE ?))`;
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
       JOIN vehiculos m ON m.id = o.vehiculo_id AND m.tenant_id = @tenant
       JOIN usuarios u ON u.id = a.usuario_id AND u.tenant_id = @tenant
       WHERE a.tenant_id = @tenant${soloSucursal(req, 'o.sucursal_id')}
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
  JOIN usuarios ru ON ru.id = m.remitente_id AND ru.tenant_id = @tenant AND m.tenant_id = @tenant
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
      `SELECT COUNT(*) AS count FROM mensajes_internos m JOIN usuarios ru ON ru.id = m.remitente_id AND ru.tenant_id = @tenant AND m.tenant_id = @tenant ${where}`,
      params
    );
    res.json({ data: { count } });
  } catch (err) {
    fail(res, err);
  }
});

router.post('/mensajes-internos', exigirPermiso('equipo.mensajes'), async (req, res) => {
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

router.post('/mensajes-internos/broadcast', exigirPermiso('equipo.mensajes'), async (req, res) => {
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
