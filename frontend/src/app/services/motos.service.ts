import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { limpiarParams } from '../shared/params.util';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { Moto } from '../models/moto.model';
import { Orden } from '../models/orden.model';

@Injectable({ providedIn: 'root' })
export class MotosService {
  private url = `${environment.apiUrl}/motos`;
  constructor(private http: HttpClient) {}

  getAll(params?: { q?: string; cliente_id?: number }): Observable<{ data: Moto[] }> {
    return this.http.get<{ data: Moto[] }>(this.url, { params: limpiarParams(params) });
  }

  getById(id: number): Observable<{ data: Moto }> {
    return this.http.get<{ data: Moto }>(`${this.url}/${id}`);
  }

  create(moto: Moto): Observable<{ data: Moto }> {
    return this.http.post<{ data: Moto }>(this.url, moto);
  }

  update(id: number, moto: Partial<Moto>): Observable<{ data: Moto }> {
    return this.http.put<{ data: Moto }>(`${this.url}/${id}`, moto);
  }

  getHistorial(id: number): Observable<{ data: Orden[] }> {
    return this.http.get<{ data: Orden[] }>(`${this.url}/${id}/historial`);
  }
}
