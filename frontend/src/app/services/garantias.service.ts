import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { limpiarParams } from '../shared/params.util';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { Garantia, GarantiaFoto, EstadoGarantia } from '../models/garantia.model';

@Injectable({ providedIn: 'root' })
export class GarantiasService {
  private url = `${environment.apiUrl}/garantias`;
  constructor(private http: HttpClient) {}

  getAll(params?: { estado?: string; orden_id?: number }): Observable<{ data: Garantia[] }> {
    return this.http.get<{ data: Garantia[] }>(this.url, { params: limpiarParams(params) });
  }

  getById(id: number): Observable<{ data: Garantia }> {
    return this.http.get<{ data: Garantia }>(`${this.url}/${id}`);
  }

  create(data: {
    orden_id: number;
    descripcion_problema: string;
    cubre_repuestos?: boolean;
    cubre_mano_obra?: boolean;
  }): Observable<{ data: Garantia }> {
    return this.http.post<{ data: Garantia }>(this.url, data);
  }

  cambiarEstado(id: number, data: {
    estado: EstadoGarantia;
    resolucion?: string;
    cubre_repuestos?: boolean;
    cubre_mano_obra?: boolean;
  }): Observable<{ data: Garantia }> {
    return this.http.patch<{ data: Garantia }>(`${this.url}/${id}/estado`, data);
  }

  addFoto(id: number, foto: { url: string; descripcion?: string }): Observable<{ data: GarantiaFoto }> {
    return this.http.post<{ data: GarantiaFoto }>(`${this.url}/${id}/fotos`, foto);
  }

  deleteFoto(garantiaId: number, fotoId: number): Observable<any> {
    return this.http.delete(`${this.url}/${garantiaId}/fotos/${fotoId}`);
  }
}
