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
const { PLANES } = require('../utils/limites');
const { crearTaller, normalizarSlug, motivoSlugInvalido } = require('../utils/onboarding');
const { generarPassword } = require('../utils/password');
const { ordenDeBorrado } = require('../utils/orden-borrado');
const { TABLAS_CON_TENANT } = require('../db/tenant-db');

const ESTADOS = ['activo', 'suspendido', 'cancelado'];

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
              nota_interna = CONCAT(COALESCE(nota_interna, ''), ?)
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

// GET /api/motiq/resumen — el estado del negocio de un vistazo.
router.get('/resumen', async (req, res) => {
  try {
    const [[t]] = await pool.query(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(estado = 'activo'), 0)      AS activos,
              COALESCE(SUM(estado = 'suspendido'), 0)  AS suspendidos,
              COALESCE(SUM(plan = 'trial'), 0)         AS en_prueba,
              COALESCE(SUM(plan = 'gratis'), 0)        AS en_gratis,
              COALESCE(SUM(plan = 'pro'), 0)           AS en_pro,
              COALESCE(SUM(created_at >= NOW() - INTERVAL 30 DAY), 0) AS nuevos_30d
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
      `SELECT DATE_FORMAT(created_at, '%Y-%m') AS mes, COUNT(*) AS talleres
         FROM tenants
        WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 6 MONTH)
        GROUP BY mes ORDER BY mes`
    );

    // Los dos números por los que se llama a alguien: a quién se le acaba la prueba
    // y quién dejó de usar el sistema. Sin esto hay que salir a buscarlos a mano.
    const [[alertas]] = await pool.query(
      `SELECT
         (SELECT COUNT(*) FROM tenants
           WHERE plan = 'trial' AND estado = 'activo' AND trial_hasta IS NOT NULL
             AND trial_hasta BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 7 DAY)) AS vencen_semana,
         (SELECT COUNT(*) FROM tenants t
           WHERE t.estado = 'activo'
             AND NOT EXISTS (SELECT 1 FROM ordenes_trabajo o
                              WHERE o.tenant_id = t.id
                                AND o.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY))) AS inactivos`
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
              DATEDIFF(t.trial_hasta, CURDATE()) AS dias_restantes,
              (SELECT u.nombre   FROM usuarios u WHERE u.tenant_id = t.id AND u.rol = 'admin' AND u.activo = 1 ORDER BY u.id LIMIT 1) AS admin_nombre,
              (SELECT u.email    FROM usuarios u WHERE u.tenant_id = t.id AND u.rol = 'admin' AND u.activo = 1 ORDER BY u.id LIMIT 1) AS admin_email,
              (SELECT u.telefono FROM usuarios u WHERE u.tenant_id = t.id AND u.rol = 'admin' AND u.activo = 1 ORDER BY u.id LIMIT 1) AS admin_telefono,
              (SELECT COUNT(*) FROM ordenes_trabajo o WHERE o.tenant_id = t.id) AS ordenes
         FROM tenants t
        WHERE t.plan = 'trial' AND t.estado = 'activo' AND t.trial_hasta IS NOT NULL
          AND t.trial_hasta <= DATE_ADD(CURDATE(), INTERVAL ? DAY)
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
                           WHERE o.tenant_id = t.id AND o.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY))
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
              t.created_at, DATEDIFF(t.trial_hasta, CURDATE()) AS dias_restantes,
              c.nombre_taller, c.telefono, c.email, c.direccion, c.tipos_vehiculo,
              c.logo IS NOT NULL AS tiene_logo, c.color_primario
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
                WHERE tenant_id = ? AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)) AS ordenes_30d`,
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
    if (req.query.q) {
      cond.push('(t.nombre LIKE ? OR t.slug LIKE ?)');
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
      // claves foráneas ENCENDIDAS: si el orden estuviera mal, MySQL lo dice en vez de
      // dejar filas huérfanas que nadie va a encontrar después.
      const orden = await ordenDeBorrado(conn, TABLAS_CON_TENANT);
      await conn.beginTransaction();
      let filas = 0;
      for (const tabla of orden) {
        const [r] = await conn.query(`DELETE FROM \`${tabla}\` WHERE tenant_id = ?`, [id]);
        filas += r.affectedRows;
      }
      const [r] = await conn.query('DELETE FROM tenants WHERE id = ?', [id]);
      filas += r.affectedRows;
      await conn.commit();

      // La foto en memoria todavía lo tiene como activo, y un token suyo sin vencer
      // seguiría pasando los middlewares hasta el refresco. Marcarlo cancelado los
      // corta desde el request siguiente; el refresco lo saca del todo.
      fijarEstado(id, 'cancelado');
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
    console.warn(`👤 Motiq: ${req.plataforma?.email} creó la cuenta de plataforma ${email}`);
    res.status(201).json({
      data: { id: r.insertId, nombre, email, password },
      message: 'Cuenta creada. Copiá la contraseña ahora: no se vuelve a mostrar.',
    });
  } catch (err) {
    fail(res, err);
  }
});

// PATCH /api/motiq/admins/:id — activa o desactiva a alguien.
//
// Desactivar en vez de borrar: la fila queda para saber quién hizo qué, y el correo
// sigue tomado (no se puede recrear la cuenta por accidente y creer que es la misma).
router.patch('/admins/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const activo = req.body?.activo ? 1 : 0;
    // Nadie se cierra a sí mismo la puerta: si el único admin activo se desactiva, no
    // queda quién vuelva a entrar a reactivarlo y el panel se pierde hasta abrir la base.
    if (id === req.plataforma?.id) {
      return res.status(400).json({ error: 'No podés desactivar tu propia cuenta' });
    }
    if (!activo) {
      const [[{ n }]] = await pool.query(
        'SELECT COUNT(*) AS n FROM plataforma_admins WHERE activo = 1 AND id <> ?', [id]
      );
      if (!n) return res.status(400).json({ error: 'Tiene que quedar al menos una cuenta activa' });
    }
    const [r] = await pool.query('UPDATE plataforma_admins SET activo = ? WHERE id = ?', [activo, id]);
    if (!r.affectedRows) return res.status(404).json({ error: 'Cuenta no encontrada' });
    res.json({ message: activo ? 'Cuenta activada' : 'Cuenta desactivada' });
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
