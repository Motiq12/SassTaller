// Identidad del taller: lo que necesitan la factura, el PDF y los correos.
//
// Existe aparte de /api/admin/configuracion porque eso es solo para el admin, y estos
// datos los precisa cualquiera del personal (la factura la imprime recepción) e incluso
// un cliente de correo, que no manda ninguna sesión.
const router = require('express').Router();
const { getConfig } = require('../utils/configuracion');
const { fail } = require('../utils/responder');
const auth = require('../middleware/auth');
const tenantPublico = require('../middleware/tenant-publico');

// El logo se guarda como data URL en base64. Sirve para pintarlo en pantalla, pero NO
// dentro de un correo: Gmail y compañía descartan las imágenes `data:`. Por eso hace
// falta este endpoint, que lo devuelve como un archivo de imagen de verdad.
//
// Sin logo cargado NO se cae a un archivo de la app: el que había era el de MS Motos,
// y servírselo a otro taller sería ponerle la marca de un tercero. Se responde 404 y
// la interfaz muestra las iniciales del taller, que sirven para cualquier empresa.
//
// Solo formatos de mapa de bits. Un SVG puede llevar <script>, y servido desde acá
// correría en el dominio de la plataforma con la sesión de quien abra el enlace.
const DATA_URL_RE = /^data:(image\/(?:png|jpeg|jpg|webp|gif|avif|bmp|x-icon|vnd\.microsoft\.icon));base64,([A-Za-z0-9+/=\s]+)$/i;

// Convierte el logo guardado (data URL) en bytes servibles. Devuelve null si no hay
// logo o si el valor no es una imagen en base64 que sepamos interpretar — el llamador
// cae entonces al archivo que trae la app.
// Va aparte para poder probarla: es la parte con lógica real de todo el módulo.
function logoDesdeDataUrl(logo) {
  const m = typeof logo === 'string' ? logo.match(DATA_URL_RE) : null;
  if (!m) return null;
  const buffer = Buffer.from(m[2].replace(/\s/g, ''), 'base64');
  if (!buffer.length) return null;
  return { contentType: m[1].toLowerCase(), buffer };
}

// GET /api/marca/logo — imagen del taller. Público a propósito: lo pide el cliente de
// correo del destinatario, que no manda cabeceras de sesión.
router.get('/logo', tenantPublico, async (req, res) => {
  try {
    // Esta ruta no tiene middleware de sesion detras, asi que si tenantPublico no
    // resolvio el taller no hay de donde sacar el logo. Se dice cual falta.
    if (!req.db) return res.status(400).json({ error: 'Falta indicar el taller' });
    const { logo } = await getConfig(req.db);
    const img = logoDesdeDataUrl(logo);
    if (!img) return res.status(404).end();
    const { contentType, buffer } = img;
    res.set({
      'Content-Type': contentType,
      'Content-Length': buffer.length,
      // Corto a propósito: si cambian el logo, los correos siguientes lo toman enseguida.
      'Cache-Control': 'public, max-age=300',
      // Es un archivo que subió un taller: que el navegador no lo trate como otra cosa
      // que una imagen, ni ejecute nada si alguien lo abre directo.
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Content-Disposition': 'inline; filename="logo"',
    });
    res.send(buffer);
  } catch (err) {
    fail(res, err);
  }
});

// GET /api/marca/publica — identidad visible del taller SIN sesión.
//
// El login, el registro y la recuperación de contraseña se pintan antes de que
// exista un token, así que no pueden usar la ruta autenticada. Sin esto, esas
// pantallas tendrían que mostrar una marca fija — que es exactamente el problema
// que estamos resolviendo.
//
// Devuelve solo lo que ya se ve en la pantalla de login de cualquier taller
// (nombre, logo, color): nada que no publicaría en su puerta.
router.get('/publica', tenantPublico, async (req, res) => {
  try {
    if (!req.db) return res.status(400).json({ error: 'Falta indicar el taller' });
    const c = await getConfig(req.db);
    res.json({
      data: {
        nombre_taller: c.nombre_taller,
        logo: c.logo || null,
        color_primario: c.color_primario || null,
      },
    });
  } catch (err) {
    fail(res, err);
  }
});

// GET /api/marca — datos del taller para encabezar documentos. Requiere sesión de
// personal: no expone nada sensible, pero tampoco hace falta que sea público.
// GET /api/marca/contacto — cómo comunicarse con el taller (nombre, teléfono, correo y
// dirección de Configuración). Público a propósito: lo muestra la política de
// privacidad del portal, que se lee antes de tener cuenta. Es lo mismo que el taller
// le da a cualquier cliente; nada de lo demás de la configuración sale de aquí.
router.get('/contacto', tenantPublico, async (req, res) => {
  if (!req.db) return res.status(400).json({ error: 'Falta indicar el taller' });
  try {
    const c = await getConfig(req.db);
    res.setHeader('Cache-Control', 'no-cache');
    res.json({
      data: {
        nombre_taller: c.nombre_taller || 'El taller',
        telefono: c.telefono || '',
        email: c.email || '',
        direccion: c.direccion || '',
      },
    });
  } catch (err) {
    fail(res, err);
  }
});

// GET /api/marca/portal — los textos del portal que escribió el taller: el aviso de
// bienvenida y las condiciones del servicio. Público: los Términos se leen antes de
// tener cuenta. Vacío = el portal usa los de fábrica.
router.get('/portal', tenantPublico, async (req, res) => {
  if (!req.db) return res.status(400).json({ error: 'Falta indicar el taller' });
  try {
    const c = await getConfig(req.db);
    res.setHeader('Cache-Control', 'no-cache');
    res.json({ data: c.portal_textos });
  } catch (err) {
    fail(res, err);
  }
});

router.get('/', auth, async (req, res) => {
  try {
    const c = await getConfig(req.db);
    res.json({
      data: {
        nombre_taller: c.nombre_taller,
        telefono: c.telefono,
        email: c.email,
        direccion: c.direccion,
        logo: c.logo || null,
        razon_social: c.razon_social || '',
        cedula_juridica: c.cedula_juridica || '',
        nota_factura: c.nota_factura || '',
        // Los mensajes de WhatsApp que el taller reescribió (shared/whatsapp.util.ts).
        plantillas: { whatsapp: c.plantillas.whatsapp },
        color_primario: c.color_primario || null,
        garantia_dias: c.garantia_dias,
        metodos_pago: c.metodos_pago,
      },
    });
  } catch (err) {
    fail(res, err);
  }
});

module.exports = router;
module.exports.logoDesdeDataUrl = logoDesdeDataUrl;
