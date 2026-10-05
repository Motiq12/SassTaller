// Etiqueta de proximidad de una cita a partir de su fecha 'YYYY-MM-DD'.
// Se usa para el badge "Hoy" / "Mañana" / "En N días" del inicio y de Mis Citas.

export type TonoProximidad = 'hoy' | 'pronto' | 'futuro';
export interface BadgeProximidad { texto: string; tono: TonoProximidad; }

// Offset UTC del taller (en horas). Centralizado para cambiar en un solo lugar.
export const TZ_OFFSET_HORAS = -6;

export function ahoraTaller(): Date {
  return new Date(Date.now() + TZ_OFFSET_HORAS * 60 * 60 * 1000);
}

export function hoyCR(): string {
  return ahoraTaller().toISOString().slice(0, 10);
}

// Días enteros entre hoy (CR) y la fecha de la cita. Negativo si ya pasó. null si inválida.
export function diasHastaCita(fecha: string | null | undefined): number | null {
  if (!fecha) return null;
  const f = String(fecha).slice(0, 10);
  const hoy = new Date(`${hoyCR()}T00:00:00Z`).getTime();
  const dia = new Date(`${f}T00:00:00Z`).getTime();
  if (isNaN(dia)) return null;
  return Math.round((dia - hoy) / 86400000);
}

// Devuelve el badge de proximidad, o null si no aplica (cita pasada o a más de 6 días).
export function badgeProximidad(fecha: string | null | undefined): BadgeProximidad | null {
  const d = diasHastaCita(fecha);
  if (d === null || d < 0 || d > 6) return null;
  if (d === 0) return { texto: 'Hoy', tono: 'hoy' };
  if (d === 1) return { texto: 'Mañana', tono: 'pronto' };
  return { texto: `En ${d} días`, tono: 'futuro' };
}
