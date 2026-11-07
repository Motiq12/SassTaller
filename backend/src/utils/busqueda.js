// Ayudas para los buscadores de los listados (órdenes, consultas del sitio).

const MAX_BUSQUEDA = 80;

// Texto escrito por la persona → patrón para LIKE: recortado, con tope de largo, y
// con %, _ y \ escapados para que se busquen tal cual (si no, "50%" o "a_b" se
// leerían como comodines). null si no hay nada que buscar.
function patronLike(q) {
  const t = String(q ?? '').trim().slice(0, MAX_BUSQUEDA);
  if (!t) return null;
  return '%' + t.replace(/[\\%_]/g, (c) => '\\' + c) + '%';
}

// Solo los dígitos, para comparar teléfonos y cédulas sin importar guiones ni
// espacios ("8711 2233" encuentra "8711-2233"). null si quedan menos de 3.
function patronDigitos(q) {
  const d = String(q ?? '').replace(/\D/g, '').slice(0, MAX_BUSQUEDA);
  return d.length >= 3 ? `%${d}%` : null;
}

// Placa como la guarda motos.placa_norm: mayúsculas, sin espacios ni guiones.
function patronPlaca(q) {
  const p = String(q ?? '').toUpperCase().replace(/[\s-]/g, '').replace(/[\\%_]/g, '').slice(0, MAX_BUSQUEDA);
  return p.length >= 2 ? `%${p}%` : null;
}

// Columna de texto sin guiones, espacios ni "+", para comparar con patronDigitos.
const SOLO_DIGITOS = (col) => `REPLACE(REPLACE(REPLACE(${col}, '-', ''), ' ', ''), '+', '')`;

module.exports = { MAX_BUSQUEDA, patronLike, patronDigitos, patronPlaca, SOLO_DIGITOS };
