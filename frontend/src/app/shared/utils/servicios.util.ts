// Estados de cita y horas de agenda (frontend).
//
// El catálogo de servicios ya NO vive acá: se administra desde el panel (Servicios) y
// se pide al servidor. Tenerlo duplicado hacía que el frontend ofreciera una lista y
// el backend validara contra otra, y encima el formulario de recepción tenía una
// tercera con nombres distintos.

export const HORAS = ['08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00'];

// Flujo de estados de la cita (para la barra de progreso del cliente).
export const FLUJO_CITA = ['agendado', 'en_revision', 'en_mantenimiento', 'listo', 'entregado'];

// Las etapas que ve el CLIENTE en su portal (la línea de tiempo de la cita), en el
// mismo orden que FLUJO_CITA. Las usan el portal real y la vista de ejemplo de la
// landing: si cambian acá, cambian en los dos lados.
export const ETAPAS_PORTAL = [
  { key: 'agendado', label: 'Agendado', icon: 'calendar-outline' },
  { key: 'en_revision', label: 'En revisión', icon: 'search-outline' },
  { key: 'en_mantenimiento', label: 'En mantenimiento', icon: 'construct-outline' },
  { key: 'listo', label: 'Listo para entrega', icon: 'checkmark-done-outline' },
  { key: 'entregado', label: 'Entregado', icon: 'flag-outline' },
] as const;

export const ESTADO_CITA_LABEL: Record<string, string> = {
  agendado: 'Agendado',
  en_revision: 'En revisión',
  en_mantenimiento: 'En mantenimiento',
  listo: 'Listo',
  entregado: 'Entregado',
  cancelado: 'Cancelado',
};
