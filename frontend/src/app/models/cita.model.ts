export type EstadoCita = 'agendado' | 'en_revision' | 'en_mantenimiento' | 'listo' | 'entregado' | 'cancelado';

export interface Cita {
  id?: number;
  cliente_id: number;
  moto_id?: number | null;
  usuario_id?: number | null;
  tecnico_id?: number | null;
  fecha: string;
  hora: string;
  motivo: string;
  /** El primero de los servicios (lo que ya lo leía sigue igual). */
  tipo_servicio?: string | null;
  /** Todos los servicios, para mostrar: "Cambio de aceite + Frenos". */
  servicios?: string | null;
  estado?: EstadoCita;
  monto?: number;
  calificacion?: number | null;
  /** Horas que ocupa en la agenda (24 = todo el día). Solo la cambia administración. */
  duracion_horas?: number;
  /** Servicio rápido: 20, 30 o 40 minutos (usa solo esos minutos de su hora). 0/null = normal. */
  duracion_min?: number | null;
  /** Orden de trabajo de la cita (si ya se abrió). */
  orden_id?: number | null;
  numero_orden?: string | null;
  // Campos enriquecidos
  usuario_nombre?: string | null;
  tecnico_nombre?: string | null;
  cliente_nombre?: string;
  cliente_apellido?: string;
  cliente_telefono?: string;
  marca?: string;
  modelo?: string;
  placa?: string;
}
