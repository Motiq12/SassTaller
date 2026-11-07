export interface Moto {
  id?: number;
  cliente_id: number;
  marca: string;
  modelo: string;
  anio?: number | null;
  placa?: string | null;
  color?: string | null;
  numero_motor?: string | null;
  numero_chasis?: string | null;
  kilometraje_actual?: number;
  foto_url?: string | null;
  activa?: number;
  // Campos enriquecidos del JOIN
  cliente_nombre?: string;
  cliente_apellido?: string;
  cliente_telefono?: string;
}
