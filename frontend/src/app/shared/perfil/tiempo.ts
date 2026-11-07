// "Hace 5 min", "Hace 3 h", "Ayer, 4:10 p. m.", "12 oct". En hora del taller (CR).
const ZONA = 'America/Costa_Rica';

export function haceCuanto(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  const t = d.getTime();
  if (isNaN(t)) return '';
  const min = Math.round((Date.now() - t) / 60000);
  if (min < 1) return 'Ahora';
  if (min < 60) return `Hace ${min} min`;
  if (min < 6 * 60) return `Hace ${Math.round(min / 60)} h`;
  const dia = (x: Date) => x.toLocaleDateString('en-CA', { timeZone: ZONA });
  const ayer = new Date(Date.now() - 86400000);
  const hora = d.toLocaleTimeString('es-CR', { timeZone: ZONA, hour: 'numeric', minute: '2-digit' });
  if (dia(d) === dia(new Date())) return `Hoy, ${hora}`;
  if (dia(d) === dia(ayer)) return `Ayer, ${hora}`;
  const mismoAnio = d.toLocaleDateString('en-CA', { timeZone: ZONA, year: 'numeric' }) === new Date().toLocaleDateString('en-CA', { timeZone: ZONA, year: 'numeric' });
  return d.toLocaleDateString('es-CR', { timeZone: ZONA, day: 'numeric', month: 'short', ...(mismoAnio ? {} : { year: 'numeric' }) });
}
