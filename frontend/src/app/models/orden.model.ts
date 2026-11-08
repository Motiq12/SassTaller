export type EstadoOrden =
  | 'recepcion' | 'diagnostico' | 'esperando_aprobacion'
  | 'esperando_repuestos' | 'en_reparacion' | 'lista_entrega'
  | 'entregada' | 'cancelada';

/** Una fila del registro de órdenes eliminadas (copia de lo principal + el motivo). */
export interface OrdenEliminada {
  id: number;
  orden_id: number;
  numero_orden: string;
  estado: EstadoOrden;
  cliente_nombre: string | null;
  moto: string | null;
  problema_reportado: string | null;
  total: number;
  fecha_ingreso: string | null;
  motivo: string;
  eliminada_por_nombre: string | null;
  created_at: string;
}

export interface Orden {
  id?: number;
  numero_orden?: string;
  vehiculo_id: number;
  cliente_id: number;
  recepcionista_id?: number;
  tecnico_id?: number | null;
  estado?: EstadoOrden;
  problema_reportado: string;
  kilometraje_ingreso?: number | null;
  nivel_combustible?: string;
  accesorios_entregados?: string | null;
  estado_fisico?: string | null;
  prioridad?: string;
  categoria?: string;
  diagnostico?: string | null;
  tiempo_estimado_horas?: number | null;
  costo_mano_obra?: number;
  costo_repuestos?: number;
  descuento?: number;
  total?: number;
  aprobado_por_cliente?: number;
  aprobacion_cliente?: 'pendiente' | 'aprobado' | 'rechazado';
  motivo_rechazo?: string | null;
  fecha_aprobacion?: string | null;
  /** Total que el cliente aprobó la última vez (null si nunca aprobó). */
  total_aprobado?: number | null;
  /** Lo que la cuenta tiene por encima de lo aprobado (lo calcula el backend). */
  monto_sin_aprobar?: number;
  /** Estados a los que puede pasar ahora, según el backend y el rol de quien mira. */
  siguientes?: EstadoOrden[];
  fecha_ingreso?: string;
  fecha_estimada_entrega?: string | null;
  fecha_entrega_real?: string | null;
  metodo_pago?: string | null;
  garantia_dias?: number;
  observaciones_finales?: string | null;
  calificacion?: number | null;
  comentario_satisfaccion?: string | null;
  /** Por qué se canceló (lo pide la pantalla al cancelar). */
  motivo_cancelacion?: string | null;
  sucursal_id?: number | null;
  created_at?: string;
  // Campos enriquecidos del JOIN
  anio?: number | null;
  sucursal_nombre?: string | null;
  sucursal_direccion?: string | null;
  sucursal_telefono?: string | null;
  cliente_nombre?: string;
  cliente_apellido?: string;
  cliente_telefono?: string;
  cliente_email?: string | null;
  marca?: string;
  modelo?: string;
  placa?: string;
  color?: string;
  kilometraje_actual?: number | null;
  tecnico_nombre?: string;
  recepcionista_nombre?: string;
}

export interface OrdenAvance {
  id?: number;
  orden_id: number;
  usuario_id?: number;
  descripcion: string;
  created_at?: string;
  usuario_nombre?: string;
  usuario_rol?: string;
}

export interface OrdenRepuesto {
  id?: number;
  orden_id?: number;
  nombre: string;
  cantidad: number;
  costo_unitario: number;
  estado?: EstadoRepuesto;
  /** 1 si se agregó después de que el cliente aprobó el presupuesto. */
  adicional?: number;
}

export type EstadoRepuesto = 'solicitado' | 'pendiente' | 'pedido_especial' | 'disponible';

// Mismos nombres que usa el backend en los avisos (utils/reglas-orden.js).
export const ESTADO_REPUESTO_CONFIG: Record<EstadoRepuesto, { label: string; clase: string }> = {
  solicitado:      { label: 'Solicitado por el mecánico', clase: 'rose' },
  pendiente:       { label: 'Por conseguir',              clase: 'gris' },
  pedido_especial: { label: 'Pedido especial',            clase: 'amber' },
  disponible:      { label: 'Disponible',                 clase: 'solid' },
};

/** Aviso que devuelve el backend antes de un cambio de estado (409 requiere_confirmacion). */
export interface AvisoCambio {
  tipo: string;
  mensaje: string;
  detalle?: string[];
}

export interface OrdenFoto {
  id?: number;
  orden_id?: number;
  url: string;          // data URL base64
  tipo: 'ingreso' | 'diagnostico' | 'avance' | 'entrega';
  descripcion?: string | null;
  created_at?: string;
}

export interface OrdenChecklist {
  prueba_realizada: boolean;
  lavado: boolean;
  calidad_revisada: boolean;
  facturacion_lista: boolean;
  cliente_notificado: boolean;
  observaciones?: string;
}

/** El checklist de entrega. Ayuda a no olvidar nada, pero no impide entregar: si
 *  falta algo de lo que dice "revisar", se avisa en la orden y en el cuadro de entrega. */
export const CHECKLIST_ENTREGA: { campo: Exclude<keyof OrdenChecklist, 'observaciones'>; label: string; revisar: boolean }[] = [
  { campo: 'prueba_realizada', label: 'Prueba de manejo', revisar: true },
  { campo: 'lavado', label: 'Lavado', revisar: true },
  { campo: 'calidad_revisada', label: 'Calidad revisada', revisar: true },
  { campo: 'facturacion_lista', label: 'Factura lista', revisar: true },
  { campo: 'cliente_notificado', label: 'Cliente avisado', revisar: false },
];

/** Lo que falta marcar del checklist (vacío si está todo, o si nunca se llenó: null). */
export function faltantesChecklist(c: Partial<OrdenChecklist> | null | undefined): string[] {
  return CHECKLIST_ENTREGA.filter(i => i.revisar && !(c && c[i.campo])).map(i => i.label);
}

export const ESTADO_CONFIG: Record<EstadoOrden, { label: string; color: string }> = {
  recepcion:             { label: 'Recepción',            color: 'primary' },
  diagnostico:           { label: 'Diagnóstico',          color: 'warning' },
  esperando_aprobacion:  { label: 'Esperando aprobación', color: 'tertiary' },
  esperando_repuestos:   { label: 'Esperando repuestos',  color: 'medium' },
  en_reparacion:         { label: 'En reparación',        color: 'secondary' },
  lista_entrega:         { label: 'Lista para entrega',   color: 'success' },
  entregada:             { label: 'Entregada',            color: 'light' },
  cancelada:             { label: 'Cancelada',            color: 'danger' },
};
