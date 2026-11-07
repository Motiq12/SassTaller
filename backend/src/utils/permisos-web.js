// Permisos para administrar el sitio web desde el panel.
//
// El administrador (el dueño) puede todo, siempre. A cualquier otro empleado —un
// colaborador con el rol `contenido`, o alguien de recepción que además lleve la
// web— el administrador le marca qué apartados puede tocar. Se guardan en
// usuarios.permisos_web como un objeto { catalogo: true, precios: false, ... }.
//
// Se leen de la base en CADA petición (no viajan en el token): si el dueño le
// quita un permiso a alguien, deja de valer en ese mismo momento, sin esperar a
// que esa persona cierre sesión.

const { pool } = require('../db/pool');
const { fail } = require('./responder');

// El orden es el de las casillas en el panel.
const PERMISOS_WEB = [
  { id: 'catalogo', nombre: 'Catálogo de motos', descripcion: 'Agregar y editar motos, fotos y unidades por sede, marcar vendidas.' },
  { id: 'precios', nombre: 'Cambiar precios', descripcion: 'Aparte del catálogo: sin esto puede editar una moto pero no su precio.' },
  { id: 'promo', nombre: 'Promociones y ofertas', descripcion: 'El aviso emergente de la página de inicio y las ofertas de la página Repuestos.' },
  { id: 'consultas', nombre: 'Consultas del sitio', descripcion: 'Ver y atender lo que la gente pide desde el sitio: cotizaciones, contacto y repuestos.' },
  { id: 'resenas', nombre: 'Reseñas de clientes', descripcion: 'Aprobar, ocultar o borrar las reseñas que la gente deja en el sitio. Lo que aprueba se ve en el sitio en ese momento, sin pasar por Publicar.' },
  { id: 'paginas', nombre: 'Galería y preguntas frecuentes', descripcion: 'Las fotos del taller y las respuestas a las preguntas que más hacen los clientes.' },
  { id: 'negocio', nombre: 'Datos del negocio', descripcion: 'Teléfonos, WhatsApp y dirección de cada sede, horario, correo y redes sociales. Por lo general, solo el dueño.' },
  { id: 'publicar', nombre: 'Publicar', descripcion: 'Llevar los cambios al sitio real. Sin esto, sus cambios quedan pendientes hasta que el administrador los publique.' },
];
const IDS = PERMISOS_WEB.map((p) => p.id);

// Deja solo permisos conocidos y en true. Acepta el objeto del formulario, un
// JSON en texto (como sale de la base) o nada.
function normalizarPermisos(valor) {
  let obj = valor;
  if (typeof obj === 'string') {
    try { obj = JSON.parse(obj); } catch { obj = null; }
  }
  const limpio = {};
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
    for (const id of IDS) if (obj[id] === true) limpio[id] = true;
  }
  return limpio;
}

// ¿Este usuario (con su rol y sus permisos ya normalizados) puede `permiso`?
function puede(rol, permisos, permiso) {
  if (rol === 'admin') return true;
  return Boolean(permisos && permisos[permiso] === true);
}

// ¿Tiene acceso a la sección "Sitio web" del todo? (algún permiso marcado)
function tieneAlguno(rol, permisos) {
  return rol === 'admin' || IDS.some((id) => puede(rol, permisos, id));
}

async function permisosDe(usuarioId) {
  const [[fila]] = await pool.query('SELECT rol, activo, permisos_web FROM usuarios WHERE id = ?', [usuarioId]);
  if (!fila || !fila.activo) return null;
  return { rol: fila.rol, permisos: normalizarPermisos(fila.permisos_web) };
}

// Middleware: exige un permiso web. Sin argumento, alcanza con tener alguno
// (para las lecturas de la sección). Deja los permisos en req.permisosWeb para
// que la ruta decida cosas finas (por ejemplo, si puede tocar el precio).
function requierePermisoWeb(permiso) {
  return async (req, res, next) => {
    try {
      const datos = await permisosDe(req.usuario.id);
      const ok = datos && (permiso ? puede(datos.rol, datos.permisos, permiso) : tieneAlguno(datos.rol, datos.permisos));
      if (!ok) return res.status(403).json({ error: 'No tienes permiso para esta parte del sitio web' });
      req.permisosWeb = { rol: datos.rol, permisos: datos.permisos, puede: (p) => puede(datos.rol, datos.permisos, p) };
      next();
    } catch (err) {
      fail(res, err);
    }
  };
}

module.exports = { PERMISOS_WEB, normalizarPermisos, puede, tieneAlguno, requierePermisoWeb };
