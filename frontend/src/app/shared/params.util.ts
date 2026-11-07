// Filtros de una búsqueda sin los vacíos.
//
// Angular manda un filtro `undefined` como el texto "undefined" en la URL
// (?estado=undefined), y el servidor lo tomaba como un filtro de verdad: en
// Gestión de citas → Órdenes, el filtro "Todas" pedía las órdenes con estado
// "undefined" y la lista salía vacía. Con esto, lo vacío no se manda.
export function limpiarParams(params?: Record<string, unknown> | null): Record<string, string | number | boolean> {
  const limpios: Record<string, string | number | boolean> = {};
  for (const [clave, valor] of Object.entries(params || {})) {
    if (valor === undefined || valor === null || valor === '') continue;
    limpios[clave] = valor as string | number | boolean;
  }
  return limpios;
}
