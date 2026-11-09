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
const { fijarPlan } = require('../utils/estado-tenant');
const { finDeTrial, limitesDe, precioDe, DIAS_TRIAL } = require('../utils/limites');
const { TIPOS } = require('../utils/tipos-vehiculo');
const { paraTenant } = require('../db/tenant-db');
const { nuevoCodigo, VIGENCIA_MIN } = require('../utils/verificacion-usuario');
const { enviarCodigoCorreoStaff } = require('../services/mailer');

const MIN_PASSWORD = 8;
// El navegador ya la achica a 512 px antes de mandarla. SVG no: puede llevar código.
const LOGO_RE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;
const LOGO_MAX = 700 * 1024;
const COLOR_RE = /^#[0-9a-f]{6}$/i;

// El código de verificación del dueño, en cuanto el taller existe. Necesita un cliente
// scopeado al tenant recién creado: el pool sin scope de este archivo es la excepción
// del alta, y no hay razón para extenderla a algo que ya sabe a qué taller pertenece.
async function enviarPrimerCodigo(tenantId, usuarioId, email, nombre) {
  const db = paraTenant(tenantId);
  const codigo = await nuevoCodigo(db, usuarioId);
  await enviarCodigoCorreoStaff(email, { nombre, codigo, minutos: VIGENCIA_MIN });
}

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

// GET /api/onboarding/tipos — catálogo de tipos de vehículo y sus campos propios.
// Lo consumen el formulario de alta y el de vehículos. Va servido desde acá y no
// duplicado en el frontend: con dos copias, agregar un tipo obligaría a acordarse
// de tocar los dos lados, y el día que alguien se olvide el formulario pediría un
// dato que el servidor descarta sin avisar.
router.get('/tipos', (req, res) => {
  res.json({
    data: Object.entries(TIPOS).map(([clave, t]) => ({
      clave, etiqueta: t.etiqueta, plural: t.plural, unidadUso: t.unidadUso, campos: t.campos,
    })),
  });
});

// GET /api/onboarding/planes — los planes tal como rigen hoy, para la landing.
//
// La landing mostraba los topes escritos a mano, pero el panel de Motiq puede
// editarlos (planes_config): en cuanto alguien los cambiara, la página prometería otra
// cosa que el sistema. Esto expone lo mismo que aplica utils/limites.js. Es público:
// son los precios y límites de la página de venta, nada de ningún taller.
router.get('/planes', (req, res) => {
  const plan = (p) => ({ ...limitesDe(p), precio_mensual: precioDe(p) || null });
  res.set('Cache-Control', 'public, max-age=300');
  res.json({ data: { dias_prueba: DIAS_TRIAL, trial: plan('trial'), gratis: plan('gratis'), pro: plan('pro') } });
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

    const { logo, color_primario: color, razon_social: razon, cedula_juridica: cedula } = req.body;
    if (logo && (typeof logo !== 'string' || logo.length > LOGO_MAX || !LOGO_RE.test(logo))) {
      return res.status(400).json({ error: 'El logo tiene que ser una imagen PNG, JPG o WebP de menos de 500 KB' });
    }
    if (color && !COLOR_RE.test(String(color))) {
      return res.status(400).json({ error: 'El color no es válido' });
    }

    // Qué vehículos atiende: lo elige el taller, siempre. normalizarTipos() cae a
    // 'moto' cuando no llega nada (lo usan otros caminos), pero en el alta pública eso
    // decidía por el taller en silencio: uno de autos que no marcó nada —o al que no
    // le cargó el catálogo— terminaba con el catálogo de motos. Acá se exige.
    const tiposPedidos = Array.isArray(req.body.tipos) ? req.body.tipos.map(t => String(t).toLowerCase()) : [];
    if (!tiposPedidos.length || tiposPedidos.some(t => !TIPOS[t])) {
      return res.status(400).json({ error: 'Elegí qué vehículos atiende el taller' });
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

    const { tenantId, adminId, tipos } = await crearTaller(conn, {
      nombre: String(nombre).trim(),
      slug,
      admin: {
        nombre: String(admin.nombre).trim(),
        email: String(admin.email).trim().toLowerCase(),
        password: admin.password,
        telefono: admin.telefono,
      },
      sucursal,
      tipos: req.body.tipos,
      contacto,
      marca: {
        logo: logo || null,
        color: color ? String(color).toLowerCase() : null,
        razonSocial: String(razon || '').trim().slice(0, 150) || null,
        cedulaJuridica: String(cedula || '').trim().slice(0, 30) || null,
      },
    });

    await conn.commit();

    // La foto en memoria de los planes (utils/estado-tenant) se refresca cada 30s, así
    // que un taller recién creado no está en ella. Sin esta línea, durante el primer
    // medio minuto de vida —justo cuando su dueño entra por primera vez— /auth/me
    // devolvía plan:null: la franja de "te quedan 30 días" no aparecía, y los límites
    // caían al plan más permisivo por el respaldo de limitesDe().
    //
    // Va DESPUÉS del commit a propósito: si la transacción se cae, la caché no puede
    // quedar afirmando un taller que no llegó a existir.
    fijarPlan(tenantId, 'trial', finDeTrial());

    // Sesión inmediata: el admin entra a su taller recién creado sin volver a
    // escribir la contraseña que acaba de elegir.
    const payload = {
      id: adminId, nombre: String(admin.nombre).trim(),
      email: String(admin.email).trim().toLowerCase(), rol: 'admin', tenant_id: tenantId,
    };
    const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '8h' });

    // Código para confirmar el correo del dueño. Va DESPUÉS del commit y sin await sobre
    // la respuesta: el taller ya está creado y su sesión lista, así que un correo que no
    // sale (Resend caído, sin API key en desarrollo) no puede convertir un alta exitosa
    // en un error. Si falla, el aviso en pantalla ofrece reenviarlo.
    enviarPrimerCodigo(tenantId, adminId, payload.email, payload.nombre)
      .catch(err => console.warn('⚠️  No se pudo enviar el código de verificación:', err.message));

    res.status(201).json({
      data: { token, tipo: 'staff', usuario: payload, taller: { id: tenantId, nombre, slug, tipos } },
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
