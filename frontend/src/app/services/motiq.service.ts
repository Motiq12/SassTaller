import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap } from 'rxjs';
import { environment } from '../../environments/environment';

/**
 * Sesión y datos del panel de Motiq: el lado de la plataforma, no el de un taller.
 *
 * Guarda el token bajo una clave PROPIA (`motiq_token`), separada de la del personal
 * y de la del portal de clientes. Compartirla sería un problema real y no teórico:
 * entrar al panel de la plataforma cerraría la sesión del taller que uno tuviera
 * abierta en la misma máquina, y — peor — al salir de un lado se dejaría el token
 * del otro creyendo que se cerró todo. Son tres sesiones distintas y se guardan por
 * separado, igual que hace PortalService.
 *
 * Este token no vale en ninguna ruta de taller: el backend lo rechaza con 403 porque
 * no lleva ni taller ni rol.
 */
const TOKEN_KEY = 'motiq_token';
const ADMIN_KEY = 'motiq_admin';

export interface AdminPlataforma { id: number; nombre: string; email: string; }

export interface TallerDelPanel {
  id: number;
  nombre: string;
  slug: string;
  estado: 'activo' | 'suspendido' | 'cancelado';
  motivo_estado: string | null;
  plan: string;
  trial_hasta: string | null;
  created_at: string;
  usuarios: number;
  clientes: number;
  vehiculos: number;
  ordenes: number;
  ultima_orden: string | null;
}

export interface ResumenPlataforma {
  talleres: { total: number; activos: number; suspendidos: number; en_prueba: number; nuevos_30d: number };
  uso: { usuarios: number; clientes: number; vehiculos: number; ordenes: number };
  contactos: { sin_atender: number };
}

// Lo que manda la landing cuando alguien pide una demo.
export interface PedidoDemo {
  nombre: string;
  email: string;
  telefono?: string;
  empresa?: string;
  volumen?: string;
  mensaje?: string;
  origen?: string;
}

export interface ContactoDemo extends PedidoDemo {
  id: number;
  estado: 'nuevo' | 'contactado' | 'cerrado' | 'descartado';
  nota_interna: string | null;
  created_at: string;
}

@Injectable({ providedIn: 'root' })
export class MotiqService {
  private apiUrl = environment.apiUrl;
  // El panel es de escritorio y no se compila a la app nativa, así que acá alcanza
  // localStorage; no hace falta el Keychain como en AuthService.
  private token: string | null = localStorage.getItem(TOKEN_KEY);

  constructor(private http: HttpClient) {}

  getToken(): string | null { return this.token; }

  get admin(): AdminPlataforma | null {
    try { return JSON.parse(localStorage.getItem(ADMIN_KEY) || 'null'); } catch { return null; }
  }

  login(email: string, password: string): Observable<{ data: { token: string; admin: AdminPlataforma } }> {
    return this.http.post<{ data: { token: string; admin: AdminPlataforma } }>(
      `${this.apiUrl}/motiq/login`, { email, password }
    ).pipe(tap(res => {
      this.token = res.data.token;
      localStorage.setItem(TOKEN_KEY, res.data.token);
      localStorage.setItem(ADMIN_KEY, JSON.stringify(res.data.admin));
    }));
  }

  logout(): void {
    this.token = null;
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(ADMIN_KEY);
  }

  isLoggedIn(): boolean { return !!this.token && !this.isTokenExpired(); }

  // Un token vencido en el almacenamiento vale lo mismo que no tener ninguno: si no
  // se mira acá, el guard deja entrar y la pantalla se llena de errores 401.
  isTokenExpired(): boolean {
    if (!this.token) return true;
    try {
      const { exp } = JSON.parse(atob(this.token.split('.')[1]));
      return !exp || exp * 1000 <= Date.now();
    } catch {
      return true;   // token ilegible: tratarlo como vencido
    }
  }

  // --- Público: lo usa la landing, sin sesión de por medio ---

  pedirDemo(datos: PedidoDemo): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(`${this.apiUrl}/motiq/contacto`, datos);
  }

  // --- Con sesión de plataforma ---

  contactos(estado = ''): Observable<{ data: ContactoDemo[] }> {
    return this.http.get<{ data: ContactoDemo[] }>(
      `${this.apiUrl}/motiq/contactos${estado ? `?estado=${encodeURIComponent(estado)}` : ''}`
    );
  }

  actualizarContacto(id: number, estado: string, nota_interna?: string): Observable<{ message: string }> {
    return this.http.patch<{ message: string }>(`${this.apiUrl}/motiq/contactos/${id}`, { estado, nota_interna });
  }

  resumen(): Observable<{ data: ResumenPlataforma }> {
    return this.http.get<{ data: ResumenPlataforma }>(`${this.apiUrl}/motiq/resumen`);
  }

  talleres(filtros: { estado?: string; q?: string } = {}): Observable<{ data: TallerDelPanel[] }> {
    const params: string[] = [];
    if (filtros.estado) params.push(`estado=${encodeURIComponent(filtros.estado)}`);
    if (filtros.q) params.push(`q=${encodeURIComponent(filtros.q)}`);
    return this.http.get<{ data: TallerDelPanel[] }>(
      `${this.apiUrl}/motiq/talleres${params.length ? '?' + params.join('&') : ''}`
    );
  }

  cambiarEstado(id: number, estado: string, motivo?: string): Observable<{ message: string }> {
    return this.http.patch<{ message: string }>(`${this.apiUrl}/motiq/talleres/${id}/estado`, { estado, motivo });
  }

  cambiarPlan(id: number, plan: string, trial_hasta?: string | null): Observable<{ message: string }> {
    return this.http.patch<{ message: string }>(`${this.apiUrl}/motiq/talleres/${id}/plan`, { plan, trial_hasta });
  }
}
