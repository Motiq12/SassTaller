// Cuánto puede durar una cita. Una cita ocupa su lugar en CADA hora que dura;
// «Todo el día» (24) llega hasta el cierre. Las mismas que acepta el servidor
// (backend/src/utils/agenda.js). Solo administración las cambia.
export const DURACIONES_CITA: { v: number; l: string }[] = [
  { v: 1, l: '1 hora' },
  { v: 2, l: '2 horas' },
  { v: 3, l: '3 horas' },
  { v: 4, l: '4 horas (medio día)' },
  { v: 6, l: '6 horas' },
  { v: 24, l: 'Todo el día' },
];

// Servicios rápidos de Ingresar ahora: 20, 30 o 40 minutos. Usan solo esos minutos de
// la hora en que entran (cada hora tiene cupo × 60 minutos); el resto queda para otro
// cliente. Las mismas que acepta el servidor (MINUTOS_RAPIDOS en utils/agenda.js).
export const MINUTOS_RAPIDOS = [20, 30, 40];
export const OPCIONES_TIEMPO: { v: number; l: string }[] = [
  { v: 0, l: 'Normal (ocupa la hora)' },
  { v: 20, l: 'Servicio rápido · 20 min' },
  { v: 30, l: 'Servicio rápido · 30 min' },
  { v: 40, l: 'Servicio rápido · 40 min' },
];

// "20 min", "1 h", "3 h", "Todo el día".
export function duracionCorta(d: number | null | undefined, minutos?: number | null): string {
  if (minutos && MINUTOS_RAPIDOS.includes(Number(minutos))) return `${minutos} min`;
  const n = Number(d) || 1;
  return n >= 24 ? 'Todo el día' : `${n} h`;
}
