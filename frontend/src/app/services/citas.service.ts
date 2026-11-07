import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { limpiarParams } from '../shared/params.util';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { Cita } from '../models/cita.model';

@Injectable({ providedIn: 'root' })
export class CitasService {
  private url = `${environment.apiUrl}/citas`;
  constructor(private http: HttpClient) {}

  getAll(params?: { fecha?: string; estado?: string; tecnico_id?: number }): Observable<{ data: Cita[] }> {
    return this.http.get<{ data: Cita[] }>(this.url, { params: limpiarParams(params) });
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

  // Solo administración. Con forzar se guarda aunque alguna hora quede llena o bloqueada.
  setDuracion(id: number, duracion_horas: number, forzar = false): Observable<{ message: string }> {
    return this.http.patch<{ message: string }>(`${this.url}/${id}/duracion`, forzar ? { duracion_horas, forzar } : { duracion_horas });
  }

  // Solo administración. No borra una cita con orden ni una entregada (el servidor dice por qué).
  eliminar(id: number): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(`${this.url}/${id}`);
  }

  cambiarEstado(id: number, estado: string): Observable<any> {
    return this.http.patch(`${this.url}/${id}/estado`, { estado });
  }

  asignar(id: number, tecnico_id: number | null): Observable<any> {
    return this.http.patch(`${this.url}/${id}/asignar`, { tecnico_id });
  }
}
