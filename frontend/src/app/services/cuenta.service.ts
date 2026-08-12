import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, of, tap, map, catchError } from 'rxjs';
import { environment } from '../../environments/environment';

/**
 * En qué plan está el taller y qué le queda.
 *
 * Vive aparte de AuthService a propósito: eso maneja la sesión (quién sos), y esto
 * maneja la cuenta (qué contrataste). Son dos cosas que cambian por motivos distintos
 * — la sesión al entrar y salir, el plan cuando vence la prueba o alguien paga.
 *
 * El dato viaja pegado a /api/auth/me, que la app ya pide al abrir, así que saber el
 * plan no cuesta un viaje extra al servidor.
 */

export interface LimitesPlan {
  usuarios: number | null;      // null = sin límite
  sucursales: number | null;
  marca_propia: boolean;
  reportes_dias: number | null;
}

export interface Cuenta {
  plan: 'trial' | 'gratis' | 'pro' | null;
  vence: string | null;
  dias_restantes: number | null;
  limites: LimitesPlan;
  uso: { usuarios: number; sucursales: number };
}

// Con más de una semana por delante no se muestra nada: no hay que recordarle a nadie
// un problema que todavía no tiene.
const AVISAR_DESDE = 7;

@Injectable({ providedIn: 'root' })
export class CuentaService {
  private cuentaSubject = new BehaviorSubject<Cuenta | null>(null);
  cuenta$ = this.cuentaSubject.asObservable();

  // Si el correo del usuario está confirmado. Viene en la misma respuesta que la cuenta
  // (/api/auth/me), así que se guarda acá en vez de pedir lo mismo dos veces desde dos
  // servicios distintos. null = todavía no se sabe.
  private correoSubject = new BehaviorSubject<boolean | null>(null);
  correoVerificado$ = this.correoSubject.asObservable();

  constructor(private http: HttpClient) {}

  get actual(): Cuenta | null { return this.cuentaSubject.value; }

  /**
   * Relee la cuenta desde el servidor.
   *
   * Un fallo no se propaga: esto es información de contexto, y una franja que no se
   * pudo cargar no puede romper la pantalla que la contiene.
   */
  cargar(): Observable<Cuenta | null> {
    return this.http.get<{ data: { email_verificado?: number }; cuenta: Cuenta }>(`${environment.apiUrl}/auth/me`).pipe(
      tap(r => this.correoSubject.next(!!r.data?.email_verificado)),
      map(r => r.cuenta || null),
      tap(c => this.cuentaSubject.next(c)),
      catchError(() => of(null)),
    );
  }

  /** Lo marca en memoria tras confirmar, para que el aviso se vaya sin recargar. */
  marcarCorreoVerificado(): void { this.correoSubject.next(true); }

  limpiar(): void {
    this.cuentaSubject.next(null);
    this.correoSubject.next(null);
  }

  /** ¿Hay algo que decirle al taller sobre su plan, ahora mismo? */
  get hayQueAvisar(): boolean {
    const c = this.actual;
    if (!c) return false;
    if (c.plan === 'gratis') return true;
    return c.plan === 'trial' && c.dias_restantes != null && c.dias_restantes <= AVISAR_DESDE;
  }
}
