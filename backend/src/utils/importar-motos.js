// Importar el catálogo desde un archivo CSV (lo que sale de Excel con
// "Guardar como → CSV").
//
// El taller suele tener su inventario en una hoja de cálculo. Cargar 15 motos a
// mano, una por una, es lo que más cansa el primer día.
//
// Se revisa fila por fila y se devuelve el detalle: así el panel puede mostrar
// una vista previa con lo que entraría y lo que no, ANTES de crear nada.

const { fechaLocalISO } = require('./fecha');
const { validarMoto, slugify } = require('./contenido-web');

const MAX_FILAS = 300;

// Una fila de CSV, respetando las comillas: «"Urbana 150, roja";1200000» son dos
// celdas. Excel escapa una comilla dentro de un texto duplicándola ("").
function partirLinea(linea, sep) {
  const celdas = [];
  let actual = '';
  let entreComillas = false;
  for (let i = 0; i < linea.length; i++) {
    const c = linea[i];
    if (entreComillas) {
      if (c === '"' && linea[i + 1] === '"') { actual += '"'; i++; }
      else if (c === '"') entreComillas = false;
      else actual += c;
    } else if (c === '"') entreComillas = true;
    else if (c === sep) { celdas.push(actual); actual = ''; }
    else actual += c;
  }
  celdas.push(actual);
  return celdas.map((x) => x.trim());
}

// Excel en Costa Rica suele guardar con punto y coma; otras veces con coma. Se
// elige el que más columnas dé en la primera línea.
function separadorDe(primeraLinea) {
  return partirLinea(primeraLinea, ';').length >= partirLinea(primeraLinea, ',').length ? ';' : ',';
}

// "Año", "ANIO", " año " → "ano": para reconocer el encabezado aunque venga con
// tildes, mayúsculas o espacios de más.
const normalizar = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase();

// Nombres que aceptamos para cada columna.
const COLUMNAS = {
  nombre: ['nombre', 'moto', 'modelo'],
  tipo: ['categoria', 'tipo'],
  estado: ['estado', 'condicion'],
  precio: ['precio'],
  moneda: ['moneda'],
  resumen: ['resumen', 'descripcion corta'],
  descripcion: ['descripcion', 'detalle'],
  foto: ['foto', 'imagen', 'url foto'],
  ingreso: ['ingreso', 'fecha de ingreso', 'fecha ingreso'],
};

// "₡1.150.000", "1150000", "1,150,000" → 1150000. Devuelve null si no hay número.
function aNumero(valor) {
  const limpio = String(valor || '').replace(/[^\d.,-]/g, '');
  if (!limpio) return null;
  // Se queda con los dígitos: los separadores de miles varían (1.150.000 o 1,150,000)
  // y los precios de motos no llevan decimales.
  const n = Number(limpio.replace(/[.,]/g, ''));
  return Number.isFinite(n) ? n : null;
}

// AAAA-MM-DD, DD/MM/AAAA o lo que Excel haya escrito.
function aFecha(valor) {
  const v = String(valor || '').trim();
  if (!v) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(v);
  if (m) return `${m[3]}-${String(m[2]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
  return null;   // escrita de una forma que no se entiende
}

// Revisa el archivo entero contra las categorías y sucursales del taller.
// Devuelve { error } si el archivo no sirve, o { filas } con una entrada por
// línea: { linea, nombre, datos } si está bien, o { linea, nombre, error }.
function revisarCsv(texto, { tipos, sucursales }) {
  const lineas = String(texto || '')
    .replace(/^﻿/, '')          // Excel guarda una marca invisible al inicio
    .split(/\r?\n/)
    .filter((l) => l.trim());
  if (lineas.length < 2) return { error: 'El archivo no tiene filas: la primera línea son los títulos y debajo va una moto por línea.' };
  if (lineas.length - 1 > MAX_FILAS) return { error: `Hasta ${MAX_FILAS} motos por archivo` };

  const sep = separadorDe(lineas[0]);
  const titulos = partirLinea(lineas[0], sep).map(normalizar);

  // Dónde quedó cada columna conocida.
  const donde = {};
  for (const [campo, nombres] of Object.entries(COLUMNAS)) {
    const i = titulos.findIndex((t) => nombres.includes(t));
    if (i >= 0) donde[campo] = i;
  }
  if (donde.nombre === undefined) {
    return { error: 'Falta la columna "nombre" en la primera línea. Descarga la plantilla para ver cómo tiene que verse el archivo.' };
  }
  // Una columna por sucursal, para las unidades de cada una.
  const columnasSede = sucursales
    .map((s) => ({ id: s.id, i: titulos.indexOf(normalizar(s.nombre)) }))
    .filter((x) => x.i >= 0);

  const porNombre = new Map(tipos.map((t) => [normalizar(t.nombre), t.id]));
  const porId = new Map(tipos.map((t) => [t.id, t.id]));
  const tiposIds = tipos.map((t) => t.id);

  const filas = [];
  const nombresVistos = new Set();
  for (let n = 1; n < lineas.length; n++) {
    const celdas = partirLinea(lineas[n], sep);
    const celda = (campo) => (donde[campo] === undefined ? '' : celdas[donde[campo]] || '');
    const nombre = celda('nombre');
    const fila = { linea: n + 1, nombre };
    if (!nombre) { fila.error = 'Sin nombre'; filas.push(fila); continue; }
    if (nombresVistos.has(normalizar(nombre))) { fila.error = 'Repetida en el archivo'; filas.push(fila); continue; }
    nombresVistos.add(normalizar(nombre));

    // Categoría: se acepta el nombre ("Scooter") o el id interno.
    const tipoTexto = celda('tipo');
    const tipo = porNombre.get(normalizar(tipoTexto)) || porId.get(slugify(tipoTexto)) || '';
    if (tipoTexto && !tipo) {
      fila.error = `La categoría "${tipoTexto}" no existe. Créala primero o usa una de: ${tipos.map((t) => t.nombre).join(', ')}`;
      filas.push(fila);
      continue;
    }

    const ingreso = aFecha(celda('ingreso'));
    if (ingreso === null) { fila.error = 'La fecha de ingreso no se entiende (usa 2026-10-06 o 06/10/2026)'; filas.push(fila); continue; }

    const stock = {};
    let errorStock = null;
    for (const { id, i } of columnasSede) {
      const v = (celdas[i] || '').trim();
      if (!v) continue;
      const n2 = aNumero(v);
      if (n2 === null || n2 < 0) { errorStock = `Las unidades de una sede tienen que ser un número ("${v}")`; break; }
      stock[id] = n2;
    }
    if (errorStock) { fila.error = errorStock; filas.push(fila); continue; }

    const estadoTexto = normalizar(celda('estado'));
    const monedaTexto = normalizar(celda('moneda')) || (/\$|usd|dolar/i.test(celda('precio')) ? 'usd' : '');

    const { error, datos } = validarMoto(
      {
        nombre,
        tipo: tipo || tiposIds[0],
        estado: estadoTexto.startsWith('usad') ? 'usada' : 'nueva',
        precio: aNumero(celda('precio')),
        moneda: monedaTexto.startsWith('usd') || monedaTexto.startsWith('dolar') ? 'USD' : 'CRC',
        resumen: celda('resumen'),
        descripcion: celda('descripcion'),
        fotos: celda('foto') ? [celda('foto')] : [],
        stock,
        ingreso,
        visible: true,
      },
      sucursales.map((s) => s.id),
      tiposIds
    );
    if (error) fila.error = error;
    else fila.datos = datos;
    filas.push(fila);
  }
  return { filas, separador: sep, columnas: Object.keys(donde), sedes: columnasSede.length };
}

// La plantilla que el panel ofrece para descargar, con las categorías y sedes
// de ese taller y una fila de ejemplo.
function plantillaCsv({ tipos, sucursales }) {
  const titulos = ['nombre', 'categoria', 'estado', 'precio', 'moneda', 'resumen', 'descripcion', 'foto', 'ingreso',
    ...sucursales.map((s) => s.nombre)];
  const ejemplo = [
    'Freedom Urbana 150',
    (tipos[0] && tipos[0].nombre) || 'Scooter',
    'nueva',
    '1150000',
    'CRC',
    'Ideal para ciudad, bajo consumo y fácil manejo.',
    'Incluye garantía de fábrica y el primer servicio sin costo.',
    '',
    fechaLocalISO(),
    ...sucursales.map((_, i) => (i === 0 ? '3' : '1')),
  ];
  const celda = (v) => (/[;"\n]/.test(v) ? `"${String(v).replace(/"/g, '""')}"` : v);
  return [titulos.join(';'), ejemplo.map(celda).join(';')].join('\r\n') + '\r\n';
}

module.exports = { revisarCsv, plantillaCsv, partirLinea, separadorDe, aNumero, aFecha, MAX_FILAS };
