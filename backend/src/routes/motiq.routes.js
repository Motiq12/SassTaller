const router = require('express').Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
// Administración de Motiq: el trabajo de estas rutas es mirar A TRAVÉS de todos los
// talleres, así que van contra el pool sin scope a propósito. Es lo contrario del
// resto del sistema, donde cada consulta se acota a un taller — por eso vive en un
// archivo aparte, con su propio middleware, y no mezclado con las rutas de taller.
const { pool } = require('../db/pool');
const { fail } = require('../utils/responder');
const { emailValido } = require('../utils/validar');
const { consumir } = require('../utils/rate-limit');
const authPlataforma = require('../middleware/auth-plataforma');
const { fijarEstado, fijarPlan } = require('../utils/estado-tenant');
// Los planes se declaran en utils/limites junto con lo que incluye cada uno: tener acá
// una segunda lista sería la forma de que un día acepte un plan que no tiene límites
// definidos, y ese taller quedaría sin topes sin que nadie lo decidiera.
const { PLANES, fijarLimites } = require('../utils/limites');
const { crearTaller, normalizarSlug, motivoSlugInvalido } = require('../utils/onboarding');
const { generarPassword } = require('../utils/password');
const { ordenDeBorrado } = require('../utils/orden-borrado');
const { TABLAS_CON_TENANT } = require('../db/tenant-db');
const { anotar } = require('../utils/bitacora');

const ESTADOS = ['activo', 'suspendido', 'cancelado'];
const TIPOS_AVISO = ['info', 'mantenimiento', 'urgente'];

// POST /api/motiq/login — sesión de administración de la plataforma.
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email y contraseña requeridos' });

    // Más estricto que el login de talleres: acá una sola cuenta comprometida abre
    // los datos de TODOS los clientes del SaaS.
    const limite = consumir(`motiq:${String(email).trim().toLowerCase()}`, { porMinuto: 5, porHora: 20 });
    if (!limite.ok) {
      return res.status(429).json({ error: `Demasiados intentos. Esperá ${limite.retryAfter}s.` });
    }

    const [[admin]] = await pool.query(
      'SELECT id, nombre, email, password_hash FROM plataforma_admins WHERE email = ? AND activo = 1',
      [String(email).trim().toLowerCase()]
    );
    if (!admin || !(await bcrypt.compare(password, admin.password_hash))) {
      return res.status(401).json({ error: 'Credenciales incorrectas' });
    }

    await pool.query('UPDATE plataforma_admins SET ultimo_acceso = NOW() WHERE id = ?', [admin.id]);

    // Sin `rol` ni `tenant_id`: middleware/auth exige rol y rechaza este tipo, así
    // que este token no sirve para entrar a ningún taller.
    const payload = { id: admin.id, tipo: 'plataforma', nombre: admin.nombre, email: admin.email };
    const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '8h' });
    res.json({ data: { token, admin: payload } });
  } catch (err) {
    fail(res, err);
  }
});

// POST /api/motiq/contacto — "Hablá con nosotros" de la landing. PÚBLICO.
//
// Va antes del authPlataforma de abajo a propósito: quien escribe todavía no es
// cliente ni tiene cuenta, es justamente alguien de afuera preguntando. Es el único
// endpoint de este archivo que no exige sesión, y por eso lleva su propio límite.
router.post('/contacto', async (req, res) => {
  try {
    const { nombre, email, telefono, empresa, volumen, mensaje, origen } = req.body;
    const correo = String(email || '').trim().toLowerCase();

    if (!String(nombre || '').trim()) return res.status(400).json({ error: 'Falta tu nombre' });
    if (!emailValido(correo)) return res.status(400).json({ error: 'El correo no parece válido' });

    // Un formulario público abierto se llena de basura automática en cuestión de días.
    // El límite es por IP y generoso para una persona real: nadie pide tres demos.
    const limite = consumir(`contacto:${req.ip}`, { porMinuto: 2, porHora: 6 });
    if (!limite.ok) {
      return res.status(429).json({ error: 'Ya recibimos tu mensaje. Te escribimos pronto.' });
    }

    // Si el mismo correo ya escribió y todavía no lo atendieron, se actualiza en vez
    // de duplicar: quien insiste porque no le contestaron no debería aparecer tres
    // veces en la bandeja y hacer parecer que hay tres clientes.
    const [[previo]] = await pool.query(
      `SELECT id FROM contactos_demo WHERE email = ? AND estado = 'nuevo' LIMIT 1`, [correo]
    );

    const datos = [
      String(nombre).trim().slice(0, 120),
      correo,
      String(telefono || '').trim().slice(0, 40) || null,
      String(empresa || '').trim().slice(0, 150) || null,
      String(volumen || '').trim().slice(0, 40) || null,
      String(mensaje || '').trim().slice(0, 2000) || null,
      String(origen || '').trim().slice(0, 80) || null,
    ];

    if (previo) {
      await pool.query(
        `UPDATE contactos_demo
            SET nombre = ?, email = ?, telefono = ?, empresa = ?, volumen = ?, mensaje = ?, origen = ?
          WHERE id = ?`,
        [...datos, previo.id]
      );
    } else {
      await pool.query(
        `INSERT INTO contactos_demo (nombre, email, telefono, empresa, volumen, mensaje, origen)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        datos
      );
    }

    res.status(201).json({ message: 'Recibimos tu mensaje. Te contactamos en menos de un día hábil.' });
  } catch (err) {
    fail(res, err);
  }
});

router.use(authPlataforma);

// GET /api/motiq/contactos?estado= — la bandeja de quienes pidieron una demo.
router.get('/contactos', async (req, res) => {
  try {
    const ESTADOS_C = ['nuevo', 'contactado', 'cerrado', 'descartado'];
    const where = ESTADOS_C.includes(req.query.estado) ? 'WHERE estado = ?' : '';
    const [filas] = await pool.query(
      `SELECT id, nombre, email, telefono, empresa, volumen, mensaje, estado, nota_interna, origen, created_at
         FROM contactos_demo ${where}
        ORDER BY estado = 'nuevo' DESC, created_at DESC
        LIMIT 200`,
      where ? [req.query.estado] : []
    );
    res.json({ data: filas });
  } catch (err) {
    fail(res, err);
  }
});

// PATCH /api/motiq/contactos/:id — mover en el embudo y anotar qué pasó.
router.patch('/contactos/:id', async (req, res) => {
  try {
    const ESTADOS_C = ['nuevo', 'contactado', 'cerrado', 'descartado'];
    const { estado, nota_interna } = req.body;
    if (!ESTADOS_C.includes(estado)) {
      return res.status(400).json({ error: `Estado inválido (${ESTADOS_C.join(', ')})` });
    }
    const [r] = await pool.query(
      'UPDATE contactos_demo SET estado = ?, nota_interna = ? WHERE id = ?',
      [estado, String(nota_interna || '').trim().slice(0, 500) || null, req.params.id]
    );
    if (!r.affectedRows) return res.status(404).json({ error: 'Contacto no encontrado' });
    // Que el otro vea que este contacto ya lo atendió alguien, y no lo llame de nuevo.
    anotar(req.plataforma, 'atendio_contacto', { detalle: `${estado}` });
    res.json({ message: 'Contacto actualizado' });
  } catch (err) {
    fail(res, err);
  }
});

// POST /api/motiq/contactos/:id/taller — cerrar la venta: crear el taller desde el
// contacto que pidió la demo.
//
// Es el paso que faltaba del embudo. Sin esto, cerrar con un cliente grande significaba
// pedirle que se registrara solo en la misma pantalla pública del taller de un mecánico
// —después de haber hablado por teléfono— o hacerle el alta a mano en MySQL.
router.post('/contactos/:id/taller', async (req, res) => {
  let conn;
  try {
    const [[contacto]] = await pool.query('SELECT * FROM contactos_demo WHERE id = ?', [req.params.id]);
    if (!contacto) return res.status(404).json({ error: 'Contacto no encontrado' });

    // El nombre del taller sale de lo que escribió en "Empresa", pero se puede corregir:
    // lo que dictó por teléfono suele ser más preciso que lo que tipeó apurado.
    const nombre = String(req.body.nombre || contacto.empresa || '').trim();
    if (!nombre) return res.status(400).json({ error: 'Falta el nombre del taller' });

    const slug = normalizarSlug(req.body.slug || nombre);
    const motivo = motivoSlugInvalido(slug);
    if (motivo) return res.status(400).json({ error: motivo });

    const plan = PLANES.includes(req.body.plan) ? req.body.plan : 'pro';

    conn = await pool.getConnection();
    await conn.beginTransaction();

    const [[tomado]] = await conn.query('SELECT id FROM tenants WHERE slug = ? FOR UPDATE', [slug]);
    if (tomado) {
      await conn.rollback();
      return res.status(409).json({ error: 'Ese identificador ya está en uso' });
    }

    // La contraseña se genera y se muestra una sola vez: elegirla nosotros por el
    // cliente termina en un "Taller2026" que nadie cambia nunca.
    const password = generarPassword();
    const { tenantId, tipos } = await crearTaller(conn, {
      nombre, slug, plan,
      admin: { nombre: contacto.nombre, email: contacto.email, password, telefono: contacto.telefono },
      tipos: req.body.tipos,
      contacto: { telefono: contacto.telefono, email: contacto.email },
    });

    // El contacto queda cerrado en el mismo movimiento: si esto fuera un paso aparte,
    // el lead atendido seguiría figurando como pendiente en la bandeja.
    await conn.query(
      `UPDATE contactos_demo SET estado = 'cerrado',
              nota_interna = COALESCE(nota_interna, '') || ?
        WHERE id = ?`,
      [`\nTaller creado: ${slug} (plan ${plan}).`, contacto.id]
    );

    await conn.commit();

    res.status(201).json({
      data: {
        taller: { id: tenantId, nombre, slug, plan, tipos },
        // Se devuelve para dictársela al cliente. No queda guardada en ningún lado.
        admin: { email: contacto.email, password },
      },
      message: 'Taller creado. Guardá la contraseña: no se vuelve a mostrar.',
    });
  } catch (err) {
    if (conn) await conn.rollback().catch(() => {});
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Ese identificador o correo ya está en uso' });
    }
    fail(res, err);
  } finally {
    if (conn) conn.release();
  }
});

// ───────────── Reportes de falla ─────────────
// Lo que el personal de un taller manda desde su panel cuando algo no funciona (ver
// routes/reportes.routes.js, del lado del staff). Al revés de los avisos: esto entra
// a Motiq en vez de salir de Motiq.
const ESTADOS_REPORTE = ['nuevo', 'revisando', 'resuelto', 'descartado'];

// GET /api/motiq/reportes?estado= — la bandeja de fallas reportadas.
router.get('/reportes', async (req, res) => {
  try {
    const where = ESTADOS_REPORTE.includes(req.query.estado) ? 'WHERE estado = ?' : '';
    const [filas] = await pool.query(
      `SELECT id, tenant_id, tenant_nombre, tenant_slug, usuario_nombre, usuario_email, usuario_rol,
              descripcion, pantalla, estado, nota_interna, created_at
         FROM reportes_falla ${where}
        ORDER BY estado = 'nuevo' DESC, created_at DESC
        LIMIT 200`,
      where ? [req.query.estado] : []
    );
    res.json({ data: filas });
  } catch (err) {
    fail(res, err);
  }
});

// PATCH /api/motiq/reportes/:id — mover en el embudo y anotar qué se hizo.
router.patch('/reportes/:id', async (req, res) => {
  try {
    const { estado, nota_interna } = req.body;
    if (!ESTADOS_REPORTE.includes(estado)) {
      return res.status(400).json({ error: `Estado inválido (${ESTADOS_REPORTE.join(', ')})` });
    }
    const [r] = await pool.query(
      'UPDATE reportes_falla SET estado = ?, nota_interna = ? WHERE id = ?',
      [estado, String(nota_interna || '').trim().slice(0, 500) || null, req.params.id]
    );
    if (!r.affectedRows) return res.status(404).json({ error: 'Reporte no encontrado' });
    anotar(req.plataforma, 'atendio_reporte', { detalle: `#${req.params.id}: ${estado}` });
    res.json({ message: 'Reporte actualizado' });
  } catch (err) {
    fail(res, err);
  }
});

// GET /api/motiq/resumen — el estado del negocio de un vistazo.
router.get('/resumen', async (req, res) => {
  try {
    const [[t]] = await pool.query(
      `SELECT COUNT(*) AS total,
              COUNT(*) FILTER (WHERE estado = 'activo')      AS activos,
              COUNT(*) FILTER (WHERE estado = 'suspendido')  AS suspendidos,
              COUNT(*) FILTER (WHERE plan = 'trial')         AS en_prueba,
              COUNT(*) FILTER (WHERE plan = 'gratis')        AS en_gratis,
              COUNT(*) FILTER (WHERE plan = 'pro')           AS en_pro,
              COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days') AS nuevos_30d
       FROM tenants`
    );
    // Uso agregado de la plataforma: sirve para dimensionar la infraestructura y
    // para saber si un taller que paga realmente la está usando.
    const [[uso]] = await pool.query(
      `SELECT (SELECT COUNT(*) FROM usuarios)        AS usuarios,
              (SELECT COUNT(*) FROM clientes)        AS clientes,
              (SELECT COUNT(*) FROM vehiculos)       AS vehiculos,
              (SELECT COUNT(*) FROM ordenes_trabajo) AS ordenes`
    );
    // Cuántos pidieron una demo y nadie atendió todavía. Es lo que hay que mirar
    // primero al abrir el panel: un contacto sin responder se enfría rápido.
    const [[c]] = await pool.query(
      `SELECT COUNT(*) AS sin_atender FROM contactos_demo WHERE estado = 'nuevo'`
    );
    // Altas por mes. Un total acumulado no dice si el negocio crece o está plano:
    // "47 talleres" se ve igual con 20 altas este mes que con ninguna.
    const [altas] = await pool.query(
      `SELECT to_char(created_at, 'YYYY-MM') AS mes, COUNT(*) AS talleres
         FROM tenants
        WHERE created_at >= (CURRENT_DATE - INTERVAL '6 months')
        GROUP BY mes ORDER BY mes`
    );

    // Los dos números por los que se llama a alguien: a quién se le acaba la prueba
    // y quién dejó de usar el sistema. Sin esto hay que salir a buscarlos a mano.
    const [[alertas]] = await pool.query(
      `SELECT
         (SELECT COUNT(*) FROM tenants
           WHERE plan = 'trial' AND estado = 'activo' AND trial_hasta IS NOT NULL
             AND trial_hasta BETWEEN CURRENT_DATE AND (CURRENT_DATE + INTERVAL '7 days')) AS vencen_semana,
         (SELECT COUNT(*) FROM tenants t
           WHERE t.estado = 'activo'
             AND NOT EXISTS (SELECT 1 FROM ordenes_trabajo o
                              WHERE o.tenant_id = t.id
                                AND o.created_at >= (NOW() - INTERVAL '30 days'))) AS inactivos,
         (SELECT COUNT(*) FROM reportes_falla WHERE estado = 'nuevo') AS reportes_nuevos`
    );

    res.json({ data: { talleres: t, uso, contactos: c, altas, alertas } });
  } catch (err) {
    fail(res, err);
  }
});

// GET /api/motiq/vencimientos?dias=7 — a quién se le acaba la prueba.
//
// Es la lista de llamadas del día. Va con el correo y el teléfono del dueño porque el
// paso siguiente después de mirarla es escribirle, y buscar ese dato en otra pantalla
// es lo que hace que la llamada no ocurra.
router.get('/vencimientos', async (req, res) => {
  try {
    const dias = Math.min(Math.max(Number(req.query.dias) || 7, 1), 90);
    const [filas] = await pool.query(
      `SELECT t.id, t.nombre, t.slug, t.plan, t.estado, t.trial_hasta,
              (t.trial_hasta::date - CURRENT_DATE::date) AS dias_restantes,
              (SELECT u.nombre   FROM usuarios u WHERE u.tenant_id = t.id AND u.rol = 'admin' AND u.activo = 1 ORDER BY u.id LIMIT 1) AS admin_nombre,
              (SELECT u.email    FROM usuarios u WHERE u.tenant_id = t.id AND u.rol = 'admin' AND u.activo = 1 ORDER BY u.id LIMIT 1) AS admin_email,
              (SELECT u.telefono FROM usuarios u WHERE u.tenant_id = t.id AND u.rol = 'admin' AND u.activo = 1 ORDER BY u.id LIMIT 1) AS admin_telefono,
              (SELECT COUNT(*) FROM ordenes_trabajo o WHERE o.tenant_id = t.id) AS ordenes
         FROM tenants t
        WHERE t.plan = 'trial' AND t.estado = 'activo' AND t.trial_hasta IS NOT NULL
          AND t.trial_hasta <= (CURRENT_DATE + ?::int * INTERVAL '1 day')
        ORDER BY t.trial_hasta`,
      [dias]
    );
    res.json({ data: filas });
  } catch (err) {
    fail(res, err);
  }
});

// GET /api/motiq/inactivos?dias=30 — los que se están yendo sin avisar.
//
// Se separa "nunca arrancó" de "dejó de usarlo": son dos problemas distintos. Al
// primero le falló el arranque y hay que ayudarlo a cargar sus datos; el segundo ya
// sabía usarlo y algo lo hizo parar, que es una conversación completamente otra.
router.get('/inactivos', async (req, res) => {
  try {
    const dias = Math.min(Math.max(Number(req.query.dias) || 30, 1), 365);
    const [filas] = await pool.query(
      `SELECT t.id, t.nombre, t.slug, t.plan, t.created_at,
              (SELECT MAX(o.created_at) FROM ordenes_trabajo o WHERE o.tenant_id = t.id) AS ultima_orden,
              (SELECT COUNT(*) FROM ordenes_trabajo o WHERE o.tenant_id = t.id) AS ordenes,
              (SELECT u.email FROM usuarios u WHERE u.tenant_id = t.id AND u.rol = 'admin' AND u.activo = 1 ORDER BY u.id LIMIT 1) AS admin_email
         FROM tenants t
        WHERE t.estado = 'activo'
          AND NOT EXISTS (SELECT 1 FROM ordenes_trabajo o
                           WHERE o.tenant_id = t.id AND o.created_at >= (NOW() - ?::int * INTERVAL '1 day'))
        ORDER BY t.created_at DESC`,
      [dias]
    );
    res.json({ data: filas });
  } catch (err) {
    fail(res, err);
  }
});

// GET /api/motiq/talleres/:id — la ficha completa de un taller.
//
// Es lo que hay que tener delante cuando uno de ellos llama. Trae su gente, sus
// sucursales y su actividad; NO trae sus datos de operación (clientes, vehículos,
// órdenes con nombre y apellido). Ver cuántas órdenes lleva es administrar el SaaS;
// leer quiénes son sus clientes es meterse en el negocio de otro.
router.get('/talleres/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const [[taller]] = await pool.query(
      `SELECT t.id, t.nombre, t.slug, t.plan, t.estado, t.motivo_estado, t.trial_hasta,
              t.created_at, (t.trial_hasta::date - CURRENT_DATE::date) AS dias_restantes,
              c.nombre_taller, c.telefono, c.email, c.direccion, c.tipos_vehiculo,
              (c.logo IS NOT NULL)::int AS tiene_logo, c.color_primario
         FROM tenants t
         LEFT JOIN configuracion c ON c.tenant_id = t.id
        WHERE t.id = ?`,
      [id]
    );
    if (!taller) return res.status(404).json({ error: 'Taller no encontrado' });

    const [usuarios] = await pool.query(
      `SELECT id, nombre, email, rol, telefono, activo, email_verificado, created_at
         FROM usuarios WHERE tenant_id = ? ORDER BY rol = 'admin' DESC, nombre`,
      [id]
    );
    const [sucursales] = await pool.query(
      'SELECT id, nombre, direccion, telefono, activa FROM sucursales WHERE tenant_id = ? ORDER BY orden',
      [id]
    );
    const [[uso]] = await pool.query(
      `SELECT (SELECT COUNT(*) FROM clientes        WHERE tenant_id = ?) AS clientes,
              (SELECT COUNT(*) FROM vehiculos       WHERE tenant_id = ?) AS vehiculos,
              (SELECT COUNT(*) FROM ordenes_trabajo WHERE tenant_id = ?) AS ordenes,
              (SELECT COUNT(*) FROM citas           WHERE tenant_id = ?) AS citas,
              (SELECT MAX(created_at) FROM ordenes_trabajo WHERE tenant_id = ?) AS ultima_orden,
              (SELECT COUNT(*) FROM ordenes_trabajo
                WHERE tenant_id = ? AND created_at >= (NOW() - INTERVAL '30 days')) AS ordenes_30d`,
      [id, id, id, id, id, id]
    );

    res.json({ data: { taller, usuarios, sucursales, uso } });
  } catch (err) {
    fail(res, err);
  }
});

// GET /api/motiq/talleres?estado=&q= — los clientes del SaaS.
router.get('/talleres', async (req, res) => {
  try {
    const cond = [];
    const params = [];
    if (ESTADOS.includes(req.query.estado)) { cond.push('t.estado = ?'); params.push(req.query.estado); }
    if (PLANES.includes(req.query.plan)) { cond.push('t.plan = ?'); params.push(req.query.plan); }
    if (req.query.q) {
      cond.push('(t.nombre ILIKE ? OR t.slug ILIKE ?)');
      params.push(`%${req.query.q}%`, `%${req.query.q}%`);
    }
    const where = cond.length ? `WHERE ${cond.join(' AND ')}` : '';

    // Las cuentas van por subconsulta y no por JOIN: con varios JOIN a tablas
    // hijas los COUNT se multiplican entre sí y los números salen inflados.
    const [filas] = await pool.query(
      `SELECT t.id, t.nombre, t.slug, t.plan, t.estado, t.motivo_estado, t.trial_hasta, t.created_at,
              (SELECT COUNT(*) FROM usuarios u        WHERE u.tenant_id = t.id) AS usuarios,
              (SELECT COUNT(*) FROM clientes c        WHERE c.tenant_id = t.id) AS clientes,
              (SELECT COUNT(*) FROM vehiculos v       WHERE v.tenant_id = t.id) AS vehiculos,
              (SELECT COUNT(*) FROM ordenes_trabajo o WHERE o.tenant_id = t.id) AS ordenes,
              (SELECT MAX(o.created_at) FROM ordenes_trabajo o WHERE o.tenant_id = t.id) AS ultima_orden,
              (SELECT cfg.nombre_taller FROM configuracion cfg WHERE cfg.tenant_id = t.id LIMIT 1) AS nombre_config
       FROM tenants t
       ${where}
       ORDER BY t.created_at DESC`,
      params
    );
    res.json({ data: filas });
  } catch (err) {
    fail(res, err);
  }
});

// PATCH /api/motiq/talleres/:id/estado — suspender o reactivar.
router.patch('/talleres/:id/estado', async (req, res) => {
  try {
    const { estado, motivo } = req.body;
    if (!ESTADOS.includes(estado)) {
      return res.status(400).json({ error: `Estado inválido (${ESTADOS.join(', ')})` });
    }
    // Suspender deja a un taller sin poder trabajar: exigir el motivo obliga a que
    // quede escrito por qué, para cuando llamen a reclamar.
    if (estado !== 'activo' && !String(motivo || '').trim()) {
      return res.status(400).json({ error: 'Indicá el motivo de la suspensión' });
    }

    const [r] = await pool.query(
      'UPDATE tenants SET estado = ?, motivo_estado = ? WHERE id = ?',
      [estado, String(motivo || '').trim().slice(0, 200) || null, req.params.id]
    );
    if (!r.affectedRows) return res.status(404).json({ error: 'Taller no encontrado' });

    // Los middlewares leen el estado de memoria, no de la base. Se escribe acá para
    // que suspender valga desde el request siguiente; a los demás workers del
    // cluster les llega en el refresco periódico.
    fijarEstado(Number(req.params.id), estado);
    // Suspender deja a un cliente sin poder trabajar: tiene que quedar quién lo hizo
    // y por qué, en la base y no solo en la consola del servidor.
    const [[t]] = await pool.query('SELECT slug FROM tenants WHERE id = ?', [req.params.id]);
    anotar(req.plataforma, estado === 'activo' ? 'reactivo' : 'suspendio', {
      tenantId: Number(req.params.id), slug: t?.slug, detalle: motivo || null,
    });
    res.json({ message: estado === 'activo' ? 'Taller reactivado' : 'Taller suspendido' });
  } catch (err) {
    fail(res, err);
  }
});

// PATCH /api/motiq/talleres/:id/plan
router.patch('/talleres/:id/plan', async (req, res) => {
  try {
    const { plan, trial_hasta } = req.body;
    if (!PLANES.includes(plan)) return res.status(400).json({ error: `Plan inválido (${PLANES.join(', ')})` });

    // Solo el trial vence. Mandar la fecha en cualquier otro plan sería contradictorio,
    // así que se ignora en vez de guardarse a medias.
    const vence = plan === 'trial' ? (String(trial_hasta || '').trim() || null) : null;
    // La columna es DATE: una fecha mal escrita hoy reventaba en MySQL y salía como un
    // 500 genérico, que no le dice a nadie qué corregir.
    if (vence && !/^\d{4}-\d{2}-\d{2}$/.test(vence)) {
      return res.status(400).json({ error: 'La fecha de fin de prueba debe ser AAAA-MM-DD' });
    }

    const [r] = await pool.query(
      'UPDATE tenants SET plan = ?, trial_hasta = ? WHERE id = ?',
      [plan, vence, req.params.id]
    );
    if (!r.affectedRows) return res.status(404).json({ error: 'Taller no encontrado' });

    // Igual que con el estado: los topes del plan se leen de memoria en cada request,
    // así que pasar a Pro tiene que valer desde el request siguiente y no cuando toque
    // el refresco. A los otros workers del cluster les llega por ahí.
    fijarPlan(Number(req.params.id), plan, vence);
    const [[t]] = await pool.query('SELECT slug FROM tenants WHERE id = ?', [req.params.id]);
    anotar(req.plataforma, 'cambio_plan', {
      tenantId: Number(req.params.id), slug: t?.slug, detalle: `a ${plan}`,
    });
    res.json({ message: 'Plan actualizado' });
  } catch (err) {
    fail(res, err);
  }
});

// DELETE /api/motiq/talleres/:id — borra el taller y TODO lo suyo.
//
// Suspender es reversible y por eso está a un toque; esto no lo es. Se pide escribir
// el identificador del taller para confirmar, como hace GitHub para borrar un repo: no
// es burocracia, es la única defensa contra tocar el botón en la fila equivocada de una
// lista donde todas las filas se ven igual.
//
// Existe porque un cliente que se da de baja tiene derecho a pedir que se borren sus
// datos, y hasta ahora la única forma era entrar por SSH a correr un script.
router.delete('/talleres/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const [[taller]] = await pool.query('SELECT id, nombre, slug FROM tenants WHERE id = ?', [id]);
    if (!taller) return res.status(404).json({ error: 'Taller no encontrado' });

    if (String(req.body?.confirmacion || '').trim() !== taller.slug) {
      return res.status(400).json({
        error: `Para borrarlo, escribí su identificador exacto: ${taller.slug}`,
      });
    }

    const conn = await pool.getConnection();
    try {
      // El orden se deduce del esquema en cada corrida (utils/orden-borrado), con las
      // claves foráneas ENCENDIDAS: si el orden estuviera mal, la base lo dice en vez de
      // dejar filas huérfanas que nadie va a encontrar después.
      const orden = await ordenDeBorrado(conn, TABLAS_CON_TENANT);
      await conn.beginTransaction();
      let filas = 0;
      for (const tabla of orden) {
        const [r] = await conn.query(`DELETE FROM "${tabla}" WHERE tenant_id = ?`, [id]);
        filas += r.affectedRows;
      }
      const [r] = await conn.query('DELETE FROM tenants WHERE id = ?', [id]);
      filas += r.affectedRows;
      await conn.commit();

      // La foto en memoria todavía lo tiene como activo, y un token suyo sin vencer
      // seguiría pasando los middlewares hasta el refresco. Marcarlo cancelado los
      // corta desde el request siguiente; el refresco lo saca del todo.
      fijarEstado(id, 'cancelado');
      // La bitácora guarda el slug además del id justamente para este caso: el taller
      // ya no existe, y esta línea es la única que queda diciendo qué pasó con él.
      anotar(req.plataforma, 'borro', { tenantId: id, slug: taller.slug, detalle: `${filas} registros` });
      console.warn(`🗑  Motiq: ${req.plataforma?.email} borró el taller ${taller.slug} (${filas} filas)`);
      res.json({ message: `Se borró ${taller.nombre} y sus ${filas} registros`, filas });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  } catch (err) {
    fail(res, err);
  }
});

// ───────────── Planes ─────────────
// Antes vivían solo como constantes en utils/limites.js. Acá se pueden editar sin
// tocar código ni redesplegar — el precio del plan Pro, sobre todo, es un dato que
// va a cambiar más de una vez y no debería requerir un deploy cada vez que pase.

// GET /api/motiq/planes — el precio y los límites de cada plan.
router.get('/planes', async (req, res) => {
  try {
    const [filas] = await pool.query(
      `SELECT plan, precio_mensual, limite_usuarios, limite_sucursales, marca_propia, reportes_dias, updated_at
         FROM planes_config ORDER BY array_position(ARRAY['trial', 'gratis', 'pro']::text[], plan::text)`
    );
    res.json({ data: filas });
  } catch (err) {
    fail(res, err);
  }
});

// PATCH /api/motiq/planes/:plan — cambia lo que incluye un plan.
//
// Reemplaza la fila entera (no un PATCH parcial campo a campo): son cinco campos que
// se editan juntos en una sola pantalla, y un parcial dejaría la duda de qué pasa con
// los que no se mandan. `null` en los topes es explícito y significa "sin límite".
router.patch('/planes/:plan', async (req, res) => {
  try {
    const plan = req.params.plan;
    if (!PLANES.includes(plan)) return res.status(400).json({ error: `Plan inválido (${PLANES.join(', ')})` });

    const numOrNull = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
    const precio_mensual = Number(req.body?.precio_mensual) || 0;
    const limite_usuarios = numOrNull(req.body?.limite_usuarios);
    const limite_sucursales = numOrNull(req.body?.limite_sucursales);
    const reportes_dias = numOrNull(req.body?.reportes_dias);
    const marca_propia = req.body?.marca_propia ? 1 : 0;

    if (precio_mensual < 0) return res.status(400).json({ error: 'El precio no puede ser negativo' });
    for (const [nombre, v] of [['limite_usuarios', limite_usuarios], ['limite_sucursales', limite_sucursales], ['reportes_dias', reportes_dias]]) {
      if (v !== null && (!Number.isInteger(v) || v < 0)) {
        return res.status(400).json({ error: `${nombre} tiene que ser un entero mayor o igual a 0, o vacío para "sin límite"` });
      }
    }

    await pool.query(
      `INSERT INTO planes_config (plan, precio_mensual, limite_usuarios, limite_sucursales, marca_propia, reportes_dias)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (plan) DO UPDATE SET precio_mensual = EXCLUDED.precio_mensual, limite_usuarios = EXCLUDED.limite_usuarios,
         limite_sucursales = EXCLUDED.limite_sucursales, marca_propia = EXCLUDED.marca_propia, reportes_dias = EXCLUDED.reportes_dias`,
      [plan, precio_mensual, limite_usuarios, limite_sucursales, marca_propia, reportes_dias]
    );

    // Vale desde el request siguiente, en este proceso. A los otros workers del
    // cluster les llega en el refresco periódico (ver utils/limites.js).
    fijarLimites(plan, { precio_mensual, limite_usuarios, limite_sucursales, marca_propia, reportes_dias });
    anotar(req.plataforma, 'edito_plan', { detalle: `${plan}: ₡${precio_mensual}/mes` });
    res.json({ message: 'Plan actualizado' });
  } catch (err) {
    fail(res, err);
  }
});

// ───────────── Cuentas de la plataforma ─────────────
// Hasta acá, crear una cuenta para un compañero era entrar por SSH a correr un script.
// Eso está bien para arrancar y deja de estarlo apenas el equipo son dos personas.

// GET /api/motiq/admins — quién tiene las llaves de todo.
router.get('/admins', async (req, res) => {
  try {
    const [filas] = await pool.query(
      'SELECT id, nombre, email, activo, ultimo_acceso, created_at FROM plataforma_admins ORDER BY id'
    );
    res.json({ data: filas });
  } catch (err) {
    fail(res, err);
  }
});

// POST /api/motiq/admins — suma a alguien al equipo.
//
// La contraseña la genera el servidor y se devuelve UNA vez, igual que en el script:
// que la elija quien invita significa que viaja escrita en el formulario de quien
// invita, y que casi siempre sea la misma de siempre.
router.post('/admins', async (req, res) => {
  try {
    const nombre = String(req.body?.nombre || '').trim();
    const email = String(req.body?.email || '').trim().toLowerCase();
    if (!nombre) return res.status(400).json({ error: 'Falta el nombre' });
    if (!emailValido(email)) return res.status(400).json({ error: 'El correo no parece válido' });

    const [[existe]] = await pool.query('SELECT id FROM plataforma_admins WHERE email = ?', [email]);
    if (existe) return res.status(409).json({ error: 'Ya hay una cuenta con ese correo' });

    const password = generarPassword();
    const hash = await bcrypt.hash(password, 10);
    const [r] = await pool.query(
      'INSERT INTO plataforma_admins (nombre, email, password_hash, activo) VALUES (?, ?, ?, 1)',
      [nombre, email, hash]
    );
    anotar(req.plataforma, 'creo_cuenta', { detalle: email });
    console.warn(`👤 Motiq: ${req.plataforma?.email} creó la cuenta de plataforma ${email}`);
    res.status(201).json({
      data: { id: r.insertId, nombre, email, password },
      message: 'Cuenta creada. Copiá la contraseña ahora: no se vuelve a mostrar.',
    });
  } catch (err) {
    fail(res, err);
  }
});

// PATCH /api/motiq/admins/:id — activa/desactiva, o edita nombre y correo.
//
// Sirve tanto para editar el propio perfil como el de un compañero: acá no hay
// permisos parciales (misma regla que suspender un taller), así que cualquiera de
// los dos puede corregir el nombre o el correo del otro. Desactivar en vez de borrar:
// la fila queda para saber quién hizo qué, y el correo sigue tomado (no se puede
// recrear la cuenta por accidente y creer que es la misma).
router.patch('/admins/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const sets = [];
    const params = [];
    const detalles = [];

    if (req.body?.nombre !== undefined) {
      const nombre = String(req.body.nombre).trim();
      if (!nombre) return res.status(400).json({ error: 'El nombre no puede quedar vacío' });
      sets.push('nombre = ?'); params.push(nombre.slice(0, 120));
      detalles.push('nombre');
    }

    if (req.body?.email !== undefined) {
      const email = String(req.body.email).trim().toLowerCase();
      if (!emailValido(email)) return res.status(400).json({ error: 'El correo no parece válido' });
      const [[existe]] = await pool.query('SELECT id FROM plataforma_admins WHERE email = ? AND id <> ?', [email, id]);
      if (existe) return res.status(409).json({ error: 'Ya hay otra cuenta con ese correo' });
      sets.push('email = ?'); params.push(email);
      detalles.push('correo');
    }

    if (req.body?.activo !== undefined) {
      const activo = req.body.activo ? 1 : 0;
      // Nadie se cierra a sí mismo la puerta: si el único admin activo se desactiva, no
      // queda quién vuelva a entrar a reactivarlo y el panel se pierde hasta abrir la base.
      if (!activo && id === req.plataforma?.id) {
        return res.status(400).json({ error: 'No podés desactivar tu propia cuenta' });
      }
      if (!activo) {
        const [[{ n }]] = await pool.query(
          'SELECT COUNT(*) AS n FROM plataforma_admins WHERE activo = 1 AND id <> ?', [id]
        );
        if (!n) return res.status(400).json({ error: 'Tiene que quedar al menos una cuenta activa' });
      }
      sets.push('activo = ?'); params.push(activo);
      detalles.push(activo ? 'activada' : 'desactivada');
    }

    if (!sets.length) return res.status(400).json({ error: 'Nada para actualizar' });

    params.push(id);
    const [r] = await pool.query(`UPDATE plataforma_admins SET ${sets.join(', ')} WHERE id = ?`, params);
    if (!r.affectedRows) return res.status(404).json({ error: 'Cuenta no encontrada' });
    anotar(req.plataforma, 'edito_cuenta', { detalle: `${id === req.plataforma?.id ? 'su perfil' : 'cuenta #' + id}: ${detalles.join(', ')}` });
    res.json({ message: 'Cuenta actualizada' });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Ya hay otra cuenta con ese correo' });
    fail(res, err);
  }
});

// ───────────── Avisos hacia los talleres ─────────────
// Una franja arriba de la pantalla del PERSONAL de cada taller (admin/recepción/
// mecánico) — mantenimiento programado, una función nueva, lo que Motiq necesite
// avisar. No es mensajería interna de un taller hacia su propia gente (esa va
// scopeada por tenant_id, ver mensajeria.routes.js); esto lo escribe Motiq y lo lee
// cualquier taller. La lectura vive en routes/avisos.routes.js, del lado del staff.

// El navegador manda la hora de vencimiento ya convertida a UTC (new Date(...).
// toISOString()), así que acá alcanza con volver a parsearla — sin este paso el
// front tendría que mandar un string con una zona horaria que el server tiene que
// adivinar. `undefined` = no la mandó (dejar como está); `null`/'' = vaciarla.
//
// Se devuelve como STRING ya formateado en UTC ("YYYY-MM-DD HH:MM:SS") y no como
// objeto Date: mysql2 serializa un Date según la zona horaria del PROCESO de Node
// (no la de MySQL), así que en una máquina que no corre en UTC —como cualquier
// entorno de desarrollo— el valor guardado queda corrido varias horas. Un string ya
// formateado no sufre esa segunda conversión.
function fechaOVacio(v) {
  if (v === null || v === '') return { ok: true, valor: null };
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return { ok: false, valor: null };
  return { ok: true, valor: d.toISOString().slice(0, 19).replace('T', ' ') };
}

// GET /api/motiq/avisos — el historial completo, para administrarlos.
//
// vence_el se pide con DATE_FORMAT(...'Z') y no se deja como columna cruda: mysql2
// devuelve un DATETIME como objeto Date interpretando el valor guardado en la zona
// horaria LOCAL DEL PROCESO, y acá se guardó como UTC (ver fechaOVacio) — sin este
// formateo explícito, el valor le llega al front corrido esa misma cantidad de horas
// una SEGUNDA vez. Mismo motivo por el que estado-tenant.js pide trial_hasta con
// DATE_FORMAT en vez de dejar que el driver lo convierta solo.
router.get('/avisos', async (req, res) => {
  try {
    const [filas] = await pool.query(
      `SELECT id, mensaje, tipo, activo,
              to_char(vence_el, 'YYYY-MM-DD"T"HH24:MI:SS".000Z"') AS vence_el,
              admin_email, created_at, updated_at
         FROM avisos_plataforma ORDER BY created_at DESC LIMIT 100`
    );
    res.json({ data: filas });
  } catch (err) {
    fail(res, err);
  }
});

// POST /api/motiq/avisos — publica uno nuevo. Nace activo.
router.post('/avisos', async (req, res) => {
  try {
    const mensaje = String(req.body?.mensaje || '').trim();
    if (!mensaje) return res.status(400).json({ error: 'Falta el mensaje' });
    const tipo = TIPOS_AVISO.includes(req.body?.tipo) ? req.body.tipo : 'info';

    const vence = fechaOVacio(req.body?.vence_el);
    if (!vence.ok) return res.status(400).json({ error: 'La fecha de vencimiento no es válida' });

    const [r] = await pool.query(
      `INSERT INTO avisos_plataforma (mensaje, tipo, vence_el, admin_id, admin_email) VALUES (?, ?, ?, ?, ?)`,
      [mensaje.slice(0, 500), tipo, vence.valor, req.plataforma?.id || null, req.plataforma?.email || null]
    );
    anotar(req.plataforma, 'creo_aviso', { detalle: mensaje.slice(0, 100) });
    res.status(201).json({ data: { id: r.insertId }, message: 'Aviso publicado' });
  } catch (err) {
    fail(res, err);
  }
});

// PATCH /api/motiq/avisos/:id — editar el texto/tipo/vencimiento, o apagarlo/reactivarlo.
router.patch('/avisos/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const sets = [];
    const params = [];

    if (req.body?.mensaje !== undefined) {
      const mensaje = String(req.body.mensaje).trim();
      if (!mensaje) return res.status(400).json({ error: 'El mensaje no puede quedar vacío' });
      sets.push('mensaje = ?'); params.push(mensaje.slice(0, 500));
    }
    if (req.body?.tipo !== undefined) {
      if (!TIPOS_AVISO.includes(req.body.tipo)) return res.status(400).json({ error: `Tipo inválido (${TIPOS_AVISO.join(', ')})` });
      sets.push('tipo = ?'); params.push(req.body.tipo);
    }
    if (req.body?.vence_el !== undefined) {
      const vence = fechaOVacio(req.body.vence_el);
      if (!vence.ok) return res.status(400).json({ error: 'La fecha de vencimiento no es válida' });
      sets.push('vence_el = ?'); params.push(vence.valor);
    }
    if (req.body?.activo !== undefined) {
      sets.push('activo = ?'); params.push(req.body.activo ? 1 : 0);
    }
    if (!sets.length) return res.status(400).json({ error: 'Nada para actualizar' });

    params.push(id);
    const [r] = await pool.query(`UPDATE avisos_plataforma SET ${sets.join(', ')} WHERE id = ?`, params);
    if (!r.affectedRows) return res.status(404).json({ error: 'Aviso no encontrado' });
    anotar(req.plataforma, 'edito_aviso', { detalle: `#${id}` });
    res.json({ message: 'Aviso actualizado' });
  } catch (err) {
    fail(res, err);
  }
});

// ───────────── Mi espacio de trabajo ─────────────
// El SaaS es de los dos y los datos son compartidos: ambos ven todos los talleres.
// Lo que no puede ser compartido es la agenda. Dos personas mirando la misma lista de
// pendientes terminan llamando las dos al mismo taller, o ninguna, cada una suponiendo
// que la otra ya lo hizo.

// GET /api/motiq/espacio — todo lo mío de una sola vez.
//
// Va en un solo endpoint y no en tres: es la pantalla de inicio, y hacerle esperar
// tres viajes seguidos al servidor a quien acaba de entrar se nota.
router.get('/espacio', async (req, res) => {
  try {
    const yo = req.plataforma.id;

    const [tareas] = await pool.query(
      `SELECT t.id, t.texto, t.tenant_id, t.vence_el, t.hecha, t.created_at,
              te.nombre AS taller_nombre, te.slug AS taller_slug,
              (t.vence_el::date - CURRENT_DATE::date) AS dias
         FROM motiq_tareas t
         LEFT JOIN tenants te ON te.id = t.tenant_id
        WHERE t.admin_id = ?
          -- Las hechas de hace más de una semana se dejan de mostrar solas. Una lista
          -- que solo crece deja de mirarse, y tachar algo tiene que sacarlo de encima.
          AND (t.hecha = 0 OR t.hecha_en >= (NOW() - INTERVAL '7 days'))
        ORDER BY t.hecha, t.vence_el IS NULL, t.vence_el, t.id DESC`,
      [yo]
    );

    // Los talleres que sigo, con lo que necesito saber de un vistazo: si vencen, si
    // están suspendidos y si se movieron.
    const [seguidos] = await pool.query(
      `SELECT s.tenant_id AS id, s.nota, t.nombre, t.slug, t.plan, t.estado, t.trial_hasta,
              (t.trial_hasta::date - CURRENT_DATE::date) AS dias_restantes,
              (SELECT COUNT(*) FROM ordenes_trabajo o WHERE o.tenant_id = t.id) AS ordenes,
              (SELECT MAX(o.created_at) FROM ordenes_trabajo o WHERE o.tenant_id = t.id) AS ultima_orden
         FROM motiq_seguidos s
         JOIN tenants t ON t.id = s.tenant_id
        WHERE s.admin_id = ?
        ORDER BY t.nombre`,
      [yo]
    );

    const [actividad] = await pool.query(
      `SELECT id, accion, tenant_id, tenant_slug, detalle, created_at
         FROM motiq_bitacora WHERE admin_id = ? ORDER BY created_at DESC LIMIT 15`,
      [yo]
    );

    // Lo que hizo el OTRO, para no llamar dos veces al mismo taller ni sorprenderse de
    // que un cliente aparezca suspendido sin saber por qué.
    const [equipo] = await pool.query(
      `SELECT id, admin_email, accion, tenant_slug, detalle, created_at
         FROM motiq_bitacora WHERE admin_id <> ? ORDER BY created_at DESC LIMIT 10`,
      [yo]
    );

    res.json({ data: { tareas, seguidos, actividad, equipo } });
  } catch (err) {
    fail(res, err);
  }
});

// POST /api/motiq/tareas — anotar un pendiente.
router.post('/tareas', async (req, res) => {
  try {
    const texto = String(req.body?.texto || '').trim();
    if (!texto) return res.status(400).json({ error: '¿Qué hay que hacer?' });
    const vence = String(req.body?.vence_el || '').trim() || null;
    if (vence && !/^\d{4}-\d{2}-\d{2}$/.test(vence)) {
      return res.status(400).json({ error: 'La fecha debe ser AAAA-MM-DD' });
    }
    const [r] = await pool.query(
      'INSERT INTO motiq_tareas (admin_id, texto, tenant_id, vence_el) VALUES (?, ?, ?, ?)',
      [req.plataforma.id, texto.slice(0, 300), Number(req.body?.tenant_id) || null, vence]
    );
    res.status(201).json({ data: { id: r.insertId }, message: 'Anotado' });
  } catch (err) {
    fail(res, err);
  }
});

// PATCH /api/motiq/tareas/:id — tacharla o volver a abrirla.
//
// El WHERE lleva el admin: sin él, cualquiera de los dos podría tachar los pendientes
// del otro pasando un id a mano, y el espacio dejaría de ser de nadie.
router.patch('/tareas/:id', async (req, res) => {
  try {
    const hecha = req.body?.hecha ? 1 : 0;
    const [r] = await pool.query(
      'UPDATE motiq_tareas SET hecha = ?, hecha_en = ? WHERE id = ? AND admin_id = ?',
      [hecha, hecha ? new Date() : null, req.params.id, req.plataforma.id]
    );
    if (!r.affectedRows) return res.status(404).json({ error: 'Pendiente no encontrado' });
    res.json({ message: hecha ? 'Listo' : 'Reabierto' });
  } catch (err) {
    fail(res, err);
  }
});

router.delete('/tareas/:id', async (req, res) => {
  try {
    const [r] = await pool.query('DELETE FROM motiq_tareas WHERE id = ? AND admin_id = ?',
      [req.params.id, req.plataforma.id]);
    if (!r.affectedRows) return res.status(404).json({ error: 'Pendiente no encontrado' });
    res.json({ message: 'Borrado' });
  } catch (err) {
    fail(res, err);
  }
});

// PUT /api/motiq/seguidos/:tenantId — seguir o dejar de seguir un taller.
router.put('/seguidos/:tenantId', async (req, res) => {
  try {
    const tenantId = Number(req.params.tenantId);
    const [[existe]] = await pool.query('SELECT id FROM tenants WHERE id = ?', [tenantId]);
    if (!existe) return res.status(404).json({ error: 'Taller no encontrado' });
    await pool.query(
      `INSERT INTO motiq_seguidos (admin_id, tenant_id, nota) VALUES (?, ?, ?)
       ON CONFLICT (admin_id, tenant_id) DO UPDATE SET nota = EXCLUDED.nota`,
      [req.plataforma.id, tenantId, String(req.body?.nota || '').trim().slice(0, 300) || null]
    );
    res.json({ message: 'Lo seguís de cerca' });
  } catch (err) {
    fail(res, err);
  }
});

router.delete('/seguidos/:tenantId', async (req, res) => {
  try {
    await pool.query('DELETE FROM motiq_seguidos WHERE admin_id = ? AND tenant_id = ?',
      [req.plataforma.id, Number(req.params.tenantId)]);
    res.json({ message: 'Dejaste de seguirlo' });
  } catch (err) {
    fail(res, err);
  }
});

// POST /api/motiq/password — cambiar la propia.
//
// Pide la actual aunque ya haya sesión: un token robado o una sesión abierta en una
// máquina prestada no debería poder quedarse con la cuenta cambiando la clave.
router.post('/password', async (req, res) => {
  try {
    const actual = String(req.body?.actual || '');
    const nueva = String(req.body?.nueva || '');
    if (nueva.length < 12) {
      return res.status(400).json({ error: 'La contraseña nueva necesita al menos 12 caracteres' });
    }
    const [[admin]] = await pool.query(
      'SELECT id, password_hash FROM plataforma_admins WHERE id = ? AND activo = 1', [req.plataforma.id]
    );
    if (!admin || !(await bcrypt.compare(actual, admin.password_hash))) {
      return res.status(401).json({ error: 'La contraseña actual no es correcta' });
    }
    await pool.query('UPDATE plataforma_admins SET password_hash = ? WHERE id = ?',
      [await bcrypt.hash(nueva, 10), admin.id]);
    res.json({ message: 'Contraseña actualizada' });
  } catch (err) {
    fail(res, err);
  }
});

module.exports = router;
