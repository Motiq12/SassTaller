// Contenido del sitio web (msmotors-web): validación de lo que llega del panel,
// armado de lo que se publica y comparación con lo último publicado.
//
// Funciones puras, sin base de datos: las usa routes/web.routes.js y se prueban
// en test/contenido-web.test.js.
//
// LO QUE SE PUBLICA tiene la misma forma que motos.config.js y promo.config.js
// del sitio, a propósito: así build.js puede usar lo publicado en lugar de esos
// archivos sin cambiar nada más.

const { fechaLocalISO } = require('./fecha');

// Categorías del catálogo. Son las del sitio (motos.config.js → tipos), en el
// orden de los botones del filtro.
// Categorías del catálogo con las que arranca el sitio. El taller puede
// agregar, renombrar y reordenar las suyas desde el panel (web_ajustes 'tipos');
// estas quedan como punto de partida.
const TIPOS = [
  { id: 'scooter', nombre: 'Scooter' },
  { id: 'deportiva', nombre: 'Deportiva' },
  { id: 'doble', nombre: 'Doble propósito' },
  { id: 'alta', nombre: 'Alta cilindrada' },
  { id: 'utilitaria', nombre: 'Utilitaria' },
  { id: 'atv', nombre: 'ATV' },
];
const TIPOS_IDS = TIPOS.map((t) => t.id);

// Igual que slugify de build.js: "Cañas" → "canas", "Modelo Urbana 150" → "modelo-urbana-150".
const slugify = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

// 1150000, 'CRC' → "₡1.150.000"; 4650, 'USD' → "$4,650" (como escribe los precios el sitio).
function formatoPrecio(monto, moneda) {
  if (monto === null || monto === undefined || monto === '') return 'Consultar precio';
  const n = Math.round(Number(monto));
  const miles = String(n).replace(/\B(?=(\d{3})+(?!\d))/g, moneda === 'USD' ? ',' : '.');
  return (moneda === 'USD' ? '$' : '₡') + miles;
}

const parseJson = (texto, porDefecto) => {
  if (texto === null || texto === undefined || texto === '') return porDefecto;
  if (typeof texto === 'object') return texto;
  try { return JSON.parse(texto); } catch { return porDefecto; }
};

const LIMITES = { nombre: 120, resumen: 200, descripcion: 3000, foto: 500, fotoAlt: 200, specClave: 40, specValor: 120, specs: 20 };
const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;
const URL_RE = /^https:\/\/[^\s"'<>]+$/i;
// Una foto subida desde el panel: /api/sitio/fotos/<clave de 24>.<ext>
const FOTO_PROPIA_RE = /^\/api\/sitio\/fotos\/[a-f0-9]{24}\.(jpg|png|webp)$/;
const fotoValida = (v) => (URL_RE.test(v) || FOTO_PROPIA_RE.test(v)) && v.length <= LIMITES.foto;
const MAX_FOTOS = 12;

const texto = (v) => (v === null || v === undefined ? '' : String(v).trim());

// Valida una moto que llega del panel. `sucursalesIds` son los ids de las
// sucursales activas (el stock solo puede ir a esas). Devuelve { error } o
// { datos } con los valores listos para guardar.
function validarMoto(body, sucursalesIds, tiposIds) {
  const b = body || {};
  const nombre = texto(b.nombre);
  if (!nombre) return { error: 'El nombre de la moto es obligatorio' };
  if (nombre.length > LIMITES.nombre) return { error: `El nombre admite hasta ${LIMITES.nombre} caracteres` };

  const tipo = texto(b.tipo);
  if (!(tiposIds && tiposIds.length ? tiposIds : TIPOS_IDS).includes(tipo)) return { error: 'Elige una categoría válida' };

  const estado = b.estado === 'usada' ? 'usada' : b.estado === 'nueva' || b.estado === undefined ? 'nueva' : null;
  if (!estado) return { error: 'El estado debe ser nueva o usada' };

  let precio = null;
  if (b.precio !== null && b.precio !== undefined && b.precio !== '') {
    precio = Number(b.precio);
    if (!Number.isFinite(precio) || precio < 0 || precio > 9999999999) return { error: 'El precio no es válido' };
    precio = Math.round(precio * 100) / 100;
  }
  const moneda = b.moneda === 'USD' ? 'USD' : 'CRC';

  const resumen = texto(b.resumen);
  if (resumen.length > LIMITES.resumen) return { error: `El resumen admite hasta ${LIMITES.resumen} caracteres` };
  const descripcion = texto(b.descripcion);
  if (descripcion.length > LIMITES.descripcion) return { error: `La descripción admite hasta ${LIMITES.descripcion} caracteres` };

  // Fotos: lista ordenada, la primera es la principal. Si llega solo `foto`
  // (como antes de que hubiera varias), vale como lista de una.
  const listaFotos = (Array.isArray(b.fotos) ? b.fotos : [b.foto]).map(texto).filter(Boolean);
  if (listaFotos.length > MAX_FOTOS) return { error: `Hasta ${MAX_FOTOS} fotos por moto` };
  if (listaFotos.some((f) => !fotoValida(f))) {
    return { error: 'Cada foto debe ser una subida desde el panel o una dirección que empiece con https://' };
  }
  const fotos = [...new Set(listaFotos)];
  const foto = fotos[0] || '';
  const fotoAlt = texto(b.foto_alt);
  if (fotoAlt.length > LIMITES.fotoAlt) return { error: `La descripción de la foto admite hasta ${LIMITES.fotoAlt} caracteres` };

  // Datos técnicos: llegan como lista [{ clave, valor }] para conservar el orden
  // en que se escribieron (es el orden en que salen en la página de la moto).
  const specs = {};
  const lista = Array.isArray(b.specs) ? b.specs : [];
  for (const fila of lista) {
    const clave = texto(fila && fila.clave);
    const valor = texto(fila && fila.valor);
    if (!clave && !valor) continue;
    if (!clave || !valor) return { error: 'Cada dato técnico necesita nombre y valor' };
    if (clave.length > LIMITES.specClave || valor.length > LIMITES.specValor) {
      return { error: `Los datos técnicos admiten hasta ${LIMITES.specClave} caracteres de nombre y ${LIMITES.specValor} de valor` };
    }
    if (specs[clave] !== undefined) return { error: `El dato "${clave}" está repetido` };
    specs[clave] = valor;
  }
  if (Object.keys(specs).length > LIMITES.specs) return { error: `Hasta ${LIMITES.specs} datos técnicos por moto` };

  // Unidades por sucursal: { "1": 3, "2": 0 }. Solo sucursales activas.
  const stock = {};
  const s = b.stock && typeof b.stock === 'object' ? b.stock : {};
  for (const [id, cant] of Object.entries(s)) {
    if (cant === '' || cant === null || cant === undefined) continue;
    const n = Number(cant);
    if (!sucursalesIds.includes(Number(id))) return { error: 'Una de las sucursales no existe' };
    if (!Number.isInteger(n) || n < 0 || n > 999) return { error: 'Las unidades deben ser un número entero entre 0 y 999' };
    stock[String(Number(id))] = n;
  }

  const ingreso = texto(b.ingreso);
  if (ingreso && !FECHA_RE.test(ingreso)) return { error: 'La fecha de ingreso no es válida' };

  return {
    datos: {
      nombre, tipo, estado, precio, moneda, resumen, descripcion, foto, fotos, foto_alt: fotoAlt,
      specs, stock, ingreso: ingreso || null,
      visible: b.visible === false || b.visible === 0 ? 0 : 1,
      // Elegida a mano para la tira "Nuevo ingreso" del inicio (ver validarInicio).
      destacada: b.destacada === true || b.destacada === 1 ? 1 : 0,
    },
  };
}

// ── Categorías del catálogo ──
// Las define el taller (web_ajustes 'tipos'). El `id` de cada una se arma del
// nombre al crearla y NO vuelve a cambiar: va en la dirección del catálogo
// filtrado (motos.html#tipo=scooter) y en la ruta de cada moto, así que
// cambiarlo rompería enlaces que ya andan dando vueltas. Renombrar una
// categoría solo cambia lo que se lee.
const MAX_TIPOS = 20;

function validarTipos(body, tiposActuales) {
  const lista = Array.isArray(body && body.tipos) ? body.tipos : null;
  if (!lista) return { error: 'Faltan las categorías' };
  if (!lista.length) return { error: 'Deja al menos una categoría: el catálogo se agrupa por ellas' };
  if (lista.length > MAX_TIPOS) return { error: `Hasta ${MAX_TIPOS} categorías` };

  const conocidos = new Set((tiposActuales || []).map((t) => t.id));
  const tipos = [];
  const vistos = new Set();
  for (const t of lista) {
    const nombre = texto(t && t.nombre);
    if (!nombre) return { error: 'Cada categoría necesita un nombre' };
    if (nombre.length > 40) return { error: 'El nombre de la categoría admite hasta 40 caracteres' };
    // Una que ya existe conserva su id; una nueva lo saca de su nombre.
    const previo = texto(t && t.id);
    let id = previo && conocidos.has(previo) ? previo : slugify(nombre).slice(0, 30);
    if (!id) return { error: `"${nombre}" no sirve como nombre de categoría` };
    if (vistos.has(id)) return { error: `Hay dos categorías que se llaman parecido ("${nombre}"): ponles nombres distintos` };
    vistos.add(id);
    tipos.push({ id, nombre });
  }
  return { datos: { tipos } };
}

// ── Galería del sitio ──
// Las fotos del taller (web_ajustes 'galeria'), en el orden en que se ven.
// `etiqueta` es el rótulo que el sitio pone sobre la foto ("Motos", "Pintura");
// `alt` es lo que leen los buscadores y quien usa lector de pantalla.
const MAX_GALERIA = 80;

function validarGaleria(body) {
  const lista = Array.isArray(body && body.fotos) ? body.fotos : null;
  if (!lista) return { error: 'Faltan las fotos' };
  if (lista.length > MAX_GALERIA) return { error: `Hasta ${MAX_GALERIA} fotos en la galería` };
  const fotos = [];
  for (const f of lista) {
    const url = texto(f && f.url);
    if (!url) continue;
    if (!fotoValida(url)) return { error: 'Cada foto debe ser una subida desde el panel o una dirección que empiece con https://' };
    const alt = texto(f && f.alt);
    const etiqueta = texto(f && f.etiqueta);
    if (alt.length > 200) return { error: 'La descripción de la foto admite hasta 200 caracteres' };
    if (etiqueta.length > 40) return { error: 'El rótulo admite hasta 40 caracteres' };
    fotos.push({ url, alt, etiqueta });
  }
  return { datos: { fotos } };
}

// ── Ofertas (página Repuestos) ──
// Las imágenes de ofertas que el taller ya diseña para redes (web_ajustes
// 'ofertas'), en el orden en que se ven. `nombre` va escrito debajo de la
// imagen y es lo único que Google lee de ella; `precio` es texto libre
// ("₡14.500", "2x1") y opcional, porque la imagen ya lo trae; `hasta` es el
// último día que sale (vacío = hasta que la quiten). Las vencidas se publican
// igual y el sitio no las muestra: así una que vence no deja un cambio
// pendiente en "Publicar".
// El taller pidió que no tuviera límite (oct. 2026): 100 es un tope solo para
// que nadie mande una lista sin fin. El sitio muestra 8 y el resto con "Ver todas".
const MAX_OFERTAS = 100;

function validarOfertas(body) {
  const lista = Array.isArray(body && body.ofertas) ? body.ofertas : null;
  if (!lista) return { error: 'Faltan las ofertas' };
  if (lista.length > MAX_OFERTAS) return { error: `Hasta ${MAX_OFERTAS} ofertas a la vez` };
  const ofertas = [];
  for (const o of lista) {
    const url = texto(o && o.url);
    if (!url) continue;
    if (!fotoValida(url)) return { error: 'Cada imagen debe ser una subida desde el panel o una dirección que empiece con https://' };
    const nombre = texto(o && o.nombre);
    const precio = texto(o && o.precio);
    const hasta = texto(o && o.hasta);
    if (!nombre) return { error: 'Cada oferta necesita un nombre (por ejemplo "Espejos alerón tornasol"): es lo que lee Google' };
    if (nombre.length > 80) return { error: 'El nombre de la oferta admite hasta 80 caracteres' };
    if (precio.length > 30) return { error: 'El precio admite hasta 30 caracteres' };
    if (hasta && !FECHA_RE.test(hasta)) return { error: `La fecha de "${nombre}" no es válida` };
    ofertas.push({ url, nombre, precio, hasta });
  }
  return { datos: { ofertas } };
}

// ── Preguntas frecuentes ──
// Grupos con preguntas (web_ajustes 'faq'). En una respuesta, `[texto](destino)`
// se vuelve un enlace: así se puede mandar a otra página del sitio sin que el
// taller tenga que escribir HTML.
const MAX_FAQ_GRUPOS = 12;
const MAX_FAQ_PREGUNTAS = 30;

function validarFaq(body) {
  const lista = Array.isArray(body && body.grupos) ? body.grupos : null;
  if (!lista) return { error: 'Faltan las preguntas' };
  if (lista.length > MAX_FAQ_GRUPOS) return { error: `Hasta ${MAX_FAQ_GRUPOS} grupos de preguntas` };
  const grupos = [];
  let total = 0;
  for (const g of lista) {
    const nombre = texto(g && g.grupo);
    const preguntas = [];
    for (const q of Array.isArray(g && g.preguntas) ? g.preguntas : []) {
      const p = texto(q && q.p);
      // La respuesta llega como un texto; los párrafos se separan con una línea en blanco.
      const cuerpo = texto(q && (Array.isArray(q.r) ? q.r.join('\n\n') : q.r));
      if (!p && !cuerpo) continue;
      if (!p) return { error: 'Hay una respuesta sin su pregunta' };
      if (!cuerpo) return { error: `"${p}" no tiene respuesta` };
      if (p.length > 200) return { error: 'Una pregunta admite hasta 200 caracteres' };
      if (cuerpo.length > 2000) return { error: 'Una respuesta admite hasta 2000 caracteres' };
      preguntas.push({ p, r: cuerpo.split(/\n{2,}/).map((x) => x.trim()).filter(Boolean) });
      total++;
    }
    if (!preguntas.length) continue;
    if (!nombre) return { error: 'Cada grupo de preguntas necesita un título' };
    if (nombre.length > 60) return { error: 'El título del grupo admite hasta 60 caracteres' };
    grupos.push({ grupo: nombre, preguntas });
  }
  if (total > MAX_FAQ_PREGUNTAS) return { error: `Hasta ${MAX_FAQ_PREGUNTAS} preguntas en total` };
  return { datos: { grupos } };
}

// ── La página «Nosotros» ──
// Guardada en web_ajustes ('nosotros'): el título, la historia del taller en
// párrafos, hasta 4 cifras y la foto del equipo o del local.
//
// Las cifras («+12 años de experiencia») son lo más delicado de esta página: un
// cliente las lee como una promesa del negocio. Las que el sitio trae escritas
// hoy son de ejemplo, así que se pueden apagar enteras — mejor ninguna cifra
// que una inventada.
const MAX_NOSOTROS_PARRAFOS = 6;
const MAX_NOSOTROS_CIFRAS = 4;

function validarNosotros(body) {
  const b = body || {};
  const titulo = texto(b.titulo);
  if (titulo.length > 120) return { error: 'El título admite hasta 120 caracteres' };

  // La historia se escribe como un texto corrido; una línea en blanco separa
  // párrafos, igual que en las preguntas frecuentes.
  const crudo = texto(Array.isArray(b.historia) ? b.historia.join('\n\n') : b.historia);
  if (crudo.length > 3000) return { error: 'La historia admite hasta 3000 caracteres' };
  const historia = crudo.split(/\n{2,}/).map((x) => x.trim()).filter(Boolean);
  if (historia.length > MAX_NOSOTROS_PARRAFOS) {
    return { error: `Hasta ${MAX_NOSOTROS_PARRAFOS} párrafos: separa con una línea en blanco` };
  }

  const cifras = [];
  for (const c of Array.isArray(b.cifras) ? b.cifras : []) {
    const valor = texto(c && c.valor);
    const etiqueta = texto(c && c.etiqueta);
    if (!valor && !etiqueta) continue;
    // Una cifra a medias sale fea y confunde: o va completa, o no va.
    if (!valor) return { error: `"${etiqueta}" no tiene número` };
    if (!etiqueta) return { error: `El número "${valor}" no dice de qué es` };
    if (valor.length > 10) return { error: 'El número admite hasta 10 caracteres (por ejemplo "+12" o "2K")' };
    if (etiqueta.length > 40) return { error: 'La etiqueta de la cifra admite hasta 40 caracteres' };
    cifras.push({ valor, etiqueta });
  }
  if (cifras.length > MAX_NOSOTROS_CIFRAS) return { error: `Hasta ${MAX_NOSOTROS_CIFRAS} cifras` };

  const url = texto(b.foto && b.foto.url);
  if (url && !fotoValida(url)) {
    return { error: 'La foto debe ser una subida desde el panel o una dirección que empiece con https://' };
  }
  const fotoAlt = texto(b.foto && b.foto.alt);
  if (fotoAlt.length > 200) return { error: 'La descripción de la foto admite hasta 200 caracteres' };

  return { datos: { titulo, historia, cifras, foto: url ? { url, alt: fotoAlt } : null } };
}

// Lo que se publica de «Nosotros». Si no hay ni título ni historia ni foto, el
// sitio se queda con lo que trae escrito: la página nunca queda a medias.
function nosotrosParaSitio(n) {
  if (!n) return null;
  const tiene = texto(n.titulo) || (Array.isArray(n.historia) && n.historia.length) || (n.foto && n.foto.url);
  if (!tiene) return null;
  return {
    titulo: texto(n.titulo),
    historia: Array.isArray(n.historia) ? n.historia : [],
    cifras: Array.isArray(n.cifras) ? n.cifras : [],
    foto: n.foto && n.foto.url ? n.foto : null,
  };
}

// ── Financiamiento ──
// Mientras esté apagado el sitio no lo menciona en ninguna parte. Encendido,
// todo tiene que estar completo: una cuota mal calculada en la web es una
// promesa que el cliente trae impresa.
function validarFinanciamiento(body) {
  const b = body || {};
  const activo = b.activo === true;
  const entidad = texto(b.entidad);
  const nota = texto(b.nota) || 'Cuota aproximada. El monto final depende del análisis de crédito.';
  const numero = (v) => (v === '' || v === null || v === undefined ? null : Number(v));
  const tasaAnual = numero(b.tasaAnual);
  const primaMinima = numero(b.primaMinima);
  const plazos = (Array.isArray(b.plazos) ? b.plazos : [])
    .map((n) => Number(n))
    .filter((n) => Number.isInteger(n) && n > 0 && n <= 120)
    .sort((x, y) => x - y)
    .filter((n, i, a) => a.indexOf(n) === i);
  const plazoInicial = numero(b.plazoInicial);
  const aplicaA = b.aplicaA === 'nuevas' ? 'nuevas' : 'todas';
  const requisitos = {
    asalariado: (Array.isArray(b.requisitos && b.requisitos.asalariado) ? b.requisitos.asalariado : []).map(texto).filter(Boolean),
    independiente: (Array.isArray(b.requisitos && b.requisitos.independiente) ? b.requisitos.independiente : []).map(texto).filter(Boolean),
  };

  if (entidad.length > 80) return { error: 'El nombre de quien financia admite hasta 80 caracteres' };
  if (nota.length > 300) return { error: 'La nota admite hasta 300 caracteres' };
  if (tasaAnual !== null && (!Number.isFinite(tasaAnual) || tasaAnual < 0 || tasaAnual > 200)) {
    return { error: 'La tasa anual tiene que ser un número entre 0 y 200' };
  }
  if (primaMinima !== null && (!Number.isFinite(primaMinima) || primaMinima < 0 || primaMinima > 100)) {
    return { error: 'La prima mínima es un porcentaje entre 0 y 100' };
  }
  if (activo) {
    if (!entidad) return { error: 'Para encenderlo hace falta decir quién financia' };
    if (tasaAnual === null) return { error: 'Falta la tasa de interés anual' };
    if (primaMinima === null) return { error: 'Falta la prima mínima' };
    if (!plazos.length) return { error: 'Falta al menos un plazo en meses' };
    if (plazoInicial !== null && !plazos.includes(plazoInicial)) {
      return { error: 'El plazo con el que arranca la calculadora tiene que estar entre los plazos ofrecidos' };
    }
  }
  return {
    datos: {
      activo, entidad, tasaAnual, primaMinima, plazos,
      plazoInicial: plazos.includes(plazoInicial) ? plazoInicial : plazos[0] ?? null,
      aplicaA, requisitos, nota,
    },
  };
}

// ── Servicios del taller en el sitio ──
// Los NOMBRES salen del sistema (tabla `servicios`): así el sitio nunca ofrece
// algo que el portal no deja agendar, ni se queda con un nombre viejo. Aquí solo
// se guarda lo que el sitio cuenta de cada uno.
const MAX_GRUPOS_SERVICIO = 8;

// Los dibujos que el sitio sabe dibujar (ICONOS_SERVICIO en su build.js).
const ICONOS_SERVICIO = [
  { id: 'gota', nombre: 'Gota (aceite, líquidos)' },
  { id: 'escudo', nombre: 'Escudo (revisión, prevención)' },
  { id: 'engranaje', nombre: 'Engranaje (motor, afinamiento)' },
  { id: 'disco', nombre: 'Disco (frenos)' },
  { id: 'cadena', nombre: 'Cadena (transmisión)' },
  { id: 'llanta', nombre: 'Llanta (neumáticos)' },
  { id: 'escaner', nombre: 'Escáner (diagnóstico)' },
  { id: 'rayo', nombre: 'Rayo (eléctrico, batería)' },
  { id: 'lista', nombre: 'Lista (otros)' },
];
const ICONOS_IDS = ICONOS_SERVICIO.map((i) => i.id);

// Un dibujo que pegue con el nombre, para no obligar a elegirlo uno por uno.
function iconoSugerido(nombre) {
  const n = String(nombre || '').toLowerCase();
  if (/aceite|filtro|l[ií]quido|refrigerante/.test(n)) return 'gota';
  if (/freno|pastilla|disco/.test(n)) return 'disco';
  if (/cadena|kit|transmisi[óo]n|sprocket/.test(n)) return 'cadena';
  if (/llanta|neum[áa]tico|rueda|balanceo/.test(n)) return 'llanta';
  if (/diagn[óo]stico|esc[áa]ner|falla/.test(n)) return 'escaner';
  if (/el[ée]ctric|bater[íi]a|luz|luces|arranque/.test(n)) return 'rayo';
  if (/afinamiento|motor|carburador|inyecci[óo]n/.test(n)) return 'engranaje';
  if (/preventivo|revisi[óo]n|mantenimiento|general/.test(n)) return 'escudo';
  return 'lista';
}

function validarServicios(body) {
  const b = body || {};
  const grupos = [];
  for (const g of Array.isArray(b.grupos) ? b.grupos : []) {
    const nombre = texto(g && g.nombre);
    if (!nombre) continue;
    if (nombre.length > 60) return { error: 'El nombre del grupo admite hasta 60 caracteres' };
    const descripcion = texto(g && g.descripcion);
    if (descripcion.length > 200) return { error: 'La descripción del grupo admite hasta 200 caracteres' };
    const id = texto(g && g.id) || slugify(nombre).slice(0, 30);
    if (grupos.some((x) => x.id === id)) return { error: `Hay dos grupos que se llaman parecido ("${nombre}")` };
    grupos.push({ id, nombre, descripcion });
  }
  if (grupos.length > MAX_GRUPOS_SERVICIO) return { error: `Hasta ${MAX_GRUPOS_SERVICIO} grupos de servicios` };

  const textos = {};
  const entrada = b.textos && typeof b.textos === 'object' ? b.textos : {};
  for (const [servicioId, t] of Object.entries(entrada)) {
    const resumen = texto(t && t.resumen);
    const cuando = texto(t && t.cuando);
    if (resumen.length > 200) return { error: 'El resumen de un servicio admite hasta 200 caracteres' };
    if (cuando.length > 200) return { error: 'El "cada cuánto" admite hasta 200 caracteres' };
    const incluye = (Array.isArray(t && t.incluye) ? t.incluye : []).map(texto).filter(Boolean).slice(0, 10);
    if (incluye.some((x) => x.length > 150)) return { error: 'Cada punto de "qué incluye" admite hasta 150 caracteres' };
    const grupo = texto(t && t.grupo);
    const icono = texto(t && t.icono);
    textos[String(servicioId)] = {
      visible: !(t && t.visible === false),
      icono: ICONOS_IDS.includes(icono) ? icono : '',
      grupo: grupos.some((g) => g.id === grupo) ? grupo : (grupos[0] && grupos[0].id) || '',
      resumen, incluye, cuando,
    };
  }
  return { datos: { grupos, textos } };
}

// Lo que se publica de los servicios: el nombre lo pone el sistema y el texto el
// panel. Un servicio sin texto todavía sale, con el nombre solo.
function serviciosParaSitio(ajuste, serviciosDelSistema) {
  if (!ajuste || !Array.isArray(ajuste.grupos) || !ajuste.grupos.length) return null;
  const textos = ajuste.textos || {};
  const servicios = serviciosDelSistema
    .map((s) => ({ s, t: textos[String(s.id)] || {} }))
    .filter(({ t }) => t.visible !== false)
    .map(({ s, t }) => ({
      id: slugify(s.nombre).slice(0, 40),
      icono: t.icono || iconoSugerido(s.nombre),
      grupo: ajuste.grupos.some((g) => g.id === t.grupo) ? t.grupo : ajuste.grupos[0].id,
      nombre: s.nombre,
      resumen: t.resumen || '',
      incluye: t.incluye || [],
      cuando: t.cuando || '',
    }));
  if (!servicios.length) return null;
  return { grupos: ajuste.grupos, servicios };
}

// ── La tira "Nuevo ingreso" del inicio del sitio ──
// Guardada en web_ajustes ('inicio'). Dos formas de llenarla:
//   automatico  las motos que entraron en los últimos `dias` (por su fecha de
//               ingreso). Se vacía sola, sin que nadie se acuerde de quitarlas.
//   manual      las que el taller marque como destacadas en el catálogo.
const INICIO_POR_DEFECTO = {
  activo: true,
  rotulo: 'Recién llegadas',
  titulo: 'Nuevo ingreso',
  modo: 'automatico',
  dias: 60,
  maximo: 3,
};

function validarInicio(body) {
  const b = (body && body.nuevoIngreso) || body || {};
  const rotulo = texto(b.rotulo) || INICIO_POR_DEFECTO.rotulo;
  const titulo = texto(b.titulo) || INICIO_POR_DEFECTO.titulo;
  if (rotulo.length > 60 || titulo.length > 60) return { error: 'El título admite hasta 60 caracteres' };
  const modo = b.modo === 'manual' ? 'manual' : 'automatico';
  const dias = Number(b.dias);
  if (modo === 'automatico' && (!Number.isInteger(dias) || dias < 1 || dias > 365)) {
    return { error: 'Los días tienen que ser un número entre 1 y 365' };
  }
  const maximo = Number(b.maximo);
  if (!Number.isInteger(maximo) || maximo < 1 || maximo > 12) return { error: 'La cantidad de motos tiene que ser entre 1 y 12' };
  return {
    datos: {
      nuevoIngreso: {
        activo: b.activo !== false,
        rotulo, titulo, modo,
        dias: modo === 'automatico' ? dias : INICIO_POR_DEFECTO.dias,
        maximo,
      },
    },
  };
}

// ── El formulario de cotización del sitio ──
// Guardado en web_ajustes ('formulario'). El taller decide qué le pide a quien
// escribe: cada campo puede ser obligatorio, opcional u oculto. La moto y el
// nombre no se pueden quitar — sin ellos la consulta no sirve de nada.
const CAMPOS_FORMULARIO = [
  { id: 'cedula', nombre: 'Cédula', ayuda: 'Sirve para registrar al cliente en el sistema de una vez.' },
  { id: 'correo', nombre: 'Correo', ayuda: 'Para mandarle la cotización por escrito.' },
  { id: 'telefono', nombre: 'Teléfono', ayuda: 'Es el dato con el que más rápido se contesta (WhatsApp).' },
  { id: 'comentario', nombre: 'Comentario', ayuda: 'Un espacio libre para que cuente qué necesita.' },
];
const ESTADOS_CAMPO = ['obligatorio', 'opcional', 'oculto'];
const FORMULARIO_POR_DEFECTO = {
  titulo: 'Solicitar cotización',
  intro: 'Déjanos tus datos y te enviamos la cotización de la moto que te interesa.',
  boton: 'Enviar solicitud',
  campos: { cedula: 'obligatorio', correo: 'obligatorio', telefono: 'obligatorio', comentario: 'oculto' },
};

function validarFormulario(body) {
  const b = body || {};
  const titulo = texto(b.titulo) || FORMULARIO_POR_DEFECTO.titulo;
  const intro = texto(b.intro);
  const boton = texto(b.boton) || FORMULARIO_POR_DEFECTO.boton;
  if (titulo.length > 60 || boton.length > 40) return { error: 'El título admite 60 caracteres y el botón 40' };
  if (intro.length > 300) return { error: 'El texto de arriba admite hasta 300 caracteres' };
  const campos = {};
  for (const c of CAMPOS_FORMULARIO) {
    const valor = texto(b.campos && b.campos[c.id]);
    campos[c.id] = ESTADOS_CAMPO.includes(valor) ? valor : FORMULARIO_POR_DEFECTO.campos[c.id];
  }
  // Sin teléfono ni correo no habría forma de contestarle a nadie.
  if (campos.telefono === 'oculto' && campos.correo === 'oculto') {
    return { error: 'Deja al menos el teléfono o el correo: sin uno de los dos no hay cómo contestarle a quien escribe' };
  }
  return { datos: { titulo, intro, boton, campos } };
}

// La promoción emergente del inicio (misma forma que promo.config.js).
// ── Varias promociones ──
// Se guardan en web_ajustes ('promos') como { promos: [...] }, en orden de
// prioridad. El sitio muestra UNA a la vez: la primera de la lista que esté
// encendida y cuyas fechas incluyan el día de hoy. Así se pueden dejar listas
// las campañas que vienen (cada una se enciende y se apaga sola por fecha) y
// guardar las viejas para reusarlas.
const MAX_PROMOS = 12;

function validarPromos(body) {
  const lista = Array.isArray(body && body.promos) ? body.promos : null;
  if (!lista) return { error: 'Faltan las promociones' };
  if (lista.length > MAX_PROMOS) return { error: `Hasta ${MAX_PROMOS} promociones` };
  const promos = [];
  const ids = new Set();
  lista.forEach((p, i) => {
    if (promos.error) return;
    const { error, datos } = validarPromo(p);
    if (error) {
      const nombre = texto(p && p.titulo);
      promos.error = lista.length > 1 ? `Promoción ${i + 1}${nombre ? ` («${nombre}»)` : ''}: ${error}` : error;
      return;
    }
    // El sitio recuerda «ya vi este aviso» por id: dos con el mismo id se
    // pisarían, y cerrar una escondería la otra.
    let id = datos.id;
    for (let n = 2; ids.has(id); n++) id = `${datos.id}-${n}`;
    ids.add(id);
    promos.push({ ...datos, id });
  });
  if (promos.error) return { error: promos.error };
  return { datos: { promos } };
}

// La que toca hoy: la primera encendida cuyas fechas incluyen `hoy` (AAAA-MM-DD).
function promoDeHoy(promos, hoy) {
  return (promos || []).find((p) => p && p.activa && (!p.desde || hoy >= p.desde) && (!p.hasta || hoy <= p.hasta)) || null;
}

// "/api/sitio/fotos/0123456789abcdef01234567.webp" → "promo-01234567"
function idDeImagen(url) {
  const nombre = String(url || '').split('/').pop().replace(/\.[a-z0-9]+$/i, '');
  const corto = slugify(nombre).replace(/-/g, '').slice(-8);
  return corto ? `promo-${corto}` : '';
}

function validarPromo(body) {
  const b = body || {};
  const activa = b.activa === true;
  const campos = {
    titulo: [texto(b.titulo), 80],
    destacado: [texto(b.destacado), 120],
    comoParticipar: [texto(b.comoParticipar), 400],
    letraChica: [texto(b.letraChica), 300],
    imagen: [texto(b.imagen), 500],
    imagenAlt: [texto(b.imagenAlt), 200],
  };
  for (const [campo, [valor, max]] of Object.entries(campos)) {
    if (valor.length > max) return { error: `El campo ${campo} admite hasta ${max} caracteres` };
  }
  // "Solo la imagen": el aviso muestra la imagen sola, sin los textos. Ahí el
  // título no se ve, así que es opcional: lo que hace falta es la imagen.
  const soloImagen = b.soloImagen === true;
  if (activa && soloImagen && !campos.imagen[0]) return { error: 'Para mostrar solo la imagen, sube una imagen' };
  if (activa && !soloImagen && !campos.titulo[0]) return { error: 'Para activar la promoción hace falta un título' };
  if (campos.imagen[0] && !fotoValida(campos.imagen[0])) return { error: 'La imagen debe ser una subida desde el panel o una dirección que empiece con https://' };
  const desde = texto(b.desde);
  const hasta = texto(b.hasta);
  if ((desde && !FECHA_RE.test(desde)) || (hasta && !FECHA_RE.test(hasta))) return { error: 'Las fechas no son válidas' };
  if (desde && hasta && desde > hasta) return { error: 'La fecha de inicio es posterior a la de fin' };
  const verCada = ['dia', 'sesion', 'siempre'].includes(b.verCada) ? b.verCada : 'dia';

  const ctaTexto = texto(b.cta && b.cta.texto);
  const ctaHref = texto(b.cta && b.cta.href);
  if (ctaHref && !/^(https:\/\/|[a-z0-9-]+\.html(#.*)?$)/i.test(ctaHref)) {
    return { error: 'El enlace del botón debe ser https://... o una página del sitio (motos.html)' };
  }

  return {
    datos: {
      activa,
      // El id cambia con el título: el sitio recuerda "ya vi esta promo" por id, así
      // que una promo nueva vuelve a mostrarse aunque alguien ya hubiera cerrado la anterior.
      // Sin título (solo la imagen), el id sale de la imagen: otra imagen es otra
      // promoción y vuelve a mostrarse aunque ya hubieran cerrado la anterior.
      id: slugify(campos.titulo[0]) || idDeImagen(campos.imagen[0]) || 'promo',
      desde, hasta, verCada,
      imagen: campos.imagen[0], imagenAlt: campos.imagenAlt[0], soloImagen,
      titulo: campos.titulo[0], destacado: campos.destacado[0],
      comoParticipar: campos.comoParticipar[0], letraChica: campos.letraChica[0],
      cta: ctaTexto && ctaHref ? { texto: ctaTexto, href: ctaHref } : null,
    },
  };
}

// Una consulta que llega desde el sitio (cotizar una moto, contacto, repuestos).
// Hace falta un nombre y alguna forma de contestarle (teléfono o correo).
const TIPOS_CONSULTA = ['cotizacion', 'contacto', 'repuesto'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function validarConsulta(body) {
  const b = body || {};
  const tipo = TIPOS_CONSULTA.includes(b.tipo) ? b.tipo : 'contacto';
  const campos = {
    nombre: [texto(b.nombre), 100],
    telefono: [texto(b.telefono), 30],
    email: [texto(b.email || b.correo), 150],
    moto: [texto(b.moto), 150],
    sucursal: [texto(b.sucursal), 60],
    mensaje: [texto(b.mensaje), 2000],
    cedula: [texto(b.cedula), 20],
  };
  for (const [campo, [valor, max]] of Object.entries(campos)) {
    if (valor.length > max) return { error: `El campo ${campo} es demasiado largo` };
  }
  if (!campos.nombre[0]) return { error: 'Escribe tu nombre' };
  if (campos.cedula[0] && !/^[\d\s-]{9,20}$/.test(campos.cedula[0])) return { error: 'La cédula no parece válida' };
  if (!campos.telefono[0] && !campos.email[0]) return { error: 'Deja un teléfono o un correo para poder contestarte' };
  if (campos.email[0] && !EMAIL_RE.test(campos.email[0])) return { error: 'El correo no parece válido' };
  if (campos.telefono[0] && !/^[\d\s()+-]{7,30}$/.test(campos.telefono[0])) return { error: 'El teléfono no parece válido' };
  const datos = { tipo };
  for (const [campo, [valor]] of Object.entries(campos)) datos[campo] = valor || null;
  return { datos };
}

// Una reseña que llega del sitio: quién la deja, de 1 a 5 estrellas y el
// comentario. El formulario muestra el mensaje de error tal cual. Devuelve
// { error } o { datos }.
const MAX_NOMBRE_RESENA = 100;
const MAX_COMENTARIO_RESENA = 600;
function validarResena(body) {
  const b = body || {};
  const nombre = texto(b.nombre);
  const comentario = texto(b.comentario);
  if (!nombre) return { error: 'Escribe tu nombre' };
  if (nombre.length > MAX_NOMBRE_RESENA) return { error: `El nombre es demasiado largo (máximo ${MAX_NOMBRE_RESENA} caracteres)` };
  if (!comentario) return { error: 'Escribe tu comentario' };
  if (comentario.length > MAX_COMENTARIO_RESENA) return { error: `El comentario es demasiado largo (máximo ${MAX_COMENTARIO_RESENA} caracteres)` };
  // Solo un entero del 1 al 5, llegue como número o como texto: ni 4.5, ni true.
  if (!/^[1-5]$/.test(texto(b.calificacion))) return { error: 'Elige una calificación de 1 a 5 estrellas' };
  // El teléfono es para verificar que quien escribe es cliente del taller: no
  // se publica. Ocho dígitos como mínimo (un número de Costa Rica).
  const telefono = texto(b.telefono);
  if (!telefono) return { error: 'Escribe tu teléfono: lo usamos para verificar que eres cliente (no se publica)' };
  if (!/^[\d\s()+-]{8,20}$/.test(telefono) || telefono.replace(/\D/g, '').length < 8) return { error: 'El teléfono no parece válido' };
  return { datos: { nombre, calificacion: Number(b.calificacion), comentario, telefono } };
}

// ── Datos del negocio que muestra el sitio ──
// Se guardan en web_ajustes ('negocio'), aparte del sistema:
//   { email, whatsapp, redes: { instagram, tiktok, facebook },
//     sedes: { [sucursal_id]: { telefono, whatsapp, direccion, horarios: [7 días] } } }
// `whatsapp` (arriba) es el único número de WhatsApp del sitio: todos los botones
// van ahí. El `whatsapp` de cada sede quedó de antes y el sitio solo lo usa si el
// general está vacío (el de la primera sede).
// El horario va con la misma forma que el de citas del sistema
// ({ dia: 0=domingo…6=sábado, activo, abre, cierra }), para poder compararlos.

const HORA_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const REDES = {
  instagram: /^https:\/\/(www\.)?instagram\.com\/[^\s"'<>]+$/i,
  tiktok: /^https:\/\/(www\.)?tiktok\.com\/@[^\s"'<>]+$/i,
  facebook: /^https:\/\/(www\.|m\.)?(facebook|fb)\.com\/[^\s"'<>]+$/i,
};
const NOMBRE_RED = { instagram: 'Instagram', tiktok: 'TikTok', facebook: 'Facebook' };

const soloDigitos = (v) => String(v || '').replace(/\D/g, '');

// "2666-0000" → { telefono: '+506 2666-0000', telefonoSchema: '+506-2666-0000' }.
// Con otro largo (un número del extranjero) se deja como se escribió.
// Cambia SOLO la foto de una sede, dejando todo lo demás de los datos del
// negocio como está. La usa la pantalla Nosotros, que muestra las fotos de las
// sedes (salen en esa página) sin ser dueña del resto de los datos.
//   negocio: lo guardado en web_ajustes ('negocio'), o null si nunca se guardó.
// Una sede que todavía no tenía nada guardado queda solo con su foto: lo demás
// sigue saliendo como el sitio lo trae.
function conFotoDeSede(negocio, sucursalId, body) {
  const foto = texto(body && body.foto);
  if (foto && !fotoValida(foto)) return { error: 'La foto debe ser una subida desde el panel o una dirección que empiece con https://' };
  const fotoAlt = texto(body && body.foto_alt);
  if (fotoAlt.length > 200) return { error: 'La descripción de la foto admite hasta 200 caracteres' };
  const base = negocio || { email: '', redes: {}, marcas: [], sedes: {} };
  const id = String(Number(sucursalId));
  const sedes = { ...(base.sedes || {}) };
  sedes[id] = { ...(sedes[id] || {}), foto, foto_alt: foto ? fotoAlt : '' };
  return { datos: { ...base, sedes } };
}

function telefonoParaSitio(valor) {
  const d = soloDigitos(valor).replace(/^506(?=\d{8}$)/, '');
  if (d.length === 8) return { telefono: `+506 ${d.slice(0, 4)}-${d.slice(4)}`, telefonoSchema: `+506-${d.slice(0, 4)}-${d.slice(4)}` };
  return { telefono: texto(valor), telefonoSchema: texto(valor) };
}

// WhatsApp como lo usa wa.me: solo dígitos, con el 506 delante si son 8.
const whatsappParaSitio = (valor) => {
  const d = soloDigitos(valor);
  return d.length === 8 ? '506' + d : d;
};

function validarHorario(lista) {
  if (!Array.isArray(lista)) return { horario: null };
  const horario = [];
  for (let dia = 0; dia < 7; dia++) {
    const h = lista.find((x) => x && Number(x.dia) === dia) || {};
    const activo = h.activo === true || h.activo === 1;
    const abre = texto(h.abre) || '08:00';
    const cierra = texto(h.cierra) || '17:00';
    if (activo && (!HORA_RE.test(abre) || !HORA_RE.test(cierra))) return { error: 'Las horas del horario tienen que ser como 08:00' };
    if (activo && abre >= cierra) return { error: 'En el horario, la hora de cierre tiene que ser después de la de apertura' };
    horario.push({ dia, activo: activo ? 1 : 0, abre, cierra });
  }
  return { horario };
}

function validarNegocio(body, sucursalesIds) {
  const b = body || {};
  const email = texto(b.email);
  if (email && !EMAIL_RE.test(email)) return { error: 'El correo no parece válido' };
  const whatsappGeneral = texto(b.whatsapp);
  if (whatsappGeneral && !/^[\d\s()+-]{8,20}$/.test(whatsappGeneral)) return { error: 'El número de WhatsApp del negocio no parece válido' };
  const redes = {};
  for (const red of Object.keys(REDES)) {
    const url = texto(b.redes && b.redes[red]);
    if (url && !REDES[red].test(url)) return { error: `La dirección de ${NOMBRE_RED[red]} no parece válida (tiene que empezar con https://www.${red === 'facebook' ? 'facebook' : red}.com/...)` };
    redes[red] = url;
  }
  // Marcas que distribuye el taller: salen en varios textos del sitio.
  const marcas = (Array.isArray(b.marcas) ? b.marcas : []).map(texto).filter(Boolean).slice(0, 12);
  if (marcas.some((m) => m.length > 40)) return { error: 'El nombre de una marca admite hasta 40 caracteres' };

  const sedes = {};
  const entrada = b.sedes && typeof b.sedes === 'object' ? b.sedes : {};
  for (const [id, s] of Object.entries(entrada)) {
    if (!sucursalesIds.includes(Number(id))) return { error: 'Una de las sedes no existe' };
    const telefono = texto(s && s.telefono);
    const whatsapp = texto(s && s.whatsapp);
    const direccion = texto(s && s.direccion);
    if (telefono && !/^[\d\s()+-]{8,20}$/.test(telefono)) return { error: 'Uno de los teléfonos no parece válido' };
    if (whatsapp && !/^[\d\s()+-]{8,20}$/.test(whatsapp)) return { error: 'Uno de los números de WhatsApp no parece válido' };
    if (direccion.length > 250) return { error: 'La dirección admite hasta 250 caracteres' };
    const { error, horario } = validarHorario(s && s.horarios);
    if (error) return { error };
    // La foto de la sede (sale en «Conoce nuestras sedes»): para que el cliente
    // reconozca el local desde la calle.
    const foto = texto(s && s.foto);
    if (foto && !fotoValida(foto)) return { error: 'La foto de una sede debe ser una subida desde el panel o una dirección que empiece con https://' };
    const fotoAlt = texto(s && s.foto_alt);
    if (fotoAlt.length > 200) return { error: 'La descripción de la foto de una sede admite hasta 200 caracteres' };
    sedes[String(Number(id))] = { telefono, whatsapp, direccion, horarios: horario, foto, foto_alt: fotoAlt };
  }
  return { datos: { email, whatsapp: whatsappGeneral, redes, marcas, sedes } };
}

// El horario de 7 días agrupado en filas como las escribe el sitio: días
// seguidos con la misma hora van juntos ("Lunes a viernes", "Sábado").
const NOMBRE_DIA = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const DIA_SCHEMA = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
function horariosAgrupados(horario) {
  const orden = [1, 2, 3, 4, 5, 6, 0];   // la semana del sitio empieza el lunes
  const filas = [];
  for (const dia of orden) {
    const h = (horario || []).find((x) => Number(x.dia) === dia);
    if (!h || !Number(h.activo)) continue;
    const ultima = filas[filas.length - 1];
    const seguido = ultima && orden.indexOf(ultima.dias[ultima.dias.length - 1]) === orden.indexOf(dia) - 1;
    if (ultima && seguido && ultima.abre === h.abre && ultima.cierra === h.cierra) ultima.dias.push(dia);
    else filas.push({ dias: [dia], abre: h.abre, cierra: h.cierra });
  }
  return filas.map((f) => ({
    dias: f.dias.length === 1
      ? NOMBRE_DIA[f.dias[0]]
      : `${NOMBRE_DIA[f.dias[0]]} a ${NOMBRE_DIA[f.dias[f.dias.length - 1]].toLowerCase()}`,
    dow: f.dias.map((d) => DIA_SCHEMA[d]),
    abre: f.abre,
    cierra: f.cierra,
  }));
}

// Lo que se publica de los datos del negocio: solo lo que está lleno. Lo vacío
// no se publica y el sitio sigue con lo que tenga en site.config.js.
function negocioParaSitio(negocio, sucursales) {
  if (!negocio) return null;
  const sedes = sucursales.map((s) => {
    const d = (negocio.sedes || {})[String(s.id)] || {};
    const sede = { id: slugify(s.nombre), nombre: s.nombre };
    if (d.telefono) Object.assign(sede, telefonoParaSitio(d.telefono));
    if (d.whatsapp) sede.whatsapp = whatsappParaSitio(d.whatsapp);
    if (d.direccion) sede.direccion = d.direccion;
    if (d.foto) {
      sede.foto = d.foto;
      sede.fotoAlt = d.foto_alt || `Sede ${s.nombre} de MS Motos`;
    }
    if (Array.isArray(d.horarios)) {
      const filas = horariosAgrupados(d.horarios);
      if (filas.length) sede.horarios = filas;
    }
    return sede;
  });
  const redes = {};
  for (const [red, url] of Object.entries(negocio.redes || {})) if (url) redes[red] = url;
  return {
    ...(negocio.email ? { email: negocio.email } : {}),
    ...(negocio.whatsapp ? { whatsapp: whatsappParaSitio(negocio.whatsapp) } : {}),
    ...(Array.isArray(negocio.marcas) && negocio.marcas.length ? { marcas: negocio.marcas } : {}),
    redes,
    sedes,
  };
}

// ¿Dicen lo mismo el horario del sitio y el de citas del sistema? Devuelve los
// días que no coinciden, en frases ("Sábado: el sitio dice hasta 5:00 pm, las
// citas solo hasta 1:00 pm").
function diferenciasHorario(sitio, citas) {
  const hora12 = (h) => {
    const [hh, mm] = String(h).split(':').map(Number);
    return `${((hh + 11) % 12) + 1}:${String(mm).padStart(2, '0')} ${hh < 12 ? 'am' : 'pm'}`;
  };
  const frases = [];
  for (let dia = 0; dia < 7; dia++) {
    const a = (sitio || []).find((x) => Number(x.dia) === dia);
    const b = (citas || []).find((x) => Number(x.dia) === dia);
    if (!a || !b) continue;
    const abiertoA = Number(a.activo) === 1;
    const abiertoB = Number(b.activo) === 1;
    if (!abiertoA && !abiertoB) continue;
    if (abiertoA !== abiertoB) {
      frases.push(`${NOMBRE_DIA[dia]}: ${abiertoA ? 'el sitio dice que abren, pero el portal no deja agendar citas' : 'el portal deja agendar citas, pero el sitio dice que está cerrado'}`);
    } else if (a.abre !== b.abre || a.cierra !== b.cierra) {
      frases.push(`${NOMBRE_DIA[dia]}: el sitio dice de ${hora12(a.abre)} a ${hora12(a.cierra)}; las citas del portal, de ${hora12(b.abre)} a ${hora12(b.cierra)}`);
    }
  }
  return frases;
}

// Las fotos de una fila de web_motos (columna `fotos`, o la vieja `foto` sola).
function fotosDe(m) {
  const lista = parseJson(m.fotos, null);
  if (Array.isArray(lista) && lista.length) return lista;
  return m.foto ? [m.foto] : [];
}

// Arma lo que se publica a partir de las filas de la base.
//   filasMotos: web_motos (todas; las ocultas no se publican)
//   sucursales: [{ id, nombre }] activas
//   promo:      objeto guardado en web_ajustes ('promo') o null
// `promos` es la lista de promociones (en orden); `promo`, una sola, es como se
// guardaba antes de que hubiera varias, y vale igual si llega sola.
function armarContenido({ filasMotos, sucursales, promo, promos, negocio, inicio, formulario, tipos, galeria, ofertas, faq, financiamiento, servicios, serviciosSistema, nosotros, hoy = fechaLocalISO() }) {
  const encendidas = (Array.isArray(promos) ? promos : promo ? [promo] : []).filter((p) => p && p.activa);
  const idSitio = new Map(sucursales.map((s) => [String(s.id), slugify(s.nombre)]));
  const motos = filasMotos
    .filter((m) => Number(m.visible) === 1)
    .sort((a, b) => a.orden - b.orden || a.id - b.id)
    .map((m) => {
      const stock = {};
      for (const [id, n] of Object.entries(parseJson(m.stock, {}))) {
        if (idSitio.has(String(id))) stock[idSitio.get(String(id))] = Number(n);
      }
      const ingreso = m.ingreso instanceof Date ? m.ingreso.toISOString().slice(0, 10) : m.ingreso || undefined;
      return {
        id: m.slug,
        slug: m.slug,
        nombre: m.nombre,
        tipo: m.tipo,
        estado: m.estado,
        precio: formatoPrecio(m.precio, m.moneda),
        resumen: m.resumen || '',
        descripcion: m.descripcion || '',
        foto: m.foto || '',
        fotoGrande: m.foto || '',
        // Todas las fotos, la principal primero: la página de la moto las muestra
        // como galería. Solo va si hay más de una.
        ...(fotosDe(m).length > 1 ? { galeria: fotosDe(m) } : {}),
        fotoAlt: m.foto_alt || m.nombre,
        specs: parseJson(m.specs, {}),
        stock,
        ...(ingreso ? { ingreso } : {}),
        ...(Number(m.destacada) === 1 ? { destacada: true } : {}),
      };
    });
  return {
    formato: 1,
    tipos: (tipos && tipos.length) ? tipos : TIPOS,
    sucursales: sucursales.map((s) => ({ id: slugify(s.nombre), nombre: s.nombre })),
    motos,
    // Todas las encendidas, en orden de prioridad: el sitio elige la de cada día
    // en el navegador, así una campaña que empieza mañana sale sola sin publicar.
    promos: encendidas,
    // Una sola, para un sitio que todavía lee `promo`: la que toca hoy, o si no
    // la próxima que no haya vencido.
    promo: promoDeHoy(encendidas, hoy) || encendidas.find((p) => !p.hasta || hoy <= p.hasta) || null,
    negocio: negocioParaSitio(negocio, sucursales),
    inicio: (inicio && inicio.nuevoIngreso) ? inicio : { nuevoIngreso: INICIO_POR_DEFECTO },
    formulario: formulario || FORMULARIO_POR_DEFECTO,
    // null = el sitio se queda con las fotos que ya tiene puestas.
    galeria: galeria && Array.isArray(galeria.fotos) && galeria.fotos.length ? galeria.fotos : null,
    // Lista vacía = la página Repuestos sale sin la sección de ofertas.
    ofertas: ofertas && Array.isArray(ofertas.ofertas) ? ofertas.ofertas : [],
    // null en cualquiera = el sitio se queda con lo que ya trae escrito.
    faq: faq && Array.isArray(faq.grupos) && faq.grupos.length ? faq.grupos : null,
    financiamiento: financiamiento || null,
    servicios: serviciosParaSitio(servicios, serviciosSistema || []),
    nosotros: nosotrosParaSitio(nosotros),
  };
}

// Qué cambió entre lo publicado y lo que se publicaría ahora, en frases que
// entiende el dueño. Lista vacía = no hay nada pendiente.
function diferencias(publicado, actual) {
  const cambios = [];
  const antes = new Map(((publicado && publicado.motos) || []).map((m) => [m.slug, m]));
  const ahora = new Map(((actual && actual.motos) || []).map((m) => [m.slug, m]));
  const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  for (const [slug, m] of ahora) {
    const previa = antes.get(slug);
    if (!previa) { cambios.push(`Moto nueva: ${m.nombre}`); continue; }
    if (previa.precio !== m.precio) cambios.push(`Precio de ${m.nombre}: ${previa.precio} → ${m.precio}`);
    const { precio: _a, ...restoAntes } = previa;
    const { precio: _b, ...restoAhora } = m;
    if (!igual(restoAntes, restoAhora)) cambios.push(`Cambios en ${m.nombre}`);
  }
  for (const [slug, m] of antes) {
    if (!ahora.has(slug)) cambios.push(`Sale del sitio: ${m.nombre}`);
  }
  if (!igual((publicado && publicado.galeria) || null, (actual && actual.galeria) || null)) {
    cambios.push('Galería del sitio actualizada');
  }
  if (!igual((publicado && publicado.ofertas) || [], (actual && actual.ofertas) || [])) {
    const n = ((actual && actual.ofertas) || []).length;
    cambios.push(n ? `Ofertas de Repuestos actualizadas (${n})` : 'Se quitan las ofertas de Repuestos');
  }
  if (!igual((publicado && publicado.faq) || null, (actual && actual.faq) || null)) {
    cambios.push('Preguntas frecuentes actualizadas');
  }
  if (!igual((publicado && publicado.financiamiento) || null, (actual && actual.financiamiento) || null)) {
    const f = actual && actual.financiamiento;
    cambios.push(f && f.activo ? 'Financiamiento encendido o actualizado' : 'Financiamiento apagado');
  }
  if (!igual((publicado && publicado.servicios) || null, (actual && actual.servicios) || null)) {
    cambios.push('Servicios del sitio actualizados');
  }
  if (!igual((publicado && publicado.nosotros) || null, (actual && actual.nosotros) || null)) {
    cambios.push('Página "Nosotros" actualizada');
  }
  if (!igual((publicado && publicado.tipos) || TIPOS, (actual && actual.tipos) || TIPOS)) {
    cambios.push('Categorías del catálogo actualizadas');
  }
  // Lo que todavía no se configuró vale como los valores de fábrica: así la
  // primera publicación no avisa de cosas que nadie tocó.
  if (!igual((publicado && publicado.inicio) || { nuevoIngreso: INICIO_POR_DEFECTO }, actual && actual.inicio)) {
    cambios.push('Tira "Nuevo ingreso" del inicio actualizada');
  }
  if (!igual((publicado && publicado.formulario) || FORMULARIO_POR_DEFECTO, actual && actual.formulario)) {
    cambios.push('Formulario de cotización actualizado');
  }
  if (!igual((publicado && publicado.negocio) || null, (actual && actual.negocio) || null)) {
    cambios.push('Datos del negocio (teléfonos, horario, redes) actualizados');
  }
  // Se compara la LISTA, no `promo`: esa depende del día (la que toca hoy) y
  // marcaría un cambio pendiente cada vez que empieza o termina una campaña.
  // Una publicación de antes de que hubiera varias trae solo `promo`.
  const promosDe = (c) => (!c ? [] : Array.isArray(c.promos) ? c.promos : c.promo ? [c.promo] : []);
  const promosAntes = promosDe(publicado);
  const promosAhora = promosDe(actual);
  if (!igual(promosAntes, promosAhora)) {
    if (!promosAhora.length) cambios.push('Se quita la promoción del inicio');
    else cambios.push(promosAhora.length === 1 ? 'Promoción del inicio actualizada' : `Promociones del inicio actualizadas (${promosAhora.length} encendidas)`);
  }
  // El orden importa en el catálogo: si solo cambió el orden, también es un cambio.
  if (!cambios.length && !igual([...antes.keys()], [...ahora.keys()])) cambios.push('Nuevo orden del catálogo');
  return cambios;
}

module.exports = {
  TIPOS, MAX_TIPOS, validarTipos, MAX_GALERIA, validarGaleria, MAX_OFERTAS, validarOfertas, validarResena,
  validarFaq, validarFinanciamiento, validarServicios, serviciosParaSitio,
  validarNosotros, nosotrosParaSitio, MAX_NOSOTROS_PARRAFOS, MAX_NOSOTROS_CIFRAS,
  MAX_FAQ_GRUPOS, MAX_FAQ_PREGUNTAS, MAX_GRUPOS_SERVICIO, ICONOS_SERVICIO, iconoSugerido, slugify, formatoPrecio, parseJson, fotosDe, validarConsulta, validarMoto, validarPromo, validarPromos, promoDeHoy, MAX_PROMOS,
  validarNegocio, conFotoDeSede, validarInicio, validarFormulario, CAMPOS_FORMULARIO, INICIO_POR_DEFECTO, FORMULARIO_POR_DEFECTO,
  telefonoParaSitio, whatsappParaSitio, horariosAgrupados, negocioParaSitio, diferenciasHorario,
  armarContenido, diferencias,
};
