// Catálogo de tipos de vehículo y de los campos propios de cada uno.
//
// Esta es LA fuente de verdad: el backend valida contra ella y el frontend arma el
// formulario a partir de ella. Si cada lado tuviera su propia lista, agregar un tipo
// significaría acordarse de tocar dos archivos, y el día que alguien se olvide el
// formulario pediría un dato que el servidor descarta sin avisar.
//
// Los campos COMUNES (marca, modelo, año, placa, color, chasis, kilometraje) son
// columnas de la tabla y valen para todos. Los de acá son los que cambian según el
// tipo y viven en la columna JSON `atributos`.

const COMBUSTIBLE_PESADO = { clave: 'combustible', etiqueta: 'Combustible', tipo: 'opcion',
  opciones: ['Diésel', 'Gasolina', 'Híbrido', 'Eléctrico', 'GLP', 'Gas natural'] };
const TRANSMISION_PESADO = { clave: 'transmision', etiqueta: 'Transmisión', tipo: 'opcion',
  opciones: ['Manual', 'Automática', 'Automatizada'] };

const TIPOS = {
  moto: {
    etiqueta: 'Motocicleta',
    plural: 'Motocicletas',
    genero: 'f',
    // Unidad de uso: una moto y un auto se miden en kilómetros, pero una
    // maquinaria se mide en horas. Lo declara el tipo para que los recordatorios
    // de mantenimiento no asuman kilómetros.
    unidadUso: 'km',
    campos: [
      { clave: 'cilindrada', etiqueta: 'Cilindrada (cc)', tipo: 'numero', min: 0, max: 3000 },
      { clave: 'estilo', etiqueta: 'Estilo', tipo: 'opcion',
        opciones: ['Scooter', 'Naked', 'Deportiva', 'Trail / Adventure', 'Cross / Enduro', 'Custom', 'Utilitaria'] },
    ],
  },
  auto: {
    etiqueta: 'Automóvil',
    plural: 'Automóviles',
    genero: 'm',
    unidadUso: 'km',
    campos: [
      { clave: 'combustible', etiqueta: 'Combustible', tipo: 'opcion',
        opciones: ['Gasolina', 'Diésel', 'Híbrido', 'Eléctrico', 'GLP'] },
      { clave: 'transmision', etiqueta: 'Transmisión', tipo: 'opcion',
        opciones: ['Manual', 'Automática', 'CVT'] },
      { clave: 'carroceria', etiqueta: 'Carrocería', tipo: 'opcion',
        opciones: ['Sedán', 'Hatchback', 'SUV', 'Pick-up', 'Camioneta', 'Coupé', 'Furgoneta'] },
      { clave: 'puertas', etiqueta: 'Puertas', tipo: 'numero', min: 2, max: 6 },
    ],
  },
  camion: {
    etiqueta: 'Camión',
    plural: 'Camiones',
    genero: 'm',
    unidadUso: 'km',
    campos: [
      COMBUSTIBLE_PESADO,
      TRANSMISION_PESADO,
      { clave: 'ejes', etiqueta: 'Ejes', tipo: 'numero', min: 2, max: 10 },
      { clave: 'capacidad_ton', etiqueta: 'Capacidad de carga (toneladas)', tipo: 'numero', min: 0, max: 100 },
    ],
  },
  bus: {
    etiqueta: 'Bus',
    plural: 'Buses',
    genero: 'm',
    unidadUso: 'km',
    campos: [
      COMBUSTIBLE_PESADO,
      TRANSMISION_PESADO,
      { clave: 'pasajeros', etiqueta: 'Pasajeros', tipo: 'numero', min: 1, max: 120 },
    ],
  },
  buseta: {
    etiqueta: 'Buseta',
    plural: 'Busetas',
    genero: 'f',
    unidadUso: 'km',
    campos: [
      COMBUSTIBLE_PESADO,
      TRANSMISION_PESADO,
      { clave: 'pasajeros', etiqueta: 'Pasajeros', tipo: 'numero', min: 1, max: 40 },
    ],
  },
  // La salida para lo que no está en la lista: cuadraciclos, maquinaria, lanchas…
  otro: {
    etiqueta: 'Otro vehículo',
    plural: 'Otros',
    genero: 'm',
    unidadUso: 'km',
    campos: [
      { clave: 'descripcion', etiqueta: '¿Qué vehículo es?', tipo: 'texto' },
    ],
  },
};

const CLAVES = Object.keys(TIPOS);

function tipoValido(tipo) {
  return CLAVES.includes(String(tipo || '').toLowerCase());
}

// Normaliza la lista de tipos que atiende un taller. Nunca devuelve vacío: un taller
// sin ningún tipo no podría registrar vehículos, así que ante datos inválidos se cae
// a 'moto', que es lo que atendían todos los talleres antes de esta migración.
function normalizarTipos(valor) {
  let lista = valor;
  if (typeof lista === 'string') {
    try { lista = JSON.parse(lista); } catch { lista = null; }
  }
  if (!Array.isArray(lista)) lista = [];
  const limpios = [...new Set(lista.map(t => String(t).toLowerCase()).filter(tipoValido))];
  return limpios.length ? limpios : ['moto'];
}

// La lista que manda el panel. A diferencia de normalizarTipos no cae a 'moto': si
// una lista vacía o con basura se guardara así, un taller de buses amanecería como
// taller de motos. Devuelve null y quien llama la rechaza.
function tiposParaGuardar(valor) {
  if (!Array.isArray(valor) || !valor.length) return null;
  const pedidos = valor.map((t) => String(t).toLowerCase());
  return pedidos.every(tipoValido) ? [...new Set(pedidos)] : null;
}

// Un taller puede dejar de atender un tipo sin que sus vehículos de ese tipo queden
// trabados: conservar el que ya tiene siempre vale; cambiar, solo a uno que atienda.
function puedeUsarTipo(tipo, atendidos, actual) {
  return tipo === actual || normalizarTipos(atendidos).includes(tipo);
}

const vistaTipo = (clave) => ({
  clave, etiqueta: TIPOS[clave].etiqueta, plural: TIPOS[clave].plural,
  unidadUso: TIPOS[clave].unidadUso, campos: TIPOS[clave].campos,
});

// `data`: lo que el taller atiende. `otros`: el resto, para poder mostrar el tipo y
// los campos de un vehículo viejo de un tipo que el taller ya no atiende.
function catalogoDelTaller(tipos) {
  const atendidos = normalizarTipos(tipos);
  return { data: atendidos.map(vistaTipo), otros: CLAVES.filter((c) => !atendidos.includes(c)).map(vistaTipo) };
}

// Deja solo los atributos que el tipo declara, con el formato correcto. Lo que no
// esté en la definición se descarta: sin esto, `atributos` sería un JSON abierto
// donde cualquiera podría guardar lo que quisiera desde el cliente.
function limpiarAtributos(tipo, atributos) {
  if (!tipoValido(tipo) || !atributos || typeof atributos !== 'object') return null;
  const definidos = TIPOS[tipo].campos;
  const salida = {};
  for (const campo of definidos) {
    const bruto = atributos[campo.clave];
    if (bruto === undefined || bruto === null || bruto === '') continue;
    if (campo.tipo === 'numero') {
      const n = Number(bruto);
      if (!Number.isFinite(n)) continue;
      if (campo.min !== undefined && n < campo.min) continue;
      if (campo.max !== undefined && n > campo.max) continue;
      salida[campo.clave] = n;
    } else if (campo.tipo === 'opcion') {
      const texto = String(bruto);
      if (campo.opciones.includes(texto)) salida[campo.clave] = texto;
    } else {
      salida[campo.clave] = String(bruto).slice(0, 120);
    }
  }
  return Object.keys(salida).length ? salida : null;
}

// Etiqueta para la interfaz. Con un solo tipo se le habla en su idioma ("Moto");
// con varios no queda otra que el término general, porque el taller ve una lista
// mezclada. Hablarle en su idioma cuando se puede es preferible a ser genérico.
function etiquetaPara(tipos) {
  const lista = normalizarTipos(tipos);
  return lista.length === 1
    ? { singular: TIPOS[lista[0]].etiqueta, plural: TIPOS[lista[0]].plural, genero: TIPOS[lista[0]].genero }
    : { singular: 'Vehículo', plural: 'Vehículos', genero: 'm' };
}

// Mensaje con la concordancia correcta: en español 'moto registrada' pero 'vehículo
// registrado'. Sin esto habría que elegir entre un texto mal escrito o uno neutro y
// frío ('Registro guardado'), y el taller lee estos mensajes todo el día.
function mensaje(tipos, participio) {
  const e = etiquetaPara(tipos);
  return `${e.singular} ${participio}${e.genero === 'f' ? 'a' : 'o'}`;
}

module.exports = { TIPOS, CLAVES, mensaje, tipoValido, normalizarTipos, tiposParaGuardar, puedeUsarTipo, catalogoDelTaller, limpiarAtributos, etiquetaPara };
