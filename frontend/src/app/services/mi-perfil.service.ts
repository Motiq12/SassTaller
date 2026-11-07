import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap } from 'rxjs';
import { environment } from '../../environments/environment';
import { PreferenciasPersonal } from '../models/usuario.model';
import { AuthService } from './auth.service';

export interface SesionAbierta {
  id: number;
  dispositivo: string;
  ip: string | null;
  creada: string;
  ultima_vez: string;
  actual: boolean;
}

export interface ItemActividad {
  tipo: string;
  texto: string;
  detalle: string | null;
  orden_id: number | null;
  fecha: string;
}

export interface PerfilExtra {
  telefono: string;
  firma: string | null;
  preferencias: PreferenciasPersonal;
  avisos: string[];
  politica?: { minimo: number; variedad: boolean };
}

// Lo de Mi perfil que es igual para los tres roles (/api/auth/...): preferencias,
// firma, teléfono, sesiones abiertas y actividad.
@Injectable({ providedIn: 'root' })
export class MiPerfilService {
  private url = `${environment.apiUrl}/auth`;

  constructor(private http: HttpClient, private auth: AuthService) {}

  get(): Observable<{ data: PerfilExtra }> {
    return this.http.get<{ data: PerfilExtra }>(`${this.url}/perfil`);
  }

  // Guarda y deja las preferencias en la sesión (el login y la agenda las leen de ahí).
  guardarPreferencias(p: PreferenciasPersonal): Observable<{ data: PreferenciasPersonal; message: string }> {
    return this.http.put<{ data: PreferenciasPersonal; message: string }>(`${this.url}/perfil/preferencias`, p).pipe(
      tap(r => {
        const u = this.auth.getUsuario();
        const token = this.auth.getToken();
        if (u && token) this.auth.aplicarSesionStaff(token, { ...u, preferencias: r.data });
      })
    );
  }

  guardarTelefono(telefono: string): Observable<{ data: { telefono: string }; message: string }> {
    return this.http.put<{ data: { telefono: string }; message: string }>(`${this.url}/perfil/telefono`, { telefono });
  }

  guardarFirma(firma: string | null): Observable<{ data: { firma: string | null }; message: string }> {
    return this.http.put<{ data: { firma: string | null }; message: string }>(`${this.url}/perfil/firma`, { firma });
  }

  sesiones(): Observable<{ data: { sesiones: SesionAbierta[]; con_sid: boolean } }> {
    return this.http.get<{ data: { sesiones: SesionAbierta[]; con_sid: boolean } }>(`${this.url}/sesiones`);
  }

  cerrarSesion(id: number): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(`${this.url}/sesiones/${id}`);
  }

  cerrarOtras(): Observable<{ data: { cerradas: number }; message: string }> {
    return this.http.post<{ data: { cerradas: number }; message: string }>(`${this.url}/sesiones/cerrar-otras`, {});
  }

  actividad(): Observable<{ data: ItemActividad[] }> {
    return this.http.get<{ data: ItemActividad[] }>(`${this.url}/actividad`);
  }
}
