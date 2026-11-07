// Textos del portal que escribe el taller (Configuración → Textos del portal), en
// configuracion.portal_textos:
//   bienvenida   { titulo, texto }: un aviso arriba en el inicio del portal (vacío = no sale);
//   condiciones  [{ titulo, texto }]: las secciones de "Términos y condiciones"
//                (vacío = las de fábrica, en el frontend: shared/textos-legales.ts);
//   condiciones_actualizado  'YYYY-MM-DD': se pone solo al cambiar las condiciones.
// La política de privacidad no se edita acá: su contacto ya sale de Configuración.

const MAX_SECCIONES = 20;
const LIMITES = { bienvenidaTitulo: 80, bienvenidaTexto: 500, seccionTitulo: 100, seccionTexto: 2000 };

const recortar = (v, max) => String(v ?? '').trim().slice(0, max);

function normalizarTextosPortal(valor) {
  let v = valor;
  if (typeof v === 'string') {
    try { v = JSON.parse(v); } catch { v = null; }
  }
  const out = { bienvenida: { titulo: '', texto: '' }, condiciones: [], condiciones_actualizado: null };
  if (!v || typeof v !== 'object') return out;
  const b = v.bienvenida || {};
  out.bienvenida = { titulo: recortar(b.titulo, LIMITES.bienvenidaTitulo), texto: recortar(b.texto, LIMITES.bienvenidaTexto) };
  out.condiciones = (Array.isArray(v.condiciones) ? v.condiciones : [])
    .map((s) => ({ titulo: recortar(s?.titulo, LIMITES.seccionTitulo), texto: recortar(s?.texto, LIMITES.seccionTexto) }))
    .filter((s) => s.titulo && s.texto)
    .slice(0, MAX_SECCIONES);
  out.condiciones_actualizado = /^\d{4}-\d{2}-\d{2}$/.test(String(v.condiciones_actualizado || '')) ? v.condiciones_actualizado : null;
  return out;
}

// Lo que se guarda: lo nuevo, con la fecha de las condiciones al día si cambiaron.
function textosParaGuardar(nuevo, anterior, hoy) {
  const n = normalizarTextosPortal(nuevo);
  const a = normalizarTextosPortal(anterior);
  const cambiaron = JSON.stringify(n.condiciones) !== JSON.stringify(a.condiciones);
  n.condiciones_actualizado = !n.condiciones.length ? null : (cambiaron ? hoy : a.condiciones_actualizado || hoy);
  return n;
}

module.exports = { normalizarTextosPortal, textosParaGuardar, LIMITES, MAX_SECCIONES };
