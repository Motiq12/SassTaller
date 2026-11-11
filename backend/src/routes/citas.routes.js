const router = require('express').Router();
// Sin `pool`: todo el acceso pasa por req.db, scopeado al taller.
const { fail, invalido, faltante } = require('../utils/responder');
const auth = require('../middleware/auth');
const requireRol = require('../middleware/roles');
const { soloRoles } = require('../middleware/roles');
const { cargarAlcance, soloSucursal, sucursalParaGuardar, exigirSucursal, delTaller, SUCURSAL_DE_CITA } = require('../utils/alcance');
const { notificarCambioEstado, notificarMecanico, notificarCitaAgendada } = require('../utils/notificaciones');
const { TRANSICIONES_CITA, transicionPermitida } = require('../utils/transiciones');
const { sucursalValida, tecnicoEnSucursal } = require('../utils/sucursales');
const { textoDentroDeLimite } = require('../utils/validar');
const { getConfig } = require('../utils/configuracion');
const { serviciosDelPedido, pedidoTraeServicios, problemaConServicios, textoServicios, guardarServiciosCita } = require('../utils/servicios-cita');
const { agendaDia, duracionValida, horasDeCita, conflictosDeCita, textoConflictos, problemaDeHorario } = require('../utils/agenda');
const { exigirPermiso } = require('../middleware/permisos');
const { anotar } = require('../utils/actividad');

// Si se puede poner la cita ahí (utils/agenda.js → problemaDeHorario): nadie agenda en
// el pasado; recepción, además, solo dentro del horario, sin bloqueo y con lugar.
// Administración se salta eso último: ella puso el bloqueo y sabe si el taller da abasto.
async function rechazoDeHorario(req, res, { fecha, hora, sucursalId, excluirId = null, minutos = null }) {
  const p = await problemaDeHorario({
    db: req.db, fecha, hora, sucursalId, excluirId, minutos, config: await getConfig(req.db), puedeForzar: req.usuario.rol === 'admin',
  });
  if (!p) return false;
  invalido(res, p.campo, p.error, p.status || 400);
  return true;
}

const ESTADOS = ['agendado', 'en_revision', 'en_mantenimiento', 'listo', 'entregado', 'cancelado'];
const MAX_MOTIVO = 1000;

// Tope del listado (ver comentario en clientes.routes.js): los filtros por fecha,
// estado, técnico, sucursal y búsqueda son server-side.
const MAX_LISTADO = 500;

// Quién gestiona la agenda (crear/editar citas): mostrador y administración, NO el técnico.
// El técnico solo mueve el estado de SUS citas (más abajo y en /api/mecanico).
const GESTIONA_AGENDA = ['recepcion', 'admin'];

// Piso de rol: recepción o superior. Sin esto, cualquier token válido (incluido el
// de un cliente del portal) podía leer la agenda y cambiar el estado de cualquier cita.
// El mecánico tampoco: ve y mueve sus citas por /api/mecanico (antes, por la jerarquía,
// leía la agenda de todo el taller).
router.use(auth, soloRoles('recepcion', 'admin'));
// Quien tiene una sucursal ve solo las citas de ella (utils/alcance.js). Todas las
// rutas con :id de este archivo son de una cita: una de la otra sucursal da 404.
router.use(cargarAlcance);
router.param('id', delTaller('citas'));
router.param('id', exigirSucursal(SUCURSAL_DE_CITA));

router.get('/', async (req, res) => {
  try {
    const { fecha, estado, tecnico_id, sucursal_id, q } = req.query;
    let sql = `SELECT ci.*, c.nombre AS cliente_nombre, c.apellido AS cliente_apellido, c.telefono AS cliente_telefono,
                      m.marca, m.modelo, m.placa,
                      u.nombre AS usuario_nombre,
                      t.nombre AS tecnico_nombre,
                      s.nombre AS sucursal_nombre,
                      o.numero_orden
               FROM citas ci
               JOIN clientes c ON ci.cliente_id = c.id AND c.tenant_id = @tenant
               LEFT JOIN vehiculos m ON ci.vehiculo_id = m.id AND m.tenant_id = @tenant
               LEFT JOIN ordenes_trabajo o ON o.id = ci.orden_id AND o.tenant_id = @tenant
               LEFT JOIN usuarios u ON ci.usuario_id = u.id AND u.tenant_id = @tenant
               LEFT JOIN usuarios t ON ci.tecnico_id = t.id AND t.tenant_id = @tenant
               LEFT JOIN sucursales s ON s.id = ci.sucursal_id AND s.tenant_id = @tenant
               WHERE ci.tenant_id = @tenant`;
    const params = [];
    if (fecha) { sql += ' AND ci.fecha = ?'; params.push(fecha); }
    if (estado) { sql += ' AND ci.estado = ?'; params.push(estado); }
    if (tecnico_id) { sql += ' AND ci.tecnico_id = ?'; params.push(tecnico_id); }
    if (sucursal_id) { sql += ' AND ci.sucursal_id = ?'; params.push(sucursal_id); }
    // ?sin_orden=1: las citas vigentes que todavía no tienen orden de trabajo.
    if (req.query.sin_orden === '1') sql += " AND ci.orden_id IS NULL AND ci.estado NOT IN ('cancelado','entregado')";
    if (q) {
      // En Postgres " " es un identificador, no un texto: el espacio va entre comillas simples.
      sql += " AND (c.nombre ILIKE ? OR c.apellido ILIKE ? OR (c.nombre || ' ' || c.apellido) ILIKE ? OR m.placa ILIKE ?)";
      const like = `%${q}%`;
      params.push(like, like, like, like);
    }
    sql += soloSucursal(req, 'ci.sucursal_id');
    // Las MAX_LISTADO más recientes, mostradas de la más vieja a la más nueva. Antes se
    // cortaban las más viejas: pasadas las 500 citas, las nuevas ya no aparecían.
    sql = `SELECT * FROM (${sql} ORDER BY ci.fecha DESC, ci.hora DESC, ci.id DESC LIMIT ${MAX_LISTADO}) recientes
           ORDER BY fecha ASC, hora ASC, id ASC`;
    const [rows] = await req.db.query(sql, params);
    res.json({ data: rows });
  } catch (err) {
    fail(res, err);
  }
});

router.post('/', soloRoles(...GESTIONA_AGENDA), exigirPermiso('citas.agendar'), async (req, res) => {
  try {
    const { cliente_id, vehiculo_id, fecha, hora, tecnico_id } = req.body;
    const motivo = String(req.body.motivo || '').trim();
    if (faltante(res, { ...req.body, motivo }, [['cliente_id', 'el cliente'], ['fecha', 'la fecha'], ['hora', 'la hora'], ['motivo', 'el motivo']])) return;
    if (!textoDentroDeLimite(motivo, MAX_MOTIVO)) {
      return invalido(res, 'motivo', `El motivo no puede pasar de ${MAX_MOTIVO} caracteres`);
    }
    // Uno o varios servicios (o ninguno: el personal puede agendar solo con el motivo).
    const servicios = serviciosDelPedido(req.body);
    const problemaServicios = await problemaConServicios(req.db, servicios);
    if (problemaServicios) return invalido(res, 'servicios', problemaServicios);
    const sucursal_id = sucursalParaGuardar(req, (await sucursalValida(req.db, req.body.sucursal_id)) ? Number(req.body.sucursal_id) : null);
    if (!(await tecnicoEnSucursal(req.db, tecnico_id, sucursal_id))) {
      return invalido(res, 'tecnico_id', 'El mecánico no atiende en esa sucursal');
    }
    const esAdmin = req.usuario.rol === 'admin';
    if (await rechazoDeHorario(req, res, { fecha, hora, sucursalId: sucursal_id })) return;
    // La duración solo la decide administración; las demás nacen de 1 hora.
    const duracion = esAdmin && duracionValida(req.body.duracion_horas) ? Number(req.body.duracion_horas) : 1;
    const [result] = await req.db.query(
      'INSERT INTO citas (tenant_id, cliente_id, vehiculo_id, usuario_id, tecnico_id, sucursal_id, fecha, hora, motivo, tipo_servicio, duracion_horas) VALUES (@tenant, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [cliente_id, vehiculo_id || null, req.usuario.id, tecnico_id || null, sucursal_id, fecha, hora, motivo, servicios[0] || null, duracion]
    );
    await guardarServiciosCita(result.insertId, servicios, req.db);
    const [[nueva]] = await req.db.query('SELECT * FROM citas WHERE tenant_id = @tenant AND id = ?', [result.insertId]);
    if (tecnico_id) {
      await notificarMecanico(req.db, tecnico_id, `Nueva cita asignada: ${textoServicios(servicios) || motivo} el ${fecha} a las ${hora}`, req.usuario.id);
    }
    // El cliente también se entera: el taller le agendó una cita desde el mostrador.
    await notificarCitaAgendada(req.db, result.insertId);
    res.status(201).json({ data: nueva, message: 'Cita creada' });
  } catch (err) {
    fail(res, err);
  }
});

// DELETE /api/citas/:id — borra una cita (solo administración), para las que se
// agendaron por error o de prueba. Una cita con orden no se borra (la orden es la que
// guarda el trabajo: se elimina primero la orden), ni una entregada (queda en el
// historial). Para una que el cliente ya no quiere, lo normal es cancelarla.
router.delete('/:id', requireRol('admin'), async (req, res) => {
  const conn = await req.db.conexion();
  try {
    await conn.beginTransaction();
    const [[cita]] = await conn.query(
      `SELECT ci.id, ci.estado, ci.orden_id, o.numero_orden, to_char(ci.fecha, 'DD/MM/YYYY') AS fecha,
              to_char(ci.hora, 'HH24:MI') AS hora, CONCAT_WS(' ', c.nombre, c.apellido) AS cliente
       FROM citas ci
       LEFT JOIN clientes c ON c.id = ci.cliente_id AND c.tenant_id = @tenant
       LEFT JOIN ordenes_trabajo o ON o.id = ci.orden_id AND o.tenant_id = @tenant
       WHERE ci.tenant_id = @tenant AND ci.id = ? FOR UPDATE`,
      [req.params.id]
    );
    if (!cita) { await conn.rollback(); return res.status(404).json({ error: 'Cita no encontrada' }); }
    if (cita.orden_id) {
      await conn.rollback();
      const orden = cita.numero_orden ? `la orden ${cita.numero_orden}` : 'una orden';
      return res.status(409).json({ error: `Esta cita tiene ${orden}. Para borrarla, primero eliminá la orden.` });
    }
    if (cita.estado === 'entregado') {
      await conn.rollback();
      return res.status(409).json({ error: 'Esta cita ya se entregó: se queda en el historial. No se puede borrar.' });
    }
    await conn.query('DELETE FROM notificaciones WHERE tenant_id = @tenant AND cita_id = ?', [cita.id]);
    await conn.query('DELETE FROM citas WHERE tenant_id = @tenant AND id = ?', [cita.id]);
    await conn.commit();
    anotar(req.usuario.id, 'cita_eliminada', `${cita.cliente || 'Cliente'} · ${cita.fecha} ${cita.hora}`);
    res.json({ message: 'Cita eliminada' });
  } catch (err) {
    await conn.rollback();
    fail(res, err);
  } finally {
    conn.release();
  }
});

router.get('/:id', async (req, res) => {
  try {
    const [[cita]] = await req.db.query(
      `SELECT ci.*, c.nombre AS cliente_nombre, c.apellido AS cliente_apellido, c.telefono AS cliente_telefono,
              m.marca, m.modelo, m.placa
       FROM citas ci
       JOIN clientes c ON ci.cliente_id = c.id AND c.tenant_id = @tenant
       LEFT JOIN vehiculos m ON ci.vehiculo_id = m.id AND m.tenant_id = @tenant
       WHERE ci.tenant_id = @tenant AND ci.id = ?`,
      [req.params.id]
    );
    if (!cita) return res.status(404).json({ error: 'Cita no encontrada' });
    res.json({ data: cita });
  } catch (err) {
    fail(res, err);
  }
});

router.put('/:id', soloRoles(...GESTIONA_AGENDA), exigirPermiso('citas.agendar'), async (req, res) => {
  try {
    const { cliente_id, vehiculo_id, fecha, hora, tecnico_id } = req.body;
    const motivo = String(req.body.motivo || '').trim();
    if (!textoDentroDeLimite(motivo, MAX_MOTIVO)) {
      return invalido(res, 'motivo', `El motivo no puede pasar de ${MAX_MOTIVO} caracteres`);
    }
    // Servicios: si la pantalla los manda, reemplazan a los que tenía; si no, se conservan.
    const cambiaServicios = pedidoTraeServicios(req.body);
    const servicios = serviciosDelPedido(req.body);
    const problemaServicios = cambiaServicios ? await problemaConServicios(req.db, servicios) : null;
    if (problemaServicios) return invalido(res, 'servicios', problemaServicios);
    // Solo cambia la sucursal si llega una válida (no la borra al editar otros campos).
    const sucursalNueva = sucursalParaGuardar(req, (await sucursalValida(req.db, req.body.sucursal_id)) ? Number(req.body.sucursal_id) : null);
    // Fecha/hora previas: si el taller mueve la cita hay que avisarle al cliente
    // (antes se le cambiaba el día y no se enteraba por ningún lado).
    const [[previa]] = await req.db.query(
      "SELECT to_char(fecha, 'YYYY-MM-DD') AS fecha, to_char(hora, 'HH24:MI') AS hora, sucursal_id, duracion_horas, duracion_min FROM citas WHERE tenant_id = @tenant AND id = ?",
      [req.params.id]
    );
    // Solo si de verdad cambió el momento de la cita (editar el motivo no molesta al cliente).
    const movida = previa && (previa.fecha !== String(fecha).slice(0, 10) || previa.hora !== String(hora).slice(0, 5));
    const esAdmin = req.usuario.rol === 'admin';
    // Servicio rápido de Ingresar ahora (20, 30 o 40 min): editar la cita no se lo quita.
    const minutos = previa?.duracion_min || null;
    // Solo si se mueve: editar el motivo de una cita vieja no tiene por qué fallar.
    if (movida && await rechazoDeHorario(req, res, { fecha, hora, sucursalId: sucursalNueva || previa.sucursal_id, excluirId: Number(req.params.id), minutos })) return;
    // La duración solo la cambia administración; si no viene, se conserva.
    const duracion = minutos ? 1 : (esAdmin && duracionValida(req.body.duracion_horas) ? Number(req.body.duracion_horas) : (previa?.duracion_horas || 1));
    await req.db.query(
      `UPDATE citas SET cliente_id=?, vehiculo_id=?, tecnico_id=?, fecha=?, hora=?, motivo=?,
         sucursal_id = COALESCE(?, sucursal_id), duracion_horas = ? WHERE tenant_id = @tenant AND id=?`,
      [cliente_id, vehiculo_id || null, tecnico_id || null, fecha, hora, motivo, sucursalNueva, duracion, req.params.id]
    );
    if (cambiaServicios) await guardarServiciosCita(req.params.id, servicios, req.db);
    const [[actualizada]] = await req.db.query('SELECT * FROM citas WHERE tenant_id = @tenant AND id = ?', [req.params.id]);
    if (movida) await notificarCitaAgendada(req.db, req.params.id, { reprogramada: true });
    res.json({ data: actualizada, message: 'Cita actualizada' });
  } catch (err) {
    fail(res, err);
  }
});

// PATCH /api/citas/:id/duracion — cuánto dura la cita (solo administración).
// Body: { duracion_horas, forzar? }. Si en alguna de las horas nuevas ya no hay
// lugar o está bloqueada, responde 409 con la lista para que la persona decida; con
// forzar se guarda igual (administración sabe si ese día pueden con una más).
// Un servicio rápido de Ingresar ahora pasa a ser cita normal de esas horas.
router.patch('/:id/duracion', soloRoles('admin'), async (req, res) => {
  try {
    const duracion = Number(req.body.duracion_horas);
    if (!duracionValida(duracion)) return res.status(400).json({ error: 'Duración no válida' });
    const [[cita]] = await req.db.query(
      "SELECT id, estado, sucursal_id, to_char(fecha, 'YYYY-MM-DD') AS fecha, to_char(hora, 'HH24:MI') AS hora FROM citas WHERE tenant_id = @tenant AND id = ?",
      [req.params.id]
    );
    if (!cita) return res.status(404).json({ error: 'Cita no encontrada' });
    if (['entregado', 'cancelado'].includes(cita.estado)) {
      return res.status(409).json({ error: 'Esta cita ya está cerrada' });
    }
    const config = await getConfig(req.db);
    const dia = await agendaDia(cita.fecha, cita.sucursal_id, config, { db: req.db, excluirId: cita.id });
    const conflictos = conflictosDeCita(dia, cita.hora, duracion, Number(config.max_citas_hora) || 1);
    if (conflictos.length && !req.body.forzar) {
      return res.status(409).json({
        requiere_confirmacion: true,
        conflictos,
        error: `En estas horas ya no hay lugar: ${textoConflictos(conflictos)}.`,
      });
    }
    await req.db.query('UPDATE citas SET duracion_horas = ?, duracion_min = NULL WHERE tenant_id = @tenant AND id = ?', [duracion, cita.id]);
    res.json({ message: 'Duración actualizada', horas: horasDeCita(cita.hora, duracion, dia.horas) });
  } catch (err) {
    fail(res, err);
  }
});

router.patch('/:id/estado', exigirPermiso((req) => (req.body && req.body.estado === 'cancelado' ? 'citas.cancelar' : 'citas.agendar')), async (req, res) => {
  try {
    const { estado } = req.body;
    if (!ESTADOS.includes(estado)) return res.status(400).json({ error: 'Estado inválido' });

    const [[cita]] = await req.db.query('SELECT id, tecnico_id, estado FROM citas WHERE tenant_id = @tenant AND id = ?', [req.params.id]);
    if (!cita) return res.status(404).json({ error: 'Cita no encontrada' });

    // Un técnico solo puede mover SUS citas; admin (y recepción) pueden cualquiera.
    if (req.usuario.rol === 'tecnico' && cita.tecnico_id !== req.usuario.id) {
      return res.status(403).json({ error: 'Solo podés cambiar el estado de tus citas asignadas' });
    }

    // Solo transiciones válidas del flujo de la cita.
    if (!transicionPermitida(TRANSICIONES_CITA, cita.estado, estado)) {
      return res.status(400).json({ error: `Transición no permitida: ${cita.estado} → ${estado}` });
    }

    await req.db.query('UPDATE citas SET estado = ? WHERE tenant_id = @tenant AND id = ?', [estado, req.params.id]);
    await notificarCambioEstado(req.db, req.params.id, estado);
    res.json({ message: 'Estado de cita actualizado' });
  } catch (err) {
    fail(res, err);
  }
});

// POST /api/citas/:id/entregar — la entrega la marca quien está en el mostrador
// cuando el cliente se lleva la moto (recepción o administración), no el mecánico
// ni el cliente: antes una cita sin orden solo la podía entregar el mecánico, y si
// se le olvidaba quedaba "Lista" para siempre.
// Body: { monto?, metodo_pago?, forzar? }. Si la cita todavía no estaba "Lista",
// responde 409 con requiere_confirmacion salvo que venga forzar (la moto se fue
// antes de que alguien actualizara el estado). Las citas CON orden se entregan
// desde la orden, que además registra la garantía y la fidelización.
router.post('/:id/entregar', soloRoles(...GESTIONA_AGENDA), exigirPermiso('ordenes.entregar'), async (req, res) => {
  try {
    const { monto, metodo_pago, forzar } = req.body || {};
    const [[cita]] = await req.db.query('SELECT id, estado, orden_id FROM citas WHERE tenant_id = @tenant AND id = ?', [req.params.id]);
    if (!cita) return res.status(404).json({ error: 'Cita no encontrada' });
    if (cita.orden_id) {
      return res.status(409).json({ error: 'Esta cita tiene una orden de trabajo: entrégala desde la orden.', orden_id: cita.orden_id });
    }
    if (cita.estado === 'entregado' || cita.estado === 'cancelado') {
      return res.status(400).json({ error: cita.estado === 'entregado' ? 'La cita ya estaba entregada' : 'La cita está cancelada' });
    }
    if (cita.estado !== 'listo' && forzar !== true) {
      return res.status(409).json({ error: 'La cita todavía no estaba marcada como lista', requiere_confirmacion: true, estado_actual: cita.estado });
    }
    let montoNum = null;
    if (monto !== undefined && monto !== null && monto !== '') {
      montoNum = Number(monto);
      if (!Number.isFinite(montoNum) || montoNum < 0) return invalido(res, 'monto', 'El monto no es válido');
    }
    let metodo = null;
    if (metodo_pago) {
      const config = await getConfig(req.db);
      const validos = (config.metodos_pago || []).map((m) => m.valor);
      if (!validos.includes(metodo_pago)) return res.status(400).json({ error: 'Forma de pago no válida' });
      metodo = metodo_pago;
    }
    // Las fechas que faltan se completan: los reportes miden tiempos con ellas.
    const sets = [
      "estado = 'entregado'",
      'fecha_inicio = COALESCE(fecha_inicio, NOW())',
      'fecha_listo = COALESCE(fecha_listo, NOW())',
      'fecha_fin = NOW()',
    ];
    const params = [];
    if (montoNum !== null) { sets.push('monto = ?'); params.push(montoNum); }
    if (metodo) { sets.push('metodo_pago = ?'); params.push(metodo); }
    params.push(req.params.id);
    await req.db.query(`UPDATE citas SET ${sets.join(', ')} WHERE id = ? AND tenant_id = @tenant`, params);
    await notificarCambioEstado(req.db, req.params.id, 'entregado');
    res.json({ message: 'Cita entregada' });
  } catch (err) {
    fail(res, err);
  }
});

// PATCH /api/citas/:id/asignar — el admin asigna la cita a un técnico
router.patch('/:id/asignar', requireRol('admin'), async (req, res) => {
  try {
    const { tecnico_id } = req.body;
    await req.db.query('UPDATE citas SET tecnico_id = ? WHERE tenant_id = @tenant AND id = ?', [tecnico_id || null, req.params.id]);
    // La orden de esa cita va con ella: si no, el mecánico anterior seguiría trabajándola.
    const [[vinculo]] = await req.db.query('SELECT orden_id FROM citas WHERE tenant_id = @tenant AND id = ?', [req.params.id]);
    if (vinculo?.orden_id) {
      await req.db.query('UPDATE ordenes_trabajo SET tecnico_id = ? WHERE tenant_id = @tenant AND id = ?', [tecnico_id || null, vinculo.orden_id]);
    }
    if (tecnico_id) {
      const [[cita]] = await req.db.query("SELECT to_char(fecha, 'YYYY-MM-DD') AS fecha, to_char(hora, 'HH24:MI') AS hora, tipo_servicio, servicios, motivo FROM citas WHERE tenant_id = @tenant AND id = ?", [req.params.id]);
      if (cita) await notificarMecanico(req.db, tecnico_id, `Te asignaron una cita: ${cita.servicios || cita.tipo_servicio || cita.motivo} el ${cita.fecha} a las ${cita.hora}`, req.usuario.id);
    }
    res.json({ message: tecnico_id ? 'Técnico asignado' : 'Asignación quitada' });
  } catch (err) {
    fail(res, err);
  }
});

module.exports = router;
