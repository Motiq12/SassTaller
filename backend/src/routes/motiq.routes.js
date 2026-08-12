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
const { fijarEstado } = require('../utils/estado-tenant');

const ESTADOS = ['activo', 'suspendido', 'cancelado'];
const PLANES = ['trial', 'pro'];

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

router.use(authPlataforma);

// GET /api/motiq/resumen — el estado del negocio de un vistazo.
router.get('/resumen', async (req, res) => {
  try {
    const [[t]] = await pool.query(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(estado = 'activo'), 0)      AS activos,
              COALESCE(SUM(estado = 'suspendido'), 0)  AS suspendidos,
              COALESCE(SUM(plan = 'trial'), 0)         AS en_prueba,
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
    res.json({ data: { talleres: t, uso } });
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

    const [r] = await pool.query(
      'UPDATE tenants SET plan = ?, trial_hasta = ? WHERE id = ?',
      [plan, plan === 'trial' ? (trial_hasta || null) : null, req.params.id]
    );
    if (!r.affectedRows) return res.status(404).json({ error: 'Taller no encontrado' });
    res.json({ message: 'Plan actualizado' });
  } catch (err) {
    fail(res, err);
  }
});

module.exports = router;
