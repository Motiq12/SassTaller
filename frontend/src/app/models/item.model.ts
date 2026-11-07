// Modelo que representa una fila de la tabla "items".
export interface Item {
  id?: number;
  nombre: string;
  descripcion?: string | null;
  creado_en?: string;
}
