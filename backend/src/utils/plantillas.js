// Mensajes al cliente que el taller puede reescribir (Configuración → Mensajes al
// cliente). Se guardan solo los cambiados, en configuracion.plantillas:
//   { whatsapp: { <clave>: texto }, correo: { listo|entregado: { titulo, mensaje } } }
// Los de WhatsApp de fábrica viven en el frontend (shared/whatsapp.util.ts), que es
// donde se arman; los de correo, acá.
//
// Un texto lleva datos entre llaves: {nombre}, {moto}… Lo que va entre corchetes solo
// sale si todos sus datos tienen valor: "listo[ por {total}]" queda "listo" sin total.
// La misma regla está en shared/whatsapp.util.ts (rellenar): si se cambia una, la otra.

const CORREO_FABRICA = {
  listo: { titulo: 'Tu moto está lista', mensaje: '{moto} ya está lista para entrega. Puedes pasar a retirarla.' },
  entregado: { titulo: 'Servicio entregado', mensaje: '{moto} fue entregada. ¡Gracias por tu visita!' },
};

const MAX_WHATSAPP = 700;
const MAX_TITULO = 120;
const MAX_MENSAJE = 500;
const CLAVE = /^[a-z_]{3,30}$/;

function rellenar(texto, datos = {}) {
  const valor = (k) => {
    const v = datos[k];
    return v === undefined || v === null ? '' : String(v).trim();
  };
  return String(texto || '')
    .replace(/\[([^\[\]]*)\]/g, (_, trozo) => {
      const usados = [...trozo.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
      return usados.every((k) => valor(k)) ? trozo : '';
    })
    .replace(/\{(\w+)\}/g, (_, k) => valor(k))
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

// Lo guardado, normalizado: lo que no sirve se descarta en vez de romper un envío.
function normalizarPlantillas(valor) {
  let v = valor;
  if (typeof v === 'string') {
    try { v = JSON.parse(v); } catch { v = null; }
  }
  const out = { whatsapp: {}, correo: {} };
  if (!v || typeof v !== 'object') return out;
  for (const [k, t] of Object.entries(v.whatsapp || {})) {
    const texto = String(t ?? '').trim().slice(0, MAX_WHATSAPP);
    if (CLAVE.test(k) && texto) out.whatsapp[k] = texto;
  }
  for (const k of Object.keys(CORREO_FABRICA)) {
    const c = (v.correo || {})[k];
    if (!c || typeof c !== 'object') continue;
    const titulo = String(c.titulo ?? '').trim().slice(0, MAX_TITULO);
    const mensaje = String(c.mensaje ?? '').trim().slice(0, MAX_MENSAJE);
    if (titulo || mensaje) out.correo[k] = { ...(titulo ? { titulo } : {}), ...(mensaje ? { mensaje } : {}) };
  }
  return out;
}

// El correo de un hito (listo | entregado) con lo del taller encima de lo de fábrica.
function correoDeHito(estado, plantillas, datos) {
  const fabrica = CORREO_FABRICA[estado];
  if (!fabrica) return null;
  const propio = normalizarPlantillas(plantillas).correo[estado] || {};
  return {
    titulo: rellenar(propio.titulo || fabrica.titulo, datos),
    mensaje: rellenar(propio.mensaje || fabrica.mensaje, datos),
  };
}

module.exports = { CORREO_FABRICA, rellenar, normalizarPlantillas, correoDeHito, MAX_WHATSAPP };
