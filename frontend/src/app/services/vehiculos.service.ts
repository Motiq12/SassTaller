import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { Vehiculo } from '../models/vehiculo.model';
import { Orden } from '../models/orden.model';
import { TipoVehiculo } from './taller.service';

@Injectable({ providedIn: 'root' })
export class VehiculosService {
  private http = inject(HttpClient);

  private url = `${environment.apiUrl}/vehiculos`;

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

  // Los tipos que atiende este taller, con los campos propios de cada uno.
  getTipos(): Observable<{ data: TipoVehiculo[]; otros?: TipoVehiculo[] }> {
    return this.http.get<{ data: TipoVehiculo[]; otros?: TipoVehiculo[] }>(`${this.url}/tipos`);
  }
}
