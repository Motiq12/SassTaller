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

module.exports = { TIPOS, CLAVES, mensaje, tipoValido, normalizarTipos, limpiarAtributos, etiquetaPara };
