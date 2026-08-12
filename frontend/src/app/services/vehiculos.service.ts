import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { Vehiculo } from '../models/vehiculo.model';
import { Orden } from '../models/orden.model';

@Injectable({ providedIn: 'root' })
export class VehiculosService {
  private url = `${environment.apiUrl}/vehiculos`;
  constructor(private http: HttpClient) {}

  getAll(params?: { q?: string; cliente_id?: number }): Observable<{ data: Vehiculo[] }> {
    return this.http.get<{ data: Vehiculo[] }>(this.url, { params: params as any });
  }

  getById(id: number): Observable<{ data: Vehiculo }> {
    return this.http.get<{ data: Vehiculo }>(`${this.url}/${id}`);
  }

  create(vehiculo: Vehiculo): Observable<{ data: Vehiculo }> {
    return this.http.post<{ data: Vehiculo }>(this.url, vehiculo);
  }

  update(id: number, vehiculo: Partial<Vehiculo>): Observable<{ data: Vehiculo }> {
    return this.http.put<{ data: Vehiculo }>(`${this.url}/${id}`, vehiculo);
  }

  getHistorial(id: number): Observable<{ data: Orden[] }> {
    return this.http.get<{ data: Orden[] }>(`${this.url}/${id}/historial`);
  }
}
