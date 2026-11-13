const router = require('express').Router();
// Sin `pool`: todo el acceso pasa por req.db, scopeado al taller.
const { fail, invalido, faltante } = require('../utils/responder');
const { referenciaAjena } = require('../utils/referencias');
const auth = require('../middleware/auth');
const requireRol = require('../middleware/roles');
const { cargarAlcance, soloSucursal, sucursalParaGuardar, exigirSucursal, delTaller, soloOrdenAsignada, SUCURSAL_DE_ORDEN } = require('../utils/alcance');
const { soloRoles } = require('../middleware/roles');
const {
  generarNumeroOrden, sincronizarCitaDesdeOrden, cerrarOrden, validarEdicionCostos, totalOrden, esAdicional, revisarAdicional,
  crearCitaDeOrden,
} = require('../utils/ordenes');
const { ESTADOS_REPUESTO, estadosSiguientes, avisosDeCambio, montoSinAprobar, estadoAlEditarRepuesto } = require('../utils/reglas-orden');
const { notificarPresupuestoListo, notificarCambioEstado } = require('../utils/notificaciones');
const { TRANSICIONES_ORDEN, transicionPermitida } = require('../utils/transiciones');
const { sucursalValida } = require('../utils/sucursales');
const { LEIDO_POR_MI, VISTO_POR_OTRO, marcarLeidos } = require('../utils/mensajes');
const { fotoValida, textoDentroDeLimite } = require('../utils/validar');
const { patronLike, patronDigitos, patronPlaca, SOLO_DIGITOS } = require('../utils/busqueda');
const { exigirPermiso } = require('../middleware/permisos');

const MAX_PROBLEMA_REPORTADO = 2000;
const MAX_MOTIVO_CANCELACION = 300;
const MAX_MOTIVO_ELIMINAR = 500;
// Los mismos valores que las columnas ENUM de ordenes_trabajo (schema.sql). Antes estas
// listas eran otras: las pantallas ofrecen "Emergencia", "Garantía" y "1/2" de
// combustible (lo que acepta la base) y el servidor las rechazaba como no válidas.
const PRIORIDADES_VALIDAS = ['normal', 'urgente', 'emergencia', 'garantia'];
const CATEGORIAS_VALIDAS = ['rapido', 'garantia', 'emergencia', 'diagnostico', 'preventivo', 'mayor'];
const COMBUSTIBLE_VALIDO = ['vacio', 'cuarto', 'mitad', 'tres_cuartos', 'lleno'];

// Respuesta cuando un costo nuevo sube la cuenta de una orden ya aprobada.
const MSG_REAPROBACION = 'La cuenta subió: la orden volvió a «Esperando aprobación» y se le avisó al cliente para que apruebe el adicional.';

// Tope del listado (ver comentario en clientes.routes.js): los filtros por estado,
// técnico y rango de fechas son server-side.
const MAX_LISTADO = 500;

// Piso de rol: recepción o superior (recepción crea órdenes, el técnico las trabaja).
// Sin esto, cualquier token válido podía leer/alterar órdenes ajenas y sus costos.
router.use(auth, requireRol('recepcion'));
// Quien tiene una sucursal ve solo las órdenes de ella (utils/alcance.js). Todas las
// rutas con :id de este archivo son de una orden: una de la otra sucursal da 404.
router.use(cargarAlcance);
router.param('id', delTaller('ordenes_trabajo'));
router.param('id', soloOrdenAsignada);
router.param('id', exigirSucursal(SUCURSAL_DE_ORDEN));

// GET /api/ordenes
router.get('/', async (req, res) => {
  try {
    const { estado, tecnico_id, fecha_desde, fecha_hasta } = req.query;
    let sql = `
      SELECT ot.id, ot.numero_orden, ot.estado, ot.prioridad, ot.categoria, ot.problema_reportado,
             ot.fecha_ingreso, ot.fecha_estimada_entrega,
             ot.costo_mano_obra, ot.costo_repuestos, ot.descuento,
             (ot.costo_mano_obra + ot.costo_repuestos - ot.descuento) AS total,
             c.nombre AS cliente_nombre, c.apellido AS cliente_apellido, c.telefono AS cliente_telefono,
             m.marca, m.modelo, m.placa, m.color,
             u.nombre AS tecnico_nombre
      FROM ordenes_trabajo ot
      JOIN clientes c ON ot.cliente_id = c.id AND c.tenant_id = @tenant
      JOIN vehiculos m ON ot.vehiculo_id = m.id AND m.tenant_id = @tenant
      LEFT JOIN usuarios u ON ot.tecnico_id = u.id AND u.tenant_id = @tenant
      WHERE ot.tenant_id = @tenant`;
    const params = [];
    if (estado) { sql += ' AND ot.estado = ?'; params.push(estado); }
    // El mecánico solo ve sus órdenes: la jerarquía lo deja pasar a esta ruta, y sin esto
    // listaba las de todo el taller (sus pantallas no la usan; lo suyo va por /api/mecanico).
    if (req.usuario.rol === 'tecnico') { sql += ' AND ot.tecnico_id = ?'; params.push(req.usuario.id); }
    else if (tecnico_id) { sql += ' AND ot.tecnico_id = ?'; params.push(tecnico_id); }
    if (fecha_desde) { sql += ' AND DATE(ot.fecha_ingreso) >= ?'; params.push(fecha_desde); }
    if (fecha_hasta) { sql += ' AND DATE(ot.fecha_ingreso) <= ?'; params.push(fecha_hasta); }
    // Buscador: número de orden, cliente, teléfono, cédula, placa, moto o problema.
    // Busca en toda la base (no solo en las últimas MAX_LISTADO que muestra la lista).
    const texto = patronLike(req.query.q);
    if (texto) {
      const condiciones = [
        'ot.numero_orden ILIKE ?', 'c.nombre ILIKE ?', 'c.apellido ILIKE ?',
        "CONCAT(c.nombre, ' ', c.apellido) ILIKE ?", 'm.marca ILIKE ?', 'm.modelo ILIKE ?',
        "CONCAT(m.marca, ' ', m.modelo) ILIKE ?", 'ot.problema_reportado ILIKE ?',
      ];
      const valores = condiciones.map(() => texto);
      const digitos = patronDigitos(req.query.q);
      if (digitos) {
        condiciones.push(`${SOLO_DIGITOS('c.telefono')} ILIKE ?`, `${SOLO_DIGITOS('c.cedula')} ILIKE ?`);
        valores.push(digitos, digitos);
      }
      const placa = patronPlaca(req.query.q);
      if (placa) {
        condiciones.push("UPPER(REPLACE(REPLACE(m.placa, ' ', ''), '-', '')) ILIKE ?");
        valores.push(placa);
      }
      sql += ` AND (${condiciones.join(' OR ')})`;
      params.push(...valores);
    }
    sql += soloSucursal(req, 'ot.sucursal_id');
    sql += ` ORDER BY ot.fecha_ingreso DESC LIMIT ${MAX_LISTADO}`;
    const [rows] = await req.db.query(sql, params);
    res.json({ data: rows });
  } catch (err) {
    fail(res, err);
  }
});

// POST /api/ordenes
router.post('/', soloRoles('recepcion', 'admin'), exigirPermiso('ordenes.crear'), async (req, res) => {
  try {
    const {
      vehiculo_id, cliente_id, problema_reportado, kilometraje_ingreso,
      nivel_combustible, accesorios_entregados, estado_fisico,
      prioridad, categoria, fecha_estimada_entrega,
    } = req.body;

    const problemaReportado = String(problema_reportado || '').trim();

    if (faltante(res, { ...req.body, problema_reportado: problemaReportado }, [['cliente_id', 'el cliente'], ['vehiculo_id', 'el vehículo'], ['problema_reportado', 'el problema que reporta el cliente']])) return;
    if (!textoDentroDeLimite(problemaReportado, MAX_PROBLEMA_REPORTADO)) {
      return invalido(res, 'problema_reportado', `El problema no puede pasar de ${MAX_PROBLEMA_REPORTADO} caracteres`);
    }

    if (prioridad && !PRIORIDADES_VALIDAS.includes(prioridad)) {
      return invalido(res, 'prioridad', 'Prioridad no válida');
    }
    if (categoria && !CATEGORIAS_VALIDAS.includes(categoria)) {
      return invalido(res, 'categoria', 'Categoría no válida');
    }
    if (nivel_combustible && !COMBUSTIBLE_VALIDO.includes(nivel_combustible)) {
      return invalido(res, 'nivel_combustible', 'Nivel de combustible no válido');
    }
    const ajena = await referenciaAjena(req.db, { cliente_id, vehiculo_id });
    if (ajena) return invalido(res, ajena.campo, ajena.error);

    const sucursal_id = sucursalParaGuardar(req, (await sucursalValida(req.db, req.body.sucursal_id)) ? Number(req.body.sucursal_id) : null);

    const numero_orden = await generarNumeroOrden(req.db);

    // Orden + su tiempo inicial en una sola transacción: si algo falla, no queda
    // una orden sin etapa de recepción registrada.
    const conn = await req.db.conexion();
    try {
      await conn.beginTransaction();
      const [result] = await conn.query(
        `INSERT INTO ordenes_trabajo
          (tenant_id,numero_orden, vehiculo_id, cliente_id, sucursal_id, recepcionista_id, problema_reportado,
           kilometraje_ingreso, nivel_combustible, accesorios_entregados, estado_fisico,
           prioridad, categoria, fecha_estimada_entrega)
         VALUES (@tenant, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          numero_orden, vehiculo_id, cliente_id, sucursal_id, req.usuario.id, problemaReportado,
          kilometraje_ingreso || null, nivel_combustible || 'cuarto',
          accesorios_entregados || null, estado_fisico || null,
          prioridad || 'normal', categoria || 'diagnostico',
          fecha_estimada_entrega || null,
        ]
      );
      await conn.query('INSERT INTO orden_tiempos (tenant_id, orden_id, etapa) VALUES (@tenant, ?, ?)', [result.insertId, 'recepcion']);
      // Su cita, para que el cliente la vea en el portal (ver crearCitaDeOrden).
      const citaId = await crearCitaDeOrden(conn, {
        orden_id: result.insertId, cliente_id, vehiculo_id, sucursal_id, usuario_id: req.usuario.id,
        problema_reportado: problemaReportado,
        // Servicio rápido: el tiempo estimado que eligió recepción (20, 30 o 40 min).
        duracion_min: req.body.duracion_min,
      });
      const [[nueva]] = await conn.query('SELECT * FROM ordenes_trabajo WHERE tenant_id = @tenant AND id = ?', [result.insertId]);
      await conn.commit();
      await notificarCambioEstado(req.db, citaId, 'en_revision');
      res.status(201).json({ data: nueva, message: 'Orden creada' });
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

// GET /api/ordenes/eliminadas — registro de órdenes eliminadas, con el motivo.
// Va antes de /:id para que "eliminadas" no se lea como un id.
router.get('/eliminadas', requireRol('admin'), async (req, res) => {
  try {
    const [rows] = await req.db.query(
      `SELECT id, orden_id, numero_orden, estado, cliente_nombre, moto, problema_reportado, total,
              fecha_ingreso, motivo, eliminada_por_nombre, created_at
       FROM ordenes_eliminadas WHERE tenant_id = @tenant ORDER BY created_at DESC LIMIT ${MAX_LISTADO}`
    );
    res.json({ data: rows });
  } catch (err) {
    fail(res, err);
  }
});

// GET /api/ordenes/:id
router.get('/:id', async (req, res) => {
  try {
    const [[orden]] = await req.db.query(
      `SELECT ot.*,
              c.nombre AS cliente_nombre, c.apellido AS cliente_apellido, c.telefono AS cliente_telefono, c.email AS cliente_email,
              m.marca, m.modelo, m.placa, m.color, m.anio, m.kilometraje_actual,
              u.nombre AS tecnico_nombre,
              r.nombre AS recepcionista_nombre,
              s.nombre AS sucursal_nombre, s.direccion AS sucursal_direccion, s.telefono AS sucursal_telefono,
              (ot.costo_mano_obra + ot.costo_repuestos - ot.descuento) AS total
       FROM ordenes_trabajo ot
       JOIN clientes c ON ot.cliente_id = c.id AND c.tenant_id = @tenant
       JOIN vehiculos m ON ot.vehiculo_id = m.id AND m.tenant_id = @tenant
       LEFT JOIN usuarios u ON ot.tecnico_id = u.id AND u.tenant_id = @tenant
       LEFT JOIN usuarios r ON ot.recepcionista_id = r.id AND r.tenant_id = @tenant
       LEFT JOIN sucursales s ON s.id = ot.sucursal_id AND s.tenant_id = @tenant
       WHERE ot.tenant_id = @tenant AND ot.id = ?`,
      [req.params.id]
    );
    if (!orden) return res.status(404).json({ error: 'Orden no encontrada' });
    // La pantalla arma los botones de "siguiente paso" con esto: así las reglas viven
    // en un solo lugar (utils/transiciones.js) y no hay dos listas que se desalineen.
    orden.siguientes = estadosSiguientes(orden.estado, req.usuario.rol);
    orden.monto_sin_aprobar = montoSinAprobar(orden.total, orden.total_aprobado);
    res.json({ data: orden });
  } catch (err) {
    fail(res, err);
  }
});

// PUT /api/ordenes/:id — edita diagnóstico y costos (mano de obra, repuestos, descuento).
// Toca plata: lo limita a técnico o superior (recepción no edita montos).
router.put('/:id', requireRol('tecnico'), async (req, res) => {
  let conn;
  let confirmada = false;
  try {
    conn = await req.db.conexion();
    await conn.beginTransaction();
    if (!(await validarEdicionCostos(conn, req.params.id, res))) return;
    const {
      diagnostico, tiempo_estimado_horas, costo_mano_obra, costo_repuestos, descuento,
      fecha_estimada_entrega, prioridad, categoria, accesorios_entregados, estado_fisico,
    } = req.body;
    const totalAntes = await totalOrden(conn, req.params.id);
    // El mecánico no ve los montos (middleware/ocultar-al-mecanico.js): lo que mande
    // en esos campos se ignora y quedan los de la orden, para no borrarlos en cero.
    let montos = { costo_mano_obra, costo_repuestos, descuento };
    if (req.usuario.rol === 'tecnico') {
      const [[actual]] = await conn.query('SELECT costo_mano_obra, costo_repuestos, descuento FROM ordenes_trabajo WHERE tenant_id = @tenant AND id = ?', [req.params.id]);
      if (actual) montos = actual;
    }
    await conn.query(
      `UPDATE ordenes_trabajo SET
        diagnostico=?, tiempo_estimado_horas=?, costo_mano_obra=?, costo_repuestos=?,
        descuento=?, fecha_estimada_entrega=?, prioridad=?, categoria=?,
        accesorios_entregados=?, estado_fisico=?
       WHERE id=? AND tenant_id = @tenant`,
      [
        diagnostico || null, tiempo_estimado_horas || null,
        montos.costo_mano_obra || 0, montos.costo_repuestos || 0, montos.descuento || 0,
        fecha_estimada_entrega || null, prioridad || 'normal', categoria || 'diagnostico',
        accesorios_entregados || null, estado_fisico || null,
        req.params.id,
      ]
    );
    const reaprobacion = await revisarAdicional(conn, req.params.id, totalAntes);
    const [[actualizada]] = await conn.query('SELECT * FROM ordenes_trabajo WHERE tenant_id = @tenant AND id = ?', [req.params.id]);
    await conn.commit();
    confirmada = true;
    res.json({ data: actualizada, reaprobacion, message: reaprobacion ? MSG_REAPROBACION : 'Orden actualizada' });
  } catch (err) {
    fail(res, err);
  } finally {
    if (conn) {
      if (!confirmada) await conn.rollback();
      conn.release();
    }
  }
});

// PATCH /api/ordenes/:id/datos — "Editar orden": los datos de ingreso (problema,
// moto, sede, prioridad, kilometraje…). Los montos y el diagnóstico van por PUT.
// Lo hacen recepción y administración (quienes abren las órdenes); una orden ya
// entregada o cancelada no se edita.
router.patch('/:id/datos', soloRoles('recepcion', 'admin'), exigirPermiso('ordenes.editar'), async (req, res) => {
  try {
    const [[orden]] = await req.db.query('SELECT id, cliente_id, estado FROM ordenes_trabajo WHERE tenant_id = @tenant AND id = ?', [req.params.id]);
    if (!orden) return res.status(404).json({ error: 'Orden no encontrada' });
    if (['entregada', 'cancelada'].includes(orden.estado)) {
      return res.status(409).json({ error: 'Esta orden ya está cerrada: no se puede editar' });
    }

    const b = req.body || {};
    const problema = String(b.problema_reportado || '').trim();
    if (!problema) return invalido(res, 'problema_reportado', 'Escribí el problema que reporta el cliente');
    if (!textoDentroDeLimite(problema, MAX_PROBLEMA_REPORTADO)) {
      return invalido(res, 'problema_reportado', `El problema no puede pasar de ${MAX_PROBLEMA_REPORTADO} caracteres`);
    }
    if (b.prioridad && !PRIORIDADES_VALIDAS.includes(b.prioridad)) return invalido(res, 'prioridad', 'Prioridad no válida');
    if (b.categoria && !CATEGORIAS_VALIDAS.includes(b.categoria)) return invalido(res, 'categoria', 'Categoría no válida');
    if (b.nivel_combustible && !COMBUSTIBLE_VALIDO.includes(b.nivel_combustible)) {
      return invalido(res, 'nivel_combustible', 'Nivel de combustible no válido');
    }
    const km = b.kilometraje_ingreso === '' || b.kilometraje_ingreso == null ? null : Number(b.kilometraje_ingreso);
    if (km !== null && (!Number.isInteger(km) || km < 0)) return invalido(res, 'kilometraje_ingreso', 'Kilometraje no válido');
    const fechaEst = b.fecha_estimada_entrega ? String(b.fecha_estimada_entrega).slice(0, 10) : null;
    if (fechaEst && !/^\d{4}-\d{2}-\d{2}$/.test(fechaEst)) return invalido(res, 'fecha_estimada_entrega', 'Fecha estimada no válida');
    // La moto tiene que ser del mismo cliente (para cambiar de cliente, se elimina y se abre otra).
    const [[moto]] = await req.db.query('SELECT id FROM vehiculos WHERE tenant_id = @tenant AND id = ? AND cliente_id = ?', [b.vehiculo_id, orden.cliente_id]);
    if (!moto) return invalido(res, 'vehiculo_id', 'Ese vehículo no es de este cliente');
    const sucursal_id = sucursalParaGuardar(req, (await sucursalValida(req.db, b.sucursal_id)) ? Number(b.sucursal_id) : null);
    const categoria = b.categoria || 'diagnostico';

    await req.db.query(
      `UPDATE ordenes_trabajo SET vehiculo_id = ?, sucursal_id = ?, problema_reportado = ?, prioridad = ?, categoria = ?,
         kilometraje_ingreso = ?, nivel_combustible = ?, accesorios_entregados = ?, estado_fisico = ?,
         fecha_estimada_entrega = ?
       WHERE tenant_id = @tenant AND id = ?`,
      [
        moto.id, sucursal_id, problema, b.prioridad || 'normal', categoria,
        km, b.nivel_combustible || 'cuarto', String(b.accesorios_entregados || '').trim() || null,
        String(b.estado_fisico || '').trim() || null, fechaEst, orden.id,
      ]
    );
    // La cita de la orden muestra la misma moto y sede; si la cita se creó sola
    // para la orden, también el problema (de una cita agendada por el cliente se
    // respeta lo que él escribió).
    await req.db.query('UPDATE citas SET vehiculo_id = ?, sucursal_id = ? WHERE tenant_id = @tenant AND orden_id = ?', [moto.id, sucursal_id, orden.id]);
    await req.db.query('UPDATE citas SET motivo = ? WHERE tenant_id = @tenant AND orden_id = ? AND creada_por_orden = 1', [problema, orden.id]);
    res.json({ message: 'Orden actualizada' });
  } catch (err) {
    fail(res, err);
  }
});

// DELETE /api/ordenes/:id — elimina una orden (solo administración), con el motivo.
//
// La orden y lo que colgaba de ella (avances, repuestos, fotos, checklist, tiempos)
// se borran de verdad; queda una copia de lo principal y el motivo en
// ordenes_eliminadas. Una orden ENTREGADA no se elimina: ya se cobró, tiene su
// factura y su garantía, y cuenta en los reportes.
//
// La cita: si se creó sola para la orden, se va con ella. Si el cliente la había
// agendado, se conserva y vuelve a "agendada" sin orden, para poder abrirle otra.
// Una cortesía que se canjeó en esta orden se le devuelve al cliente.
router.delete('/:id', requireRol('admin'), async (req, res) => {
  const motivo = String(req.body?.motivo || '').trim();
  if (motivo.length < 5) return res.status(400).json({ error: 'Escribí por qué se elimina la orden' });
  if (motivo.length > MAX_MOTIVO_ELIMINAR) {
    return res.status(400).json({ error: `El motivo no puede pasar de ${MAX_MOTIVO_ELIMINAR} caracteres` });
  }
  const conn = await req.db.conexion();
  try {
    await conn.beginTransaction();
    const [[o]] = await conn.query(
      `SELECT ot.id, ot.numero_orden, ot.estado, ot.cliente_id, ot.problema_reportado, ot.fecha_ingreso,
              (ot.costo_mano_obra + ot.costo_repuestos - ot.descuento) AS total,
              CONCAT_WS(' ', c.nombre, c.apellido) AS cliente_nombre,
              CONCAT_WS(' ', m.marca, m.modelo, m.placa) AS moto
       FROM ordenes_trabajo ot
       LEFT JOIN clientes c ON c.id = ot.cliente_id AND c.tenant_id = @tenant
       LEFT JOIN vehiculos m ON m.id = ot.vehiculo_id AND m.tenant_id = @tenant
       WHERE ot.tenant_id = @tenant AND ot.id = ? FOR UPDATE OF ot`,
      [req.params.id]
    );
    if (!o) { await conn.rollback(); return res.status(404).json({ error: 'Orden no encontrada' }); }
    if (o.estado === 'entregada') {
      await conn.rollback();
      return res.status(409).json({ error: 'Esta orden ya se entregó y se cobró: se queda en el historial y en los reportes. No se puede eliminar.' });
    }
    const [[{ n: nGarantias }]] = await conn.query('SELECT COUNT(*) AS n FROM garantias WHERE tenant_id = @tenant AND orden_id = ?', [o.id]);
    if (nGarantias) {
      await conn.rollback();
      return res.status(409).json({ error: 'Esta orden tiene reclamos de garantía: no se puede eliminar.' });
    }

    await conn.query(
      `INSERT INTO ordenes_eliminadas
         (tenant_id, orden_id, numero_orden, estado, cliente_id, cliente_nombre, moto, problema_reportado, total,
          fecha_ingreso, motivo, eliminada_por, eliminada_por_nombre)
       VALUES (@tenant, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, (SELECT nombre FROM usuarios WHERE tenant_id = @tenant AND id = ?))`,
      [o.id, o.numero_orden, o.estado, o.cliente_id, o.cliente_nombre, o.moto, o.problema_reportado,
       Number(o.total) || 0, o.fecha_ingreso, motivo, req.usuario.id, req.usuario.id]
    );

    // Cortesía canjeada en esta orden: vuelve a estar disponible.
    const [canjes] = await conn.query('SELECT id FROM recompensas_canjeadas WHERE tenant_id = @tenant AND orden_id = ? AND devuelta_en IS NULL', [o.id]);
    if (canjes.length) {
      await conn.query('UPDATE clientes SET cortesia_disponible = 1 WHERE tenant_id = @tenant AND id = ?', [o.cliente_id]);
    }

    await conn.query('DELETE FROM recompensas_canjeadas WHERE tenant_id = @tenant AND orden_id = ?', [o.id]);

    // Su cita (ver arriba).
    const [citas] = await conn.query('SELECT id, creada_por_orden FROM citas WHERE tenant_id = @tenant AND orden_id = ?', [o.id]);
    for (const c of citas) {
      if (c.creada_por_orden) {
        await conn.query('DELETE FROM notificaciones WHERE tenant_id = @tenant AND cita_id = ?', [c.id]);
        await conn.query('DELETE FROM citas WHERE tenant_id = @tenant AND id = ?', [c.id]);
      } else {
        await conn.query(
          `UPDATE citas SET orden_id = NULL, estado = CASE WHEN estado = 'cancelado' THEN 'cancelado' ELSE 'agendado' END,
             fecha_inicio = NULL, fecha_listo = NULL
           WHERE tenant_id = @tenant AND id = ?`,
          [c.id]
        );
      }
    }

    // Los mensajes del equipo sobre la orden se quedan en el chat de cada quien.
    await conn.query('UPDATE mensajes_internos SET orden_id = NULL WHERE tenant_id = @tenant AND orden_id = ?', [o.id]);
    for (const tabla of ['orden_avances', 'orden_repuestos', 'orden_fotos', 'orden_checklist', 'orden_tiempos']) {
      await conn.query(`DELETE FROM ${tabla} WHERE tenant_id = @tenant AND orden_id = ?`, [o.id]);
    }
    await conn.query('DELETE FROM ordenes_trabajo WHERE tenant_id = @tenant AND id = ?', [o.id]);
    await conn.commit();
    res.json({ message: `Orden ${o.numero_orden} eliminada` });
  } catch (err) {
    await conn.rollback();
    fail(res, err);
  } finally {
    conn.release();
  }
});

// PATCH /api/ordenes/:id/estado
const ESTADOS_VALIDOS = ['recepcion','diagnostico','esperando_aprobacion','esperando_repuestos','en_reparacion','lista_entrega','entregada','cancelada'];
const ETAPAS_TIEMPO = ['recepcion','diagnostico','esperando_aprobacion','esperando_repuestos','en_reparacion','lista_entrega'];

router.patch('/:id/estado', exigirPermiso('ordenes.estado'), async (req, res) => {
  let conn;
  let confirmada = false;
  try {
    const { estado, confirmar } = req.body;
    if (!ESTADOS_VALIDOS.includes(estado)) {
      return res.status(400).json({ error: 'Estado inválido' });
    }

    // Solo admin puede cancelar
    if (estado === 'cancelada' && req.usuario.rol !== 'admin') {
      return res.status(403).json({ error: 'Solo admin puede cancelar una orden' });
    }
    // Al cancelar, el porqué (la pantalla lo pide; queda opcional para no romper una
    // app vieja que no lo manda).
    const motivo = estado === 'cancelada' && typeof req.body.motivo === 'string' ? req.body.motivo.trim() : '';
    if (motivo.length > MAX_MOTIVO_CANCELACION) {
      return invalido(res, 'motivo', `El motivo no puede pasar de ${MAX_MOTIVO_CANCELACION} caracteres`);
    }

    conn = await req.db.conexion();
    await conn.beginTransaction();
    const [[orden]] = await conn.query('SELECT estado, aprobacion_cliente, cliente_id FROM ordenes_trabajo WHERE tenant_id = @tenant AND id = ? FOR UPDATE', [req.params.id]);
    if (!orden) return res.status(404).json({ error: 'Orden no encontrada' });

    // Solo transiciones válidas (evita saltos ilógicos, p. ej. entregada→diagnostico).
    if (!transicionPermitida(TRANSICIONES_ORDEN, orden.estado, estado)) {
      return res.status(400).json({ error: `Transición no permitida: ${orden.estado} → ${estado}` });
    }

    // Lo que conviene saber antes de avanzar (repuestos que no llegaron, moto sin
    // fotos de ingreso, presupuesto sin aprobar). No impide el cambio: devuelve 409
    // con los avisos y la pantalla pregunta; si la persona confirma, reenvía con
    // confirmar: true.
    if (!confirmar) {
      const [repuestos] = await conn.query('SELECT nombre, cantidad, estado FROM orden_repuestos WHERE tenant_id = @tenant AND orden_id = ? AND rechazado = 0', [req.params.id]);
      const [[{ n: fotosIngreso }]] = await conn.query("SELECT COUNT(*) AS n FROM orden_fotos WHERE tenant_id = @tenant AND orden_id = ? AND tipo = 'ingreso'", [req.params.id]);
      const avisos = avisosDeCambio({ desde: orden.estado, hacia: estado, repuestos, fotosIngreso, aprobacion: orden.aprobacion_cliente });
      if (avisos.length) {
        return res.status(409).json({ error: 'Hay avisos antes de cambiar el estado', codigo: 'requiere_confirmacion', avisos });
      }
    }

    // Cerrar tiempo de etapa anterior
    if (ETAPAS_TIEMPO.includes(orden.estado)) {
      await conn.query(
        'UPDATE orden_tiempos SET fin = NOW() WHERE tenant_id = @tenant AND orden_id = ? AND etapa = ? AND fin IS NULL',
        [req.params.id, orden.estado]
      );
    }

    await conn.query('UPDATE ordenes_trabajo SET estado = ? WHERE tenant_id = @tenant AND id = ?', [estado, req.params.id]);
    if (estado === 'cancelada') {
      await conn.query('UPDATE ordenes_trabajo SET motivo_cancelacion = ? WHERE tenant_id = @tenant AND id = ?', [motivo || null, req.params.id]);
      const [devueltos] = await conn.query('UPDATE recompensas_canjeadas SET devuelta_en = NOW() WHERE tenant_id = @tenant AND orden_id = ? AND devuelta_en IS NULL RETURNING cliente_id', [req.params.id]);
      for (const canje of devueltos) {
        await conn.query('UPDATE clientes SET cortesia_disponible = 1 WHERE tenant_id = @tenant AND id = ?', [canje.cliente_id]);
      }
    }
    // Un presupuesto que se vuelve a mandar (p. ej. después de un rechazo) arranca sin
    // decisión: si quedaba "rechazado", el portal no se lo mostraba al cliente.
    if (estado === 'esperando_aprobacion') {
      await conn.query(
        "UPDATE ordenes_trabajo SET aprobacion_cliente = 'pendiente', motivo_rechazo = NULL WHERE tenant_id = @tenant AND id = ?",
        [req.params.id]
      );
    }

    // Abrir nuevo tiempo
    if (ETAPAS_TIEMPO.includes(estado)) {
      await conn.query('INSERT INTO orden_tiempos (tenant_id,orden_id, etapa) VALUES (@tenant, ?, ?)', [req.params.id, estado]);
    }

    await conn.commit();
    confirmada = true;

    // Refleja el avance en la cita vinculada (si la hay) → portal del cliente + mecánico.
    await sincronizarCitaDesdeOrden(req.db, req.params.id, estado);

    // Cotización lista: avisar al cliente cuando la orden entra a esperando aprobación,
    // por cualquier vía (no solo desde el flujo de "Enviar cotización" de recepción).
    if (estado === 'esperando_aprobacion') await notificarPresupuestoListo(req.db, req.params.id);

    res.json({ data: { estado }, message: 'Estado actualizado' });
  } catch (err) {
    fail(res, err);
  } finally {
    if (conn) {
      if (!confirmada) await conn.rollback();
      conn.release();
    }
  }
});

// PATCH /api/ordenes/:id/tecnico
router.patch('/:id/tecnico', requireRol('admin'), async (req, res) => {
  try {
    const { tecnico_id } = req.body;
    const [[orden]] = await req.db.query('SELECT id FROM ordenes_trabajo WHERE tenant_id = @tenant AND id = ?', [req.params.id]);
    if (!orden) return res.status(404).json({ error: 'Orden no encontrada' });
    if (tecnico_id) {
      const [[tec]] = await req.db.query("SELECT id FROM usuarios WHERE tenant_id = @tenant AND id = ? AND rol = 'tecnico' AND activo = 1", [tecnico_id]);
      if (!tec) return res.status(400).json({ error: 'El técnico no existe o está inactivo' });
    }
    await req.db.query('UPDATE ordenes_trabajo SET tecnico_id = ? WHERE tenant_id = @tenant AND id = ?', [tecnico_id || null, req.params.id]);
    // La cita va con la orden: si no, el mecánico anterior seguiría teniéndola asignada.
    await req.db.query('UPDATE citas SET tecnico_id = ? WHERE tenant_id = @tenant AND orden_id = ?', [tecnico_id || null, req.params.id]);
    res.json({ message: 'Técnico asignado' });
  } catch (err) {
    fail(res, err);
  }
});

// POST /api/ordenes/:id/avances
router.post('/:id/avances', async (req, res) => {
  try {
    const { descripcion } = req.body;
    if (!descripcion) return res.status(400).json({ error: 'Descripción requerida' });
    const [result] = await req.db.query(
      'INSERT INTO orden_avances (tenant_id,orden_id, usuario_id, descripcion) VALUES (@tenant, ?, ?, ?)',
      [req.params.id, req.usuario.id, descripcion]
    );
    const [[nuevo]] = await req.db.query('SELECT * FROM orden_avances WHERE tenant_id = @tenant AND id = ?', [result.insertId]);
    res.status(201).json({ data: nuevo, message: 'Avance registrado' });
  } catch (err) {
    fail(res, err);
  }
});

// GET /api/ordenes/:id/avances
router.get('/:id/avances', async (req, res) => {
  try {
    const [rows] = await req.db.query(
      `SELECT oa.*, u.nombre AS usuario_nombre, u.rol AS usuario_rol
       FROM orden_avances oa JOIN usuarios u ON oa.usuario_id = u.id AND u.tenant_id = @tenant
       WHERE oa.tenant_id = @tenant AND oa.orden_id = ? ORDER BY oa.created_at ASC`,
      [req.params.id]
    );
    res.json({ data: rows });
  } catch (err) {
    fail(res, err);
  }
});

// POST /api/ordenes/:id/repuestos
// Repuestos con precio: mostrador y administración (el mecánico los pide por /api/mecanico).
router.post('/:id/repuestos', soloRoles('recepcion', 'admin'), exigirPermiso('ordenes.costos'), async (req, res) => {
  let conn;
  let confirmada = false;
  try {
    conn = await req.db.conexion();
    await conn.beginTransaction();
    if (!(await validarEdicionCostos(conn, req.params.id, res))) return;
    const { nombre, cantidad, costo_unitario, estado } = req.body;
    if (!nombre) return res.status(400).json({ error: 'Nombre del repuesto requerido' });
    if (estado && !ESTADOS_REPUESTO[estado]) return res.status(400).json({ error: 'Estado de repuesto inválido' });
    const totalAntes = await totalOrden(conn, req.params.id);
    const [result] = await conn.query(
      'INSERT INTO orden_repuestos (tenant_id, orden_id, nombre, cantidad, costo_unitario, estado, adicional) VALUES (@tenant, ?, ?, ?, ?, ?, ?)',
      [req.params.id, nombre, cantidad || 1, costo_unitario || 0, estado || 'pendiente', await esAdicional(conn, req.params.id)]
    );
    // Actualizar costo_repuestos en la orden
    await conn.query(
      'UPDATE ordenes_trabajo SET costo_repuestos = (SELECT COALESCE(SUM(cantidad * costo_unitario), 0) FROM orden_repuestos WHERE rechazado = 0 AND orden_id = ? AND tenant_id = @tenant) WHERE tenant_id = @tenant AND id = ?',
      [req.params.id, req.params.id]
    );
    const reaprobacion = await revisarAdicional(conn, req.params.id, totalAntes);
    const [[nuevo]] = await conn.query('SELECT * FROM orden_repuestos WHERE tenant_id = @tenant AND id = ?', [result.insertId]);
    await conn.commit();
    confirmada = true;
    res.status(201).json({ data: nuevo, reaprobacion, message: reaprobacion ? MSG_REAPROBACION : 'Repuesto agregado' });
  } catch (err) {
    fail(res, err);
  } finally {
    if (conn) {
      if (!confirmada) await conn.rollback();
      conn.release();
    }
  }
});

// GET /api/ordenes/:id/tiempos — línea de tiempo de la orden (fecha/hora de cada fase)
router.get('/:id/tiempos', async (req, res) => {
  try {
    const [rows] = await req.db.query(
      'SELECT etapa, inicio, fin FROM orden_tiempos WHERE tenant_id = @tenant AND orden_id = ? ORDER BY inicio ASC',
      [req.params.id]
    );
    res.json({ data: rows });
  } catch (err) {
    fail(res, err);
  }
});

// GET /api/ordenes/:id/repuestos
// Los que el cliente rechazó no salen (la factura y el detalle suman esta lista):
// ?incluir_rechazados=1 los trae marcados con rechazado = 1.
router.get('/:id/repuestos', async (req, res) => {
  try {
    const [rows] = await req.db.query(
      `SELECT * FROM orden_repuestos WHERE tenant_id = @tenant AND orden_id = ?${req.query.incluir_rechazados === '1' ? '' : ' AND rechazado = 0'} ORDER BY created_at ASC`,
      [req.params.id]
    );
    res.json({ data: rows });
  } catch (err) {
    fail(res, err);
  }
});

// PUT /api/ordenes/:id/repuestos/:rid
router.put('/:id/repuestos/:rid', soloRoles('recepcion', 'admin'), exigirPermiso('ordenes.costos'), async (req, res) => {
  let conn;
  let confirmada = false;
  try {
    conn = await req.db.conexion();
    await conn.beginTransaction();
    if (!(await validarEdicionCostos(conn, req.params.id, res))) return;
    const { nombre, cantidad, costo_unitario, estado } = req.body;
    const [[existe]] = await conn.query('SELECT id, estado, rechazado FROM orden_repuestos WHERE tenant_id = @tenant AND id = ? AND orden_id = ?', [req.params.rid, req.params.id]);
    if (!existe) return res.status(404).json({ error: 'Repuesto no encontrado' });
    if (existe.rechazado) return res.status(409).json({ error: 'El cliente rechazó este repuesto: queda como registro; si hace falta, agregá uno nuevo' });
    if (estado && !ESTADOS_REPUESTO[estado]) return res.status(400).json({ error: 'Estado de repuesto inválido' });
    const totalAntes = await totalOrden(conn, req.params.id);
    await conn.query(
      'UPDATE orden_repuestos SET nombre=?, cantidad=?, costo_unitario=?, estado=? WHERE tenant_id = @tenant AND id=? AND orden_id=?',
      [nombre, cantidad || 1, costo_unitario || 0, estadoAlEditarRepuesto(existe.estado, estado, costo_unitario), req.params.rid, req.params.id]
    );
    await conn.query(
      'UPDATE ordenes_trabajo SET costo_repuestos = (SELECT COALESCE(SUM(cantidad * costo_unitario), 0) FROM orden_repuestos WHERE rechazado = 0 AND orden_id = ? AND tenant_id = @tenant) WHERE tenant_id = @tenant AND id = ?',
      [req.params.id, req.params.id]
    );
    const reaprobacion = await revisarAdicional(conn, req.params.id, totalAntes);
    const [[actualizado]] = await conn.query('SELECT * FROM orden_repuestos WHERE tenant_id = @tenant AND id = ?', [req.params.rid]);
    await conn.commit();
    confirmada = true;
    res.json({ data: actualizado, reaprobacion, message: reaprobacion ? MSG_REAPROBACION : 'Repuesto actualizado' });
  } catch (err) {
    fail(res, err);
  } finally {
    if (conn) {
      if (!confirmada) await conn.rollback();
      conn.release();
    }
  }
});

// DELETE /api/ordenes/:id/repuestos/:rid
router.delete('/:id/repuestos/:rid', requireRol('admin'), async (req, res) => {
  let conn;
  let confirmada = false;
  try {
    conn = await req.db.conexion();
    await conn.beginTransaction();
    if (!(await validarEdicionCostos(conn, req.params.id, res))) return;
    const totalAntes = await totalOrden(conn, req.params.id);
    const [result] = await conn.query('DELETE FROM orden_repuestos WHERE tenant_id = @tenant AND id=? AND orden_id=? AND rechazado = 0', [req.params.rid, req.params.id]);
    if (!result.affectedRows) return res.status(404).json({ error: 'Repuesto no encontrado' });
    await conn.query(
      'UPDATE ordenes_trabajo SET costo_repuestos = (SELECT COALESCE(SUM(cantidad * costo_unitario), 0) FROM orden_repuestos WHERE rechazado = 0 AND orden_id = ? AND tenant_id = @tenant) WHERE tenant_id = @tenant AND id = ?',
      [req.params.id, req.params.id]
    );
    // Quitar nunca sube la cuenta: solo actualiza la copia de lo aprobado.
    await revisarAdicional(conn, req.params.id, totalAntes);
    await conn.commit();
    confirmada = true;
    res.json({ message: 'Repuesto eliminado' });
  } catch (err) {
    fail(res, err);
  } finally {
    if (conn) {
      if (!confirmada) await conn.rollback();
      conn.release();
    }
  }
});

// Nota: la aprobación del presupuesto la hace el cliente desde el portal
// (POST /api/portal/ordenes/:id/aprobar|rechazar), que actualiza el ENUM
// `aprobacion_cliente` — única fuente de verdad que muestra toda la UI.

// POST /GET /api/ordenes/:id/checklist
router.post('/:id/checklist', exigirPermiso('ordenes.entregar'), async (req, res) => {
  try {
    const { prueba_realizada, lavado, calidad_revisada, facturacion_lista, cliente_notificado, observaciones } = req.body;
    // La orden tiene que ser de este taller. `orden_id` es único en TODA la tabla, no por
    // taller: sin este chequeo, mandar el id de una orden ajena hacía que el upsert de
    // abajo pisara el checklist de otro taller (o, si no tenía, le dejaba una fila a
    // nombre de quien la mandó y el dueño ya no podía crear la suya).
    const [[orden]] = await req.db.query('SELECT id FROM ordenes_trabajo WHERE tenant_id = @tenant AND id = ?', [req.params.id]);
    if (!orden) return res.status(404).json({ error: 'Orden no encontrada' });
    await req.db.query(
      `INSERT INTO orden_checklist (tenant_id,orden_id, prueba_realizada, lavado, calidad_revisada, facturacion_lista, cliente_notificado, observaciones)
       VALUES (@tenant, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (tenant_id, orden_id) DO UPDATE SET prueba_realizada = EXCLUDED.prueba_realizada, lavado = EXCLUDED.lavado,
         calidad_revisada = EXCLUDED.calidad_revisada, facturacion_lista = EXCLUDED.facturacion_lista,
         cliente_notificado = EXCLUDED.cliente_notificado, observaciones = EXCLUDED.observaciones
       WHERE orden_checklist.tenant_id = EXCLUDED.tenant_id`,
      [req.params.id, prueba_realizada ? 1 : 0, lavado ? 1 : 0, calidad_revisada ? 1 : 0, facturacion_lista ? 1 : 0, cliente_notificado ? 1 : 0, observaciones || null]
    );
    res.json({ message: 'Checklist guardado' });
  } catch (err) {
    fail(res, err);
  }
});

router.get('/:id/checklist', async (req, res) => {
  try {
    const [[checklist]] = await req.db.query('SELECT * FROM orden_checklist WHERE tenant_id = @tenant AND orden_id = ? AND tenant_id = @tenant', [req.params.id]);
    res.json({ data: checklist || null });
  } catch (err) {
    fail(res, err);
  }
});

// PATCH /api/ordenes/:id/cerrar — cierre + fidelización (lógica compartida en utils).
router.patch('/:id/cerrar', requireRol('admin'), async (req, res) => {
  try {
    const { metodo_pago, garantia_dias, observaciones_finales } = req.body;
    // Una orden cancelada o ya entregada no se vuelve a cerrar (contaría otra visita
    // del cliente y le cambiaría la fecha de entrega).
    const [[actual]] = await req.db.query('SELECT estado FROM ordenes_trabajo WHERE tenant_id = @tenant AND id = ?', [req.params.id]);
    if (!actual) return res.status(404).json({ error: 'Orden no encontrada' });
    if (['entregada', 'cancelada'].includes(actual.estado)) {
      return res.status(400).json({ error: actual.estado === 'entregada' ? 'La orden ya estaba entregada' : 'La orden está cancelada' });
    }
    const r = await cerrarOrden(req.db, req.params.id, { metodo_pago, garantia_dias, observaciones_finales }, {
      soloDesdeListaEntrega: false, confirmar: req.body.confirmar, motivo: req.body.motivo, usuarioId: req.usuario.id,
    });
    if (r.notFound) return res.status(404).json({ error: 'Orden no encontrada' });
    if (r.estadoInvalido) return res.status(409).json({ error: 'La orden debe estar lista para entrega; el cierre excepcional requiere confirmar: true y un motivo de 5 a 500 caracteres', codigo: 'requiere_confirmacion', estado_actual: r.estadoActual });
    res.json({ message: 'Orden cerrada y entregada', cortesia_ganada: r.cortesiaGanada });
  } catch (err) {
    fail(res, err);
  }
});

// POST /api/ordenes/:id/fotos — guarda una foto (data URL base64) como evidencia
router.post('/:id/fotos', exigirPermiso('taller.fotos'), async (req, res) => {
  try {
    const { url, tipo, descripcion } = req.body;
    if (!url) return res.status(400).json({ error: 'Imagen requerida' });
    if (!fotoValida(url)) return res.status(400).json({ error: 'Imagen inválida' });
    const tiposValidos = ['ingreso', 'diagnostico', 'avance', 'entrega'];
    const tipoFinal = tiposValidos.includes(tipo) ? tipo : 'ingreso';
    const [result] = await req.db.query(
      'INSERT INTO orden_fotos (tenant_id,orden_id, url, tipo, descripcion) VALUES (@tenant, ?, ?, ?, ?)',
      [req.params.id, url, tipoFinal, descripcion || null]
    );
    const [[nueva]] = await req.db.query('SELECT * FROM orden_fotos WHERE tenant_id = @tenant AND id = ?', [result.insertId]);
    res.status(201).json({ data: nueva, message: 'Foto agregada' });
  } catch (err) {
    fail(res, err);
  }
});

// GET /api/ordenes/:id/fotos
router.get('/:id/fotos', async (req, res) => {
  try {
    const [rows] = await req.db.query(
      'SELECT * FROM orden_fotos WHERE tenant_id = @tenant AND orden_id = ? ORDER BY created_at ASC',
      [req.params.id]
    );
    res.json({ data: rows });
  } catch (err) {
    fail(res, err);
  }
});

// DELETE /api/ordenes/:id/fotos/:fid
router.delete('/:id/fotos/:fid', requireRol('admin'), async (req, res) => {
  try {
    const [result] = await req.db.query('DELETE FROM orden_fotos WHERE tenant_id = @tenant AND id = ? AND orden_id = ?', [req.params.fid, req.params.id]);
    if (!result.affectedRows) return res.status(404).json({ error: 'Foto no encontrada' });
    res.json({ message: 'Foto eliminada' });
  } catch (err) {
    fail(res, err);
  }
});

// ───────────────────────────────────────────────────────────
// Mensajes internos vinculados a ESTA orden (contexto de orden).
// Recepción/admin ↔ el mecánico asignado hablan sobre la orden desde su detalle.
// ───────────────────────────────────────────────────────────
const SELECT_MSG_ORDEN = `
  SELECT m.id, m.mensaje, m.foto, m.orden_id, m.tipo, m.created_at,
         m.remitente_id, m.destino_rol, m.destino_id,
         ru.nombre AS remitente_nombre, ru.rol AS remitente_rol,
         du.nombre AS destino_nombre,
         ${LEIDO_POR_MI}, ${VISTO_POR_OTRO}
  FROM mensajes_internos m
  JOIN usuarios ru ON ru.id = m.remitente_id AND ru.tenant_id = @tenant AND m.tenant_id = @tenant
  LEFT JOIN usuarios du ON du.id = m.destino_id AND du.tenant_id = @tenant`;

// GET /api/ordenes/:id/mensajes — hilo de la orden (marca leídos los míos).
router.get('/:id/mensajes', async (req, res) => {
  try {
    const yo = req.usuario.id;
    const [rows] = await req.db.query(
      `${SELECT_MSG_ORDEN} WHERE m.tenant_id = @tenant AND m.orden_id = ? ORDER BY m.created_at ASC LIMIT 100`,
      [yo, req.params.id]
    );
    await marcarLeidos(req.db, yo, rows);
    res.json({ data: rows });
  } catch (err) {
    fail(res, err);
  }
});

// POST /api/ordenes/:id/mensajes — enviar un mensaje sobre la orden.
// Mecánico → recepción; recepción/admin → el mecánico asignado.
router.post('/:id/mensajes', async (req, res) => {
  try {
    const { mensaje, foto } = req.body;
    if ((!mensaje || !mensaje.trim()) && !foto) return res.status(400).json({ error: 'El mensaje o una foto es requerido' });
    const [[orden]] = await req.db.query('SELECT id, tecnico_id, sucursal_id FROM ordenes_trabajo WHERE tenant_id = @tenant AND id = ?', [req.params.id]);
    if (!orden) return res.status(404).json({ error: 'Orden no encontrada' });

    let destino_rol = null, destino_id = null;
    if (req.usuario.rol === 'tecnico') {
      destino_rol = 'recepcion';
    } else if (orden.tecnico_id) {
      destino_id = orden.tecnico_id;
    } else {
      return res.status(400).json({ error: 'Asigná un mecánico a la orden para enviarle un mensaje' });
    }
    const [r] = await req.db.query(
      `INSERT INTO mensajes_internos (tenant_id,remitente_id, destino_rol, destino_id, mensaje, foto, orden_id, sucursal_id, tipo)
       VALUES (@tenant, ?, ?, ?, ?, ?, ?, ?, 'directo')`,
      [req.usuario.id, destino_rol, destino_id, (mensaje || '').trim(), foto || null, orden.id, orden.sucursal_id || null]
    );
    const [[nuevo]] = await req.db.query(`${SELECT_MSG_ORDEN} WHERE m.tenant_id = @tenant AND m.id = ?`, [req.usuario.id, r.insertId]);
    res.status(201).json({ data: nuevo, message: 'Mensaje enviado' });
  } catch (err) {
    fail(res, err);
  }
});

module.exports = router;
