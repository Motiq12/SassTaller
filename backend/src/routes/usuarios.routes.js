const router = require('express').Router();
const bcrypt = require('bcrypt');
// Sin `pool`: todo el acceso pasa por req.db, scopeado al taller.
const { fail, invalido, faltante } = require('../utils/responder');
const { registrarEvento } = require('../utils/eventos-seguridad');
const auth = require('../middleware/auth');
const requireRol = require('../middleware/roles');
const { emailValido } = require('../utils/validar');
const { sucursalValida } = require('../utils/sucursales');
const { normalizarPermisos, PERMISOS_WEB } = require('../utils/permisos-web');
const { ROL_DE_BASE, BASES_PROPIAS } = require('../utils/permisos');
const { getConfig } = require('../utils/configuracion');
const { politica, problemaDeContrasena } = require('../utils/contrasena');
const { olvidar, cerrarSesiones } = require('../utils/sesiones');
const { topeAlcanzado } = require('../utils/cuenta');

router.use(auth, requireRol('admin'));

// Normaliza el sucursal_id del body: id válido (activo) o null = "atiende ambas".
async function sucursalDelBody(db, valor) {
  return (await sucursalValida(db, valor)) ? Number(valor) : null;
}

// Roles válidos del personal (debe coincidir con el ENUM de la tabla usuarios).
// `contenido`: solo administra el sitio web, con los permisos que le marque el admin.
const ROLES = ['recepcion', 'tecnico', 'admin', 'contenido'];

// Permisos del sitio web tal como se guardan. El admin puede todo sin marcar nada,
// así que para él no se guarda nada; para el resto, solo los permisos conocidos.
function permisosParaGuardar(rol, valor) {
  if (rol === 'admin') return null;
  const limpio = normalizarPermisos(valor);
  return Object.keys(limpio).length ? JSON.stringify(limpio) : null;
}
// El rol propio que se le asigna (Equipo → Roles). `valor` es el id de un rol de la
// tabla roles, o vacío para el de fábrica de su rol. Un rol propio decide también el
// rol del sistema (la pantalla que usa): uno de Mostrador es 'recepcion' y uno de
// Taller es 'tecnico'. Devuelve { rol, rol_id } o { error }.
async function rolDelBody(db, rol, valor) {
  if (valor === undefined || valor === null || valor === '' || Number(valor) === 0) return { rol, rol_id: null };
  const [[r]] = await db.query('SELECT id, clave, base, de_fabrica FROM roles WHERE id = ? AND tenant_id = @tenant', [Number(valor) || 0]);
  if (!r) return { error: 'Ese rol ya no existe' };
  // Uno de fábrica es lo mismo que no tener rol propio.
  if (r.de_fabrica) return { rol: ROL_DE_BASE[r.base] || rol, rol_id: null };
  if (!BASES_PROPIAS.includes(r.base)) return { error: 'Rol no válido' };
  return { rol: ROL_DE_BASE[r.base], rol_id: r.id };
}

// La fila tal como la ve el panel: permisos_web como objeto, nunca como texto.
const conPermisos = (u) => (u ? { ...u, permisos_web: normalizarPermisos(u.permisos_web) } : u);

// GET /permisos-web — la lista de casillas que el panel ofrece al dar permisos.
router.get('/permisos-web', (req, res) => {
  res.json({ data: PERMISOS_WEB });
});

router.get('/', async (req, res) => {
  try {
    const [rows] = await req.db.query(
      `SELECT u.id, u.nombre, u.email, u.telefono, u.rol, u.activo, u.created_at,
              u.sucursal_id, s.nombre AS sucursal_nombre, u.permisos_web,
              u.rol_id, r.nombre AS rol_nombre
       FROM usuarios u
       LEFT JOIN sucursales s ON s.id = u.sucursal_id AND s.tenant_id = @tenant
       LEFT JOIN roles r ON r.id = u.rol_id AND r.de_fabrica = 0 AND r.tenant_id = @tenant
       WHERE u.tenant_id = @tenant
       ORDER BY u.nombre`
    );
    res.json({ data: rows.map(conPermisos) });
  } catch (err) {
    fail(res, err);
  }
});

router.post('/', async (req, res) => {
  try {
    const { nombre, email, password, rol, telefono } = req.body;
    if (faltante(res, req.body, [['nombre', 'el nombre'], ['email', 'el correo'], ['password', 'la contraseña'], ['rol', 'el rol']])) return;
    if (!emailValido(email)) return invalido(res, 'email', 'El correo no tiene un formato válido');
    // La política de Configuración → Seguridad (utils/contrasena.js).
    const malaClave = problemaDeContrasena(password, politica(await getConfig(req.db)), { email, nombre });
    if (malaClave) return invalido(res, 'password', malaClave);
    if (!ROLES.includes(rol)) return invalido(res, 'rol', 'Rol no válido');
    const elegido = await rolDelBody(req.db, rol, req.body.rol_id);
    if (elegido.error) return invalido(res, 'rol', elegido.error);

    // Tope del plan. Se comprueba antes del hash: bcrypt cuesta ~100ms y no tiene
    // sentido pagarlos para después rechazar el alta. El 402 distingue "tu plan no
    // llega" de un 403 de permisos — quien está acá es admin y tiene todo el derecho,
    // lo que falta es plan, y el frontend lo trata distinto por eso.
    const tope = await topeAlcanzado(req.db, 'usuarios');
    if (tope) return res.status(402).json({ error: tope, tope: 'usuarios' });

    const hash = await bcrypt.hash(password, 10);
    const sucursal_id = await sucursalDelBody(req.db, req.body.sucursal_id);
    const [result] = await req.db.query(
      'INSERT INTO usuarios (tenant_id, nombre, email, password_hash, rol, rol_id, telefono, sucursal_id, permisos_web) VALUES (@tenant, ?, ?, ?, ?, ?, ?, ?, ?)',
      [nombre, email, hash, elegido.rol, elegido.rol_id, telefono || null, sucursal_id, permisosParaGuardar(elegido.rol, req.body.permisos_web)]
    );
    const [[nuevo]] = await req.db.query(
      'SELECT id, nombre, email, telefono, rol, rol_id, activo, created_at, sucursal_id, permisos_web FROM usuarios WHERE id = ? AND tenant_id = @tenant',
      [result.insertId]
    );
    registrarEvento('usuario_creado', { ip: req.ip, usuarioId: nuevo.id, actorId: req.usuario.id, detalle: `Rol: ${nuevo.rol}` });
    res.status(201).json({ data: conPermisos(nuevo), message: 'Usuario creado' });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return invalido(res, 'email', 'Ese correo ya está registrado', 409);
    fail(res, err);
  }
});

router.put('/:id', async (req, res) => {
  let conn;
  try {
    const { nombre, email, telefono } = req.body;
    if (faltante(res, req.body, [['nombre', 'el nombre'], ['email', 'el correo'], ['rol', 'el rol']])) return;
    if (!emailValido(email)) return invalido(res, 'email', 'El correo no tiene un formato válido');
    if (!ROLES.includes(req.body.rol)) return invalido(res, 'rol', 'Rol no válido');
    // rol_id es opcional en el PUT: si no viene, se conserva el rol propio mientras siga
    // siendo de la misma parte del sistema que el rol nuevo.
    let rolIdPedido = req.body.rol_id;
    if (!('rol_id' in req.body)) {
      const [[actual]] = await req.db.query(
        'SELECT u.rol_id, r.base FROM usuarios u LEFT JOIN roles r ON r.id = u.rol_id AND r.tenant_id = @tenant WHERE u.id = ? AND u.tenant_id = @tenant',
        [req.params.id]
      );
      rolIdPedido = actual && actual.rol_id && ROL_DE_BASE[actual.base] === req.body.rol ? actual.rol_id : null;
    }
    const elegido = await rolDelBody(req.db, req.body.rol, rolIdPedido);
    if (elegido.error) return invalido(res, 'rol', elegido.error);
    const rol = elegido.rol;
    // Anti-lockout: el admin logueado no puede quitarse a sí mismo el rol admin.
    if (Number(req.params.id) === req.usuario.id && rol !== 'admin') {
      return invalido(res, 'rol', 'No podés cambiar tu propio rol de administrador');
    }
    const sucursal_id = await sucursalDelBody(req.db, req.body.sucursal_id);
    conn = await req.db.conexion();
    await conn.beginTransaction();
    const [[antes]] = await conn.query('SELECT rol, rol_id, sucursal_id, permisos_web FROM usuarios WHERE id = ? AND tenant_id = @tenant FOR UPDATE', [req.params.id]);
    if (!antes) {
      await conn.rollback();
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }
    // permisos_web es opcional en el PUT: si el formulario no lo manda, se conservan.
    const camposPermisos = 'permisos_web' in req.body ? ', permisos_web=?' : '';
    const valores = [nombre, email, rol, elegido.rol_id, telefono ?? null, sucursal_id];
    if (camposPermisos) valores.push(permisosParaGuardar(rol, req.body.permisos_web));
    await conn.query(
      `UPDATE usuarios SET nombre=?, email=?, rol=?, rol_id=?, telefono=?, sucursal_id=?${camposPermisos} WHERE id=? AND tenant_id = @tenant`,
      [...valores, req.params.id]
    );
    const [[actualizado]] = await conn.query(
      'SELECT id, nombre, email, telefono, rol, rol_id, activo, created_at, sucursal_id, permisos_web FROM usuarios WHERE id = ? AND tenant_id = @tenant',
      [req.params.id]
    );
    const permisos = (v) => JSON.stringify(Object.entries(normalizarPermisos(v)).sort(([a], [b]) => a.localeCompare(b)));
    if (antes.rol !== actualizado.rol || (antes.rol_id || null) !== (actualizado.rol_id || null)
        || (antes.sucursal_id || null) !== (actualizado.sucursal_id || null)
        || permisos(antes.permisos_web) !== permisos(actualizado.permisos_web)) {
      await cerrarSesiones([actualizado.id], conn);
    }
    await conn.commit();
    if (antes && actualizado && (antes.rol !== actualizado.rol || (antes.rol_id || null) !== (actualizado.rol_id || null))) {
      registrarEvento('rol_cambiado', { ip: req.ip, usuarioId: actualizado.id, actorId: req.usuario.id, detalle: `${antes.rol} → ${actualizado.rol}` });
    }
    res.json({ data: conPermisos(actualizado), message: 'Usuario actualizado' });
  } catch (err) {
    if (conn) await conn.rollback().catch(() => {});
    fail(res, err);
  } finally {
    if (conn) conn.release();
  }
});

router.patch('/:id/activo', async (req, res) => {
  try {
    const { activo } = req.body;
    // Anti-lockout: el admin logueado no puede desactivarse a sí mismo.
    if (Number(req.params.id) === req.usuario.id && !activo) {
      return res.status(400).json({ error: 'No podés desactivar tu propia cuenta' });
    }
    // Reactivar suma un usuario igual que darlo de alta, así que choca con el mismo
    // tope. Sin esto el tope del plan gratis se esquivaba en dos clics: desactivar a
    // uno, crear otro, y volver a activar al primero. Solo se mira cuando de verdad
    // pasa de inactivo a activo: re-activar a alguien ya activo no suma nada.
    if (activo) {
      const [[u]] = await req.db.query('SELECT activo FROM usuarios WHERE tenant_id = @tenant AND id = ?', [req.params.id]);
      if (!u) return res.status(404).json({ error: 'Usuario no encontrado' });
      if (!u.activo) {
        const tope = await topeAlcanzado(req.db, 'usuarios');
        if (tope) return res.status(402).json({ error: tope, tope: 'usuarios' });
      }
    }
    // Desactivar sube la versión de credenciales (QA34-02): una sesión que un login en
    // curso abra después no vuelve a valer cuando se reactive la cuenta.
    const nuevo = activo ? 1 : 0;
    const [hecho] = await req.db.query(
      'UPDATE usuarios SET activo = ?, credenciales_version = credenciales_version + (1 - ?) WHERE id = ? AND tenant_id = @tenant',
      [nuevo, nuevo, req.params.id]
    );
    if (!hecho.affectedRows) return res.status(404).json({ error: 'Usuario no encontrado' });
    olvidar(req.params.id); // desactivado: deja de entrar en el próximo pedido
    registrarEvento(activo ? 'usuario_activado' : 'usuario_desactivado', { ip: req.ip, usuarioId: Number(req.params.id), actorId: req.usuario.id });
    res.json({ message: activo ? 'Usuario activado' : 'Usuario desactivado' });
  } catch (err) {
    fail(res, err);
  }
});

// PATCH /:id/sucursal — cambia el local de un empleado desde la lista (null = Ambas).
router.patch('/:id/sucursal', async (req, res) => {
  let conn;
  try {
    const sucursal_id = await sucursalDelBody(req.db, req.body.sucursal_id);
    conn = await req.db.conexion();
    await conn.beginTransaction();
    const [[antes]] = await conn.query('SELECT sucursal_id FROM usuarios WHERE id = ? AND tenant_id = @tenant FOR UPDATE', [req.params.id]);
    if (!antes) {
      await conn.rollback();
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }
    await conn.query('UPDATE usuarios SET sucursal_id = ? WHERE id = ? AND tenant_id = @tenant', [sucursal_id, req.params.id]);
    if ((antes.sucursal_id || null) !== sucursal_id) await cerrarSesiones([req.params.id], conn);
    await conn.commit();
    res.json({ data: { sucursal_id }, message: 'Sucursal actualizada' });
  } catch (err) {
    if (conn) await conn.rollback().catch(() => {});
    fail(res, err);
  } finally {
    if (conn) conn.release();
  }
});

// DELETE /:id — elimina un empleado DEFINITIVAMENTE, tenga historial o no.
//
// `usuarios` está referenciado por 10 claves foráneas, así que un DELETE pelado
// fallaría. Se limpia en una transacción, distinguiendo dos casos:
//
//   • Rastro PERSONAL del empleado (columnas NOT NULL, no se pueden desvincular):
//     sus avances escritos, sus tareas y sus mensajes internos → se BORRAN.
//   • Trabajo del TALLER (columnas que aceptan NULL): citas, órdenes, garantías,
//     tareas que él asignó y cortesías aplicadas → se DESVINCULAN (quedan sin
//     responsable). No se borran: son el historial del negocio y la facturación
//     del cliente; eliminarlos destruiría datos contables ajenos al empleado.
router.delete('/:id', async (req, res) => {
  const conn = await req.db.conexion();
  try {
    const id = Number(req.params.id);
    // Anti-lockout: nadie se borra a sí mismo (quedaría sin acceso al sistema).
    if (id === req.usuario.id) {
      conn.release();
      return res.status(400).json({ error: 'No podés eliminar tu propia cuenta' });
    }
    const [[usuario]] = await conn.query('SELECT id, nombre, email, rol FROM usuarios WHERE id = ? AND tenant_id = @tenant', [id]);
    if (!usuario) {
      conn.release();
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    await conn.beginTransaction();

    // 1) Rastro personal (NOT NULL → hay que borrar la fila).
    await conn.query('DELETE FROM orden_avances WHERE usuario_id = ? AND tenant_id = @tenant', [id]);
    await conn.query('DELETE FROM tareas_mecanico WHERE tecnico_id = ? AND tenant_id = @tenant', [id]);
    await conn.query('DELETE FROM mensaje_lecturas WHERE usuario_id = ? AND tenant_id = @tenant', [id]);
    await conn.query('DELETE FROM mensajes_internos WHERE (remitente_id = ? OR destino_id = ?) AND tenant_id = @tenant', [id, id]);

    // 2) Trabajo del taller: se conserva, sin responsable.
    await conn.query('UPDATE citas SET usuario_id = NULL WHERE usuario_id = ? AND tenant_id = @tenant', [id]);
    await conn.query('UPDATE citas SET tecnico_id = NULL WHERE tecnico_id = ? AND tenant_id = @tenant', [id]);
    await conn.query('UPDATE ordenes_trabajo SET recepcionista_id = NULL WHERE recepcionista_id = ? AND tenant_id = @tenant', [id]);
    await conn.query('UPDATE ordenes_trabajo SET tecnico_id = NULL WHERE tecnico_id = ? AND tenant_id = @tenant', [id]);
    await conn.query('UPDATE garantias SET creado_por = NULL WHERE creado_por = ? AND tenant_id = @tenant', [id]);
    await conn.query('UPDATE tareas_mecanico SET asignado_por = NULL WHERE asignado_por = ? AND tenant_id = @tenant', [id]);
    await conn.query('UPDATE recompensas_canjeadas SET aplicado_por = NULL WHERE aplicado_por = ? AND tenant_id = @tenant', [id]);

    await conn.query('DELETE FROM usuarios WHERE id = ? AND tenant_id = @tenant', [id]);
    await conn.commit();
    // Ya no existe: el nombre va en el detalle (usuario_id quedaría apuntando a nadie).
    registrarEvento('usuario_eliminado', { ip: req.ip, actorId: req.usuario.id, detalle: `${usuario.nombre} (${usuario.email}) · ${usuario.rol}` });
    res.json({ message: 'Empleado eliminado' });
  } catch (err) {
    await conn.rollback().catch(() => {});
    // Si quedó alguna referencia sin contemplar, el mensaje explica qué pasó
    // (y nada se borró a medias: la transacción se revirtió entera).
    if (err.code === 'ER_ROW_IS_REFERENCED_2' || err.code === 'ER_ROW_IS_REFERENCED') {
      return res.status(409).json({ error: 'No se pudo eliminar: al empleado le quedan registros asociados. Avisá para revisarlo.' });
    }
    fail(res, err);
  } finally {
    conn.release();
  }
});

module.exports = router;
