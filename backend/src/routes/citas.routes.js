const router = require('express').Router();
// Sin `pool`: todo el acceso pasa por req.db, scopeado al taller.
const { fail } = require('../utils/responder');
const auth = require('../middleware/auth');
const requireRol = require('../middleware/roles');
const { soloRoles } = require('../middleware/roles');
const { notificarCambioEstado, notificarMecanico, notificarCitaAgendada } = require('../utils/notificaciones');
const { TRANSICIONES_CITA, transicionPermitida } = require('../utils/transiciones');
const { sucursalValida, tecnicoEnSucursal } = require('../utils/sucursales');
const { textoDentroDeLimite } = require('../utils/validar');

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
router.use(auth, requireRol('recepcion'));

router.get('/', async (req, res) => {
  try {
    const { fecha, estado, tecnico_id, sucursal_id, q } = req.query;
    let sql = `SELECT ci.*, c.nombre AS cliente_nombre, c.apellido AS cliente_apellido, c.telefono AS cliente_telefono,
                      m.marca, m.modelo, m.placa,
                      u.nombre AS usuario_nombre,
                      t.nombre AS tecnico_nombre,
                      s.nombre AS sucursal_nombre
               FROM citas ci
               JOIN clientes c ON ci.cliente_id = c.id AND c.tenant_id = @tenant
               LEFT JOIN vehiculos m ON ci.vehiculo_id = m.id AND m.tenant_id = @tenant
               LEFT JOIN usuarios u ON ci.usuario_id = u.id AND u.tenant_id = @tenant
               LEFT JOIN usuarios t ON ci.tecnico_id = t.id AND t.tenant_id = @tenant
               LEFT JOIN sucursales s ON s.id = ci.sucursal_id AND s.tenant_id = @tenant
               WHERE ci.tenant_id = @tenant`;
    const params = [];
    if (fecha) { sql += ' AND ci.fecha = ?'; params.push(fecha); }
    if (estado) { sql += ' AND ci.estado = ?'; params.push(estado); }
    if (tecnico_id) { sql += ' AND ci.tecnico_id = ?'; params.push(tecnico_id); }
    if (sucursal_id) { sql += ' AND ci.sucursal_id = ?'; params.push(sucursal_id); }
    if (q) {
      // En Postgres " " es un identificador, no un texto: el espacio va entre comillas simples.
      sql += " AND (c.nombre ILIKE ? OR c.apellido ILIKE ? OR (c.nombre || ' ' || c.apellido) ILIKE ? OR m.placa ILIKE ?)";
      const like = `%${q}%`;
      params.push(like, like, like, like);
    }
    sql += ` ORDER BY ci.fecha ASC, ci.hora ASC LIMIT ${MAX_LISTADO}`;
    const [rows] = await req.db.query(sql, params);
    res.json({ data: rows });
  } catch (err) {
    fail(res, err);
  }
});

router.post('/', soloRoles(...GESTIONA_AGENDA), async (req, res) => {
  try {
    const { cliente_id, vehiculo_id, fecha, hora, tipo_servicio, tecnico_id } = req.body;
    const motivo = String(req.body.motivo || '').trim();
    if (!cliente_id || !fecha || !hora || !motivo) {
      return res.status(400).json({ error: 'cliente_id, fecha, hora y motivo son requeridos' });
    }
    if (!textoDentroDeLimite(motivo, MAX_MOTIVO)) {
      return res.status(400).json({ error: `motivo no puede exceder ${MAX_MOTIVO} caracteres` });
    }
    const sucursal_id = (await sucursalValida(req.db, req.body.sucursal_id)) ? Number(req.body.sucursal_id) : null;
    if (!(await tecnicoEnSucursal(req.db, tecnico_id, sucursal_id))) {
      return res.status(400).json({ error: 'El mecánico no atiende en esa sucursal' });
    }
    const [result] = await req.db.query(
      'INSERT INTO citas (tenant_id,cliente_id, vehiculo_id, usuario_id, tecnico_id, sucursal_id, fecha, hora, motivo, tipo_servicio) VALUES (@tenant, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [cliente_id, vehiculo_id || null, req.usuario.id, tecnico_id || null, sucursal_id, fecha, hora, motivo, tipo_servicio || null]
    );
    const [[nueva]] = await req.db.query('SELECT * FROM citas WHERE tenant_id = @tenant AND id = ?', [result.insertId]);
    if (tecnico_id) {
      await notificarMecanico(req.db, tecnico_id, `Nueva cita asignada: ${tipo_servicio || motivo} el ${fecha} a las ${hora}`, req.usuario.id);
    }
    // El cliente también se entera: el taller le agendó una cita desde el mostrador.
    await notificarCitaAgendada(req.db, result.insertId);
    res.status(201).json({ data: nueva, message: 'Cita creada' });
  } catch (err) {
    fail(res, err);
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

router.put('/:id', soloRoles(...GESTIONA_AGENDA), async (req, res) => {
  try {
    const { cliente_id, vehiculo_id, fecha, hora, tipo_servicio, tecnico_id } = req.body;
    const motivo = String(req.body.motivo || '').trim();
    if (!textoDentroDeLimite(motivo, MAX_MOTIVO)) {
      return res.status(400).json({ error: `motivo no puede exceder ${MAX_MOTIVO} caracteres` });
    }
    // Solo cambia la sucursal si llega una válida (no la borra al editar otros campos).
    const sucursalNueva = (await sucursalValida(req.db, req.body.sucursal_id)) ? Number(req.body.sucursal_id) : null;
    // Fecha/hora previas: si el taller mueve la cita hay que avisarle al cliente
    // (antes se le cambiaba el día y no se enteraba por ningún lado).
    const [[previa]] = await req.db.query(
      "SELECT to_char(fecha, 'YYYY-MM-DD') AS fecha, to_char(hora, 'HH24:MI') AS hora FROM citas WHERE tenant_id = @tenant AND id = ?",
      [req.params.id]
    );
    await req.db.query(
      `UPDATE citas SET cliente_id=?, vehiculo_id=?, tecnico_id=?, fecha=?, hora=?, motivo=?, tipo_servicio=?,
         sucursal_id = COALESCE(?, sucursal_id) WHERE id=? AND tenant_id = @tenant`,
      [cliente_id, vehiculo_id || null, tecnico_id || null, fecha, hora, motivo, tipo_servicio || null, sucursalNueva, req.params.id]
    );
    const [[actualizada]] = await req.db.query('SELECT * FROM citas WHERE tenant_id = @tenant AND id = ?', [req.params.id]);
    // Solo si de verdad cambió el momento de la cita (editar el motivo no molesta al cliente).
    const movida = previa && (previa.fecha !== String(fecha).slice(0, 10) || previa.hora !== String(hora).slice(0, 5));
    if (movida) await notificarCitaAgendada(req.db, req.params.id, { reprogramada: true });
    res.json({ data: actualizada, message: 'Cita actualizada' });
  } catch (err) {
    fail(res, err);
  }
});

router.patch('/:id/estado', async (req, res) => {
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

// PATCH /api/citas/:id/asignar — el admin asigna la cita a un técnico
router.patch('/:id/asignar', requireRol('admin'), async (req, res) => {
  try {
    const { tecnico_id } = req.body;
    await req.db.query('UPDATE citas SET tecnico_id = ? WHERE tenant_id = @tenant AND id = ?', [tecnico_id || null, req.params.id]);
    if (tecnico_id) {
      const [[cita]] = await req.db.query("SELECT to_char(fecha, 'YYYY-MM-DD') AS fecha, to_char(hora, 'HH24:MI') AS hora, tipo_servicio, motivo FROM citas WHERE tenant_id = @tenant AND id = ?", [req.params.id]);
      if (cita) await notificarMecanico(req.db, tecnico_id, `Te asignaron una cita: ${cita.tipo_servicio || cita.motivo} el ${cita.fecha} a las ${cita.hora}`, req.usuario.id);
    }
    res.json({ message: tecnico_id ? 'Técnico asignado' : 'Asignación quitada' });
  } catch (err) {
    fail(res, err);
  }
});

module.exports = router;
