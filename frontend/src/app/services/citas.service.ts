import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { Cita } from '../models/cita.model';

@Injectable({ providedIn: 'root' })
export class CitasService {
  private http = inject(HttpClient);

  private url = `${environment.apiUrl}/citas`;

  getAll(params?: { fecha?: string; estado?: string; tecnico_id?: number }): Observable<{ data: Cita[] }> {
    return this.http.get<{ data: Cita[] }>(this.url, { params: params as any });
  }

  getById(id: number): Observable<{ data: Cita }> {
    return this.http.get<{ data: Cita }>(`${this.url}/${id}`);
  }

  create(cita: Cita): Observable<{ data: Cita }> {
    return this.http.post<{ data: Cita }>(this.url, cita);
  }

  update(id: number, cita: Cita): Observable<{ data: Cita }> {
    return this.http.put<{ data: Cita }>(`${this.url}/${id}`, cita);
  }

  cambiarEstado(id: number, estado: string): Observable<any> {
    return this.http.patch(`${this.url}/${id}/estado`, { estado });
  }

  asignar(id: number, tecnico_id: number | null): Observable<any> {
    return this.http.patch(`${this.url}/${id}/asignar`, { tecnico_id });
  }
}
