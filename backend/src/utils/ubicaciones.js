// Provincias y cantones de Costa Rica. Se eligen de una lista y no se escriben a mano:
// con texto libre, "San Jose" y "San José" serían dos lugares y el buscador fallaría.
// Es la única copia: el frontend la pide a /api/directorio/ubicaciones.
const UBICACIONES = {
  'San José': ['San José', 'Escazú', 'Desamparados', 'Puriscal', 'Tarrazú', 'Aserrí', 'Mora', 'Goicoechea', 'Santa Ana', 'Alajuelita', 'Vázquez de Coronado', 'Acosta', 'Tibás', 'Moravia', 'Montes de Oca', 'Turrubares', 'Dota', 'Curridabat', 'Pérez Zeledón', 'León Cortés Castro'],
  Alajuela: ['Alajuela', 'San Ramón', 'Grecia', 'San Mateo', 'Atenas', 'Naranjo', 'Palmares', 'Poás', 'Orotina', 'San Carlos', 'Zarcero', 'Sarchí', 'Upala', 'Los Chiles', 'Guatuso', 'Río Cuarto'],
  Cartago: ['Cartago', 'Paraíso', 'La Unión', 'Jiménez', 'Turrialba', 'Alvarado', 'Oreamuno', 'El Guarco'],
  Heredia: ['Heredia', 'Barva', 'Santo Domingo', 'Santa Bárbara', 'San Rafael', 'San Isidro', 'Belén', 'Flores', 'San Pablo', 'Sarapiquí'],
  Guanacaste: ['Liberia', 'Nicoya', 'Santa Cruz', 'Bagaces', 'Carrillo', 'Cañas', 'Abangares', 'Tilarán', 'Nandayure', 'La Cruz', 'Hojancha'],
  Puntarenas: ['Puntarenas', 'Esparza', 'Buenos Aires', 'Montes de Oro', 'Osa', 'Quepos', 'Golfito', 'Coto Brus', 'Parrita', 'Corredores', 'Garabito', 'Monteverde', 'Puerto Jiménez'],
  Limón: ['Limón', 'Pococí', 'Siquirres', 'Talamanca', 'Matina', 'Guácimo'],
};

const provinciaValida = (p) => Object.prototype.hasOwnProperty.call(UBICACIONES, p);
const cantonValido = (p, c) => provinciaValida(p) && UBICACIONES[p].includes(c);

// { provincia, canton } limpios, o { error } si no calzan. Los dos vacíos: sin ubicación.
function leerUbicacion(provincia, canton) {
  const p = String(provincia || '').trim();
  const c = String(canton || '').trim();
  if (!p && !c) return { provincia: null, canton: null };
  if (!cantonValido(p, c)) return { error: 'Elegí una provincia y un cantón de la lista' };
  return { provincia: p, canton: c };
}

module.exports = { UBICACIONES, provinciaValida, cantonValido, leerUbicacion };
