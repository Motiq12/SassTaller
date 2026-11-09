const router = require('express').Router();
const bcrypt = require('bcrypt');
// Sin `pool`: todo el acceso pasa por req.db, scopeado al taller.
const { fail, invalido, faltante } = require('../utils/responder');
const auth = require('../middleware/auth');
const requireRol = require('../middleware/roles');
const { soloRoles } = require('../middleware/roles');
const { cargarAlcance, soloSucursal } = require('../utils/alcance');
const { cedulaValida, telefonoValido } = require('../utils/validar');
const { exigirPermiso } = require('../middleware/permisos');

// El CRUD de clientes (PII: cédula, dirección, edición) es tarea de recepción/admin.
// Membresía exacta: el técnico queda excluido (su panel usa /api/mecanico, que ya
// le da el contexto de cliente que necesita). Los clientes del portal nunca entran.
router.use(auth, soloRoles('recepcion', 'admin'));
// Los clientes se comparten entre sucursales; sus órdenes se filtran (utils/alcance.js).
router.use(cargarAlcance);

// Columnas seguras (nunca exponer password_hash); tiene_portal indica si el acceso está activo.
const COLS = `id, nombre, apellido, telefono, email, cedula, direccion, activo, created_at, updated_at,
              visitas, cortesia_disponible,
              (password_hash IS NOT NULL OR google_sub IS NOT NULL)::int AS tiene_portal`;

// Tope del listado: con miles de clientes, devolverlos todos hace respuestas de varios
// MB que tardan más en viajar y renderizar que en consultarse. La búsqueda por `q` es
// server-side, así que para llegar a uno puntual se filtra en vez de traer todo.
const MAX_LISTADO = 500;

router.get('/', async (req, res) => {
  try {
    const { q } = req.query;
    let sql = `SELECT ${COLS} FROM clientes WHERE activo = 1 AND tenant_id = @tenant`;
    const params = [];
    if (q) {
      sql += ' AND (nombre ILIKE ? OR apellido ILIKE ? OR telefono ILIKE ? OR cedula ILIKE ?)';
      const like = `%${q}%`;
      params.push(like, like, like, like);
    }
    sql += ` ORDER BY nombre, apellido LIMIT ${MAX_LISTADO}`;
    const [rows] = await req.db.query(sql, params);
    res.json({ data: rows });
  } catch (err) {
    fail(res, err);
  }
});

router.post('/', exigirPermiso('clientes.editar'), async (req, res) => {
  try {
    const { nombre, apellido, telefono, email, cedula, direccion } = req.body;
    if (faltante(res, req.body, [['nombre', 'el nombre'], ['apellido', 'el apellido'], ['telefono', 'el teléfono'], ['cedula', 'la cédula']])) return;
    if (!telefonoValido(telefono)) return invalido(res, 'telefono', 'El teléfono no tiene un formato válido');
    if (!cedulaValida(cedula)) return invalido(res, 'cedula', 'La cédula no tiene un formato válido');
    const [result] = await req.db.query(
      'INSERT INTO clientes (tenant_id, nombre, apellido, telefono, email, cedula, direccion) VALUES (@tenant, ?, ?, ?, ?, ?, ?)',
      [nombre, apellido, telefono, email || null, cedula || null, direccion || null]
    );
    const [[nuevo]] = await req.db.query(
      'SELECT * FROM clientes WHERE id = ? AND tenant_id = @tenant', [result.insertId]
    );
    res.status(201).json({ data: nuevo, message: 'Cliente creado' });
  } catch (err) {
    fail(res, err);
  }
});

router.get('/:id', async (req, res) => {
  try {
    const [[cliente]] = await req.db.query(
      `SELECT ${COLS},
              (SELECT COUNT(*) FROM recompensas_canjeadas
                WHERE cliente_id = clientes.id AND tenant_id = @tenant) AS cortesias_canjeadas
       FROM clientes WHERE id = ? AND activo = 1 AND tenant_id = @tenant`,
      [req.params.id]
    );
    if (!cliente) return res.status(404).json({ error: 'Cliente no encontrado' });
    res.json({ data: cliente });
  } catch (err) {
    fail(res, err);
  }
});

// PATCH /api/clientes/:id/cortesia — canjea (consume) la cortesía de fidelización.
// Además del flag, deja un registro en recompensas_canjeadas (historial que ve el cliente).
// Acepta orden_id y descripcion opcionales (la cortesía aplicada a un servicio puntual).
router.patch('/:id/cortesia', exigirPermiso('clientes.editar'), async (req, res) => {
  const conn = await req.db.conexion();
  try {
    await conn.beginTransaction();
    const [[cliente]] = await conn.query(
      'SELECT cortesia_disponible FROM clientes WHERE id = ? AND activo = 1 AND tenant_id = @tenant FOR UPDATE',
      [req.params.id]
    );
    if (!cliente) { await conn.rollback(); return res.status(404).json({ error: 'Cliente no encontrado' }); }
    if (!cliente.cortesia_disponible) { await conn.rollback(); return res.status(400).json({ error: 'El cliente no tiene cortesía disponible' }); }

    await conn.query(
      'UPDATE clientes SET cortesia_disponible = 0 WHERE id = ? AND tenant_id = @tenant',
      [req.params.id]
    );
    await conn.query(
      'INSERT INTO recompensas_canjeadas (tenant_id, cliente_id, orden_id, aplicado_por, descripcion) VALUES (@tenant, ?, ?, ?, ?)',
      [req.params.id, req.body.orden_id || null, req.usuario.id, (req.body.descripcion || 'Servicio de cortesía').slice(0, 150)]
    );
    await conn.commit();
    res.json({ message: 'Cortesía canjeada' });
  } catch (err) {
    await conn.rollback();
    fail(res, err);
  } finally {
    conn.release();
  }
});

// PATCH /api/clientes/:id/portal — activa/define o desactiva el acceso al portal del cliente.
// Sensible (fija contraseñas de acceso): restringido a administración.
router.patch('/:id/portal', requireRol('admin'), async (req, res) => {
  try {
    const { password, activar } = req.body;
    const [[cliente]] = await req.db.query(
      'SELECT id, email FROM clientes WHERE id = ? AND activo = 1 AND tenant_id = @tenant',
      [req.params.id]
    );
    if (!cliente) return res.status(404).json({ error: 'Cliente no encontrado' });

    if (activar === false) {
      await req.db.query(
        'UPDATE clientes SET password_hash = NULL WHERE id = ? AND tenant_id = @tenant',
        [req.params.id]
      );
      return res.json({ message: 'Acceso al portal desactivado' });
    }
    if (!cliente.email) return res.status(400).json({ error: 'El cliente necesita un email para acceder al portal' });
    if (!password || password.length < 6) {
      return invalido(res, 'password', 'La contraseña debe tener al menos 6 caracteres');
    }
    const hash = await bcrypt.hash(password, 10);
    await req.db.query(
      'UPDATE clientes SET password_hash = ? WHERE id = ? AND tenant_id = @tenant',
      [hash, req.params.id]
    );
    res.json({ message: 'Acceso al portal activado' });
  } catch (err) {
    fail(res, err);
  }
});

router.put('/:id', exigirPermiso('clientes.editar'), async (req, res) => {
  try {
    const { nombre, apellido, telefono, email, cedula, direccion } = req.body;
    // Obligatorio igual que al crear: sin esto se podía dar de alta un cliente con
    // teléfono y después dejarlo en blanco al editarlo, y el taller se quedaba sin
    // forma de avisarle que su moto está lista.
    if (!telefono || !String(telefono).trim()) return invalido(res, 'telefono', 'Falta el teléfono');
    if (!telefonoValido(telefono)) return invalido(res, 'telefono', 'El teléfono no tiene un formato válido');
    if (!cedulaValida(cedula)) return invalido(res, 'cedula', 'La cédula no tiene un formato válido');
    await req.db.query(
      'UPDATE clientes SET nombre=?, apellido=?, telefono=?, email=?, cedula=?, direccion=? WHERE id=? AND tenant_id = @tenant',
      [nombre, apellido, telefono, email || null, cedula || null, direccion || null, req.params.id]
    );
    const [[actualizado]] = await req.db.query(
      'SELECT * FROM clientes WHERE id = ? AND tenant_id = @tenant', [req.params.id]
    );
    res.json({ data: actualizado, message: 'Cliente actualizado' });
  } catch (err) {
    fail(res, err);
  }
});

router.get('/:id/vehiculos', async (req, res) => {
  try {
    const [rows] = await req.db.query(
      'SELECT * FROM vehiculos WHERE cliente_id = ? AND activa = 1 AND tenant_id = @tenant ORDER BY created_at DESC',
      [req.params.id]
    );
    res.json({ data: rows });
  } catch (err) {
    fail(res, err);
  }
});

router.get('/:id/ordenes', async (req, res) => {
  try {
    const [rows] = await req.db.query(
      `SELECT ot.*, m.marca, m.modelo, m.placa,
              u.nombre AS tecnico_nombre
       FROM ordenes_trabajo ot
       JOIN vehiculos m ON ot.vehiculo_id = m.id AND m.tenant_id = @tenant
       LEFT JOIN usuarios u ON ot.tecnico_id = u.id AND u.tenant_id = @tenant
       WHERE ot.tenant_id = @tenant AND ot.cliente_id = ?${soloSucursal(req, 'ot.sucursal_id')}
       ORDER BY ot.fecha_ingreso DESC`,
      [req.params.id]
    );
    res.json({ data: rows });
  } catch (err) {
    fail(res, err);
  }
});

// DELETE /:id — saca al cliente del sistema conservando el historial del taller.
//
// TODAS las columnas cliente_id que lo referencian son NOT NULL (motos, citas,
// ordenes_trabajo, notificaciones, recompensas_canjeadas), así que no se puede
// borrar la fila sin arrastrar las órdenes y su facturación. Entonces:
//   • se borran sus datos personales y sus accesos (queda anonimizado),
//   • se desactiva (activo = 0), y como todos los listados filtran activo = 1
//     el cliente desaparece de la app,
//   • las órdenes ya cobradas quedan intactas para la contabilidad.
router.delete('/:id', exigirPermiso('clientes.eliminar'), async (req, res) => {
  const conn = await req.db.conexion();
  try {
    const id = Number(req.params.id);
    const [[cliente]] = await conn.query(
      'SELECT id FROM clientes WHERE id = ? AND activo = 1 AND tenant_id = @tenant', [id]
    );
    if (!cliente) {
      conn.release();
      return res.status(404).json({ error: 'Cliente no encontrado' });
    }

    await conn.beginTransaction();

    // Rastro personal y accesos al portal: se borran de verdad.
    await conn.query('DELETE FROM notificaciones WHERE cliente_id = ? AND tenant_id = @tenant', [id]);
    await conn.query('DELETE FROM password_reset_codes WHERE cliente_id = ? AND tenant_id = @tenant', [id]);
    await conn.query('DELETE FROM login_codes WHERE cliente_id = ? AND tenant_id = @tenant', [id]);
    await conn.query('DELETE FROM email_verify_codes WHERE cliente_id = ? AND tenant_id = @tenant', [id]);

    // Sus motos salen de los listados activos, pero siguen ligadas a las órdenes.
    await conn.query('UPDATE vehiculos SET activa = 0 WHERE cliente_id = ? AND tenant_id = @tenant', [id]);

    // nombre/apellido/telefono son NOT NULL: se reemplazan por un marcador.
    await conn.query(
      `UPDATE clientes SET
         nombre = 'Cliente', apellido = 'eliminado', telefono = '-',
         email = NULL, cedula = NULL, direccion = NULL, foto = NULL,
         password_hash = NULL, email_pendiente = NULL, activo = 0
       WHERE id = ? AND tenant_id = @tenant`,
      [id]
    );

    await conn.commit();
    res.json({ message: 'Cliente eliminado' });
  } catch (err) {
    await conn.rollback().catch(() => {});
    fail(res, err);
  } finally {
    conn.release();
  }
});

module.exports = router;
