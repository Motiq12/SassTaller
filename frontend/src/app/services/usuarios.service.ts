import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { Usuario } from '../models/usuario.model';

@Injectable({ providedIn: 'root' })
export class UsuariosService {
  private url = `${environment.apiUrl}/usuarios`;
  constructor(private http: HttpClient) {}

  getAll(): Observable<{ data: Usuario[] }> {
    return this.http.get<{ data: Usuario[] }>(this.url);
  }

  // Las casillas de permisos del sitio web que el admin puede marcar a un empleado.
  getPermisosWeb(): Observable<{ data: { id: string; nombre: string; descripcion: string }[] }> {
    return this.http.get<{ data: { id: string; nombre: string; descripcion: string }[] }>(`${this.url}/permisos-web`);
  }

  create(data: { nombre: string; email: string; password: string; rol: string; rol_id?: number | null; telefono?: string; sucursal_id?: number | null; permisos_web?: Record<string, boolean> }): Observable<{ data: Usuario }> {
    return this.http.post<{ data: Usuario }>(this.url, data);
  }

  update(id: number, data: Partial<Usuario>): Observable<{ data: Usuario }> {
    return this.http.put<{ data: Usuario }>(`${this.url}/${id}`, data);
  }

  // Borrado definitivo. El backend lo rechaza (409) si el empleado ya tiene
  // historial: en ese caso corresponde desactivarlo, no eliminarlo.
  eliminar(id: number): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(`${this.url}/${id}`);
  }

  toggleActivo(id: number, activo: boolean): Observable<any> {
    return this.http.patch(`${this.url}/${id}/activo`, { activo });
  }

  // Cambia el local del empleado desde la lista (sucursal_id = null → atiende ambas).
  setSucursal(id: number, sucursal_id: number | null): Observable<any> {
    return this.http.patch(`${this.url}/${id}/sucursal`, { sucursal_id });
  }
}
