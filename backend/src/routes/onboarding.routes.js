const router = require('express').Router();
const jwt = require('jsonwebtoken');
// Registro de talleres nuevos: es la única ruta que crea tenants, así que va contra
// el pool sin scope a propósito. Todavía no existe el taller al que acotarse — es lo
// que esta ruta hace. Todo lo que escribe declara su tenant_id explícitamente.
const { pool } = require('../db/pool');
const { fail } = require('../utils/responder');
const { emailValido } = require('../utils/validar');
const { consumir } = require('../utils/rate-limit');
const { antibot } = require('../utils/antibot');
const { crearTaller, normalizarSlug, motivoSlugInvalido } = require('../utils/onboarding');

const MIN_PASSWORD = 8;

// GET /api/onboarding/disponible?slug=... — para validar en vivo mientras se escribe,
// sin tener que mandar el formulario entero para descubrir que el nombre está tomado.
router.get('/disponible', async (req, res) => {
  try {
    const slug = normalizarSlug(req.query.slug);
    const motivo = motivoSlugInvalido(slug);
    if (motivo) return res.json({ data: { slug, disponible: false, motivo } });

    const [[existe]] = await pool.query('SELECT id FROM tenants WHERE slug = ?', [slug]);
    res.json({
      data: {
        slug,
        disponible: !existe,
        motivo: existe ? 'Ese identificador ya está en uso' : null,
      },
    });
  } catch (err) {
    fail(res, err);
  }
});

// POST /api/onboarding — da de alta un taller y devuelve la sesión de su admin.
router.post('/', antibot(), async (req, res) => {
  let conn;
  try {
    const { nombre, admin = {}, sucursal, contacto } = req.body;

    if (!nombre || !String(nombre).trim()) {
      return res.status(400).json({ error: 'El nombre del taller es requerido' });
    }
    if (!admin.nombre || !admin.email || !admin.password) {
      return res.status(400).json({ error: 'Nombre, correo y contraseña del administrador son requeridos' });
    }
    if (!emailValido(admin.email)) {
      return res.status(400).json({ error: 'El correo del administrador no tiene un formato válido' });
    }
    if (String(admin.password).length < MIN_PASSWORD) {
      return res.status(400).json({ error: `La contraseña debe tener al menos ${MIN_PASSWORD} caracteres` });
    }

    // El slug se acepta explícito o se deriva del nombre del taller.
    const slug = normalizarSlug(req.body.slug || nombre);
    const motivo = motivoSlugInvalido(slug);
    if (motivo) return res.status(400).json({ error: motivo });

    // El tope va DESPUÉS de validar, y no antes: un alta crea infraestructura
    // (tenant, usuario, catálogo) y sin límite un bot podría llenar la tabla de
    // talleres — pero eso solo lo logra con peticiones válidas. Contando también
    // las inválidas, alguien que se equivoca dos veces con la contraseña se queda
    // sin poder registrarse, y el bot igual pasaría con datos bien formados.
    const limite = consumir(`onboarding:${req.ip}`, { porMinuto: 3, porHora: 10 });
    if (!limite.ok) {
      return res.status(429).json({ error: `Demasiados intentos. Esperá ${limite.retryAfter}s e intentá de nuevo.` });
    }

    conn = await pool.getConnection();
    await conn.beginTransaction();

    // El chequeo previo evita el 500 feo del choque de índice, pero el UNIQUE de la
    // base sigue siendo la autoridad: entre este SELECT y el INSERT puede colarse
    // otro registro con el mismo slug, y ahí manda la base (se traduce abajo).
    const [[tomado]] = await conn.query('SELECT id FROM tenants WHERE slug = ? FOR UPDATE', [slug]);
    if (tomado) {
      await conn.rollback();
      return res.status(409).json({ error: 'Ese identificador ya está en uso' });
    }

    const { tenantId, adminId } = await crearTaller(conn, {
      nombre: String(nombre).trim(),
      slug,
      admin: {
        nombre: String(admin.nombre).trim(),
        email: String(admin.email).trim().toLowerCase(),
        password: admin.password,
        telefono: admin.telefono,
      },
      sucursal,
      contacto,
    });

    await conn.commit();

    // Sesión inmediata: el admin entra a su taller recién creado sin volver a
    // escribir la contraseña que acaba de elegir.
    const payload = {
      id: adminId, nombre: String(admin.nombre).trim(),
      email: String(admin.email).trim().toLowerCase(), rol: 'admin', tenant_id: tenantId,
    };
    const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '8h' });

    res.status(201).json({
      data: { token, tipo: 'staff', usuario: payload, taller: { id: tenantId, nombre, slug } },
      message: 'Taller creado',
    });
  } catch (err) {
    if (conn) await conn.rollback().catch(() => {});
    // Carrera con otro registro simultáneo: el UNIQUE de la base lo cortó.
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Ese identificador o correo ya está en uso' });
    }
    fail(res, err);
  } finally {
    if (conn) conn.release();
  }
});

module.exports = router;
