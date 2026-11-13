import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

// Un repuesto del catálogo, con sus cantidades en la sucursal que se pidió (o en todas).
export interface Repuesto {
  id: number;
  codigo: string | null;
  nombre: string;
  marca: string | null;
  unidad: string;
  costo: string | number;
  precio: string | number;
  minimo: number;
  activo: number;
  existencia: number;
  comprometido: number;   // en órdenes abiertas: sale del inventario al entregarlas
  disponible: number;     // existencia - comprometido
  bajo: boolean;          // disponible en el mínimo o por debajo
}

export interface MovimientoInventario {
  id: number;
  tipo: 'entrada' | 'salida' | 'ajuste';
  cantidad: number;
  existencia_despues: number;
  costo_unitario: string | null;
  proveedor: string | null;
  documento: string | null;
  nota: string | null;
  created_at: string;
  sucursal_nombre: string | null;
  orden_id: number | null;
  numero_orden: string | null;
  usuario_nombre: string | null;
}

export interface DatosRepuesto {
  codigo?: string | null;
  nombre: string;
  marca?: string | null;
  unidad?: string;
  costo?: number | null;
  precio?: number | null;
  minimo?: number | null;
  existencia_inicial?: number | null;
  sucursal_id?: number | null;
}

@Injectable({ providedIn: 'root' })
export class InventarioService {
  private http = inject(HttpClient);
  private url = `${environment.apiUrl}/inventario`;

  listar(filtros: { q?: string; sucursal_id?: number | null; bajo?: boolean; inactivos?: boolean } = {}): Observable<{ data: Repuesto[]; sucursal_id: number | null }> {
    const params: Record<string, string> = {};
    if (filtros.q) params['q'] = filtros.q;
    if (filtros.sucursal_id) params['sucursal_id'] = String(filtros.sucursal_id);
    if (filtros.bajo) params['bajo'] = '1';
    if (filtros.inactivos) params['inactivos'] = '1';
    return this.http.get<{ data: Repuesto[]; sucursal_id: number | null }>(this.url, { params });
  }

  crear(datos: DatosRepuesto): Observable<{ data: Repuesto; message: string }> {
    return this.http.post<{ data: Repuesto; message: string }>(this.url, datos);
  }

  editar(id: number, datos: DatosRepuesto): Observable<{ data: Repuesto; message: string }> {
    return this.http.put<{ data: Repuesto; message: string }>(`${this.url}/${id}`, datos);
  }

  activar(id: number, activo: boolean): Observable<{ message: string }> {
    return this.http.patch<{ message: string }>(`${this.url}/${id}/activo`, { activo });
  }

  movimientos(id: number, sucursalId?: number | null): Observable<{ data: MovimientoInventario[] }> {
    const params: Record<string, string> = sucursalId ? { sucursal_id: String(sucursalId) } : {};
    return this.http.get<{ data: MovimientoInventario[] }>(`${this.url}/${id}/movimientos`, { params });
  }

  entrada(id: number, datos: { cantidad: number; sucursal_id: number | null; costo_unitario?: number | null; proveedor?: string; documento?: string; nota?: string }): Observable<{ data: { existencia: number }; message: string }> {
    return this.http.post<{ data: { existencia: number }; message: string }>(`${this.url}/${id}/entrada`, datos);
  }

  ajuste(id: number, datos: { conteo: number; sucursal_id: number | null; nota: string }): Observable<{ data: { existencia: number; diferencia: number }; message: string }> {
    return this.http.post<{ data: { existencia: number; diferencia: number }; message: string }>(`${this.url}/${id}/ajuste`, datos);
  }
}

// Lo que se escribió en el campo «Repuesto» de una orden, ¿es uno del catálogo? Se
// reconoce por el nombre o el código exactos (sin distinguir mayúsculas). Si no
// coincide, la pieza queda escrita a mano, como siempre, y no mueve el inventario.
export function repuestoPorTexto(catalogo: Repuesto[], texto: string): Repuesto | null {
  const t = (texto || '').trim().toLowerCase();
  if (!t) return null;
  return catalogo.find(r => r.nombre.trim().toLowerCase() === t)
    || catalogo.find(r => !!r.codigo && r.codigo.trim().toLowerCase() === t)
    || null;
}
