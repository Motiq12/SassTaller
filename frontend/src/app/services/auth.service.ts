import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Capacitor } from '@capacitor/core';
import { BehaviorSubject, Observable, tap } from 'rxjs';
import { environment } from '../../environments/environment';
import { Usuario, LoginResponse } from '../models/usuario.model';
import { secureGet, secureSet, secureRemove } from '../shared/utils/secure-store.util';
import { TallerService } from './taller.service';

const TOKEN_KEY = 'tallerms_token';
const USUARIO_KEY = 'tallerms_usuario';
const nativo = Capacitor.isNativePlatform();

// Respuesta del login unificado: o abre sesión (token + usuario/cliente), o pide
// el segundo factor (requiere_2fa + token_parcial), que solo aplica al personal.
export interface LoginUnificadoResp {
  tipo: 'staff' | 'cliente';
  token?: string;
  usuario?: Usuario;
  cliente?: any;
  requiere_2fa?: boolean;
  token_parcial?: string;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private http = inject(HttpClient);
  private taller = inject(TallerService);

  private apiUrl = environment.apiUrl;
  // En nativo el token vive en el Keychain/Keystore (ver secure-store.util); acá solo
  // se cachea en memoria para lecturas síncronas (interceptor, guards). En web sigue
  // siendo localStorage de punta a punta, igual que antes.
  private tokenCache: string | null = nativo ? null : localStorage.getItem(TOKEN_KEY);
  private usuarioSubject = new BehaviorSubject<Usuario | null>(nativo ? null : this.getUsuarioGuardadoWeb());

  usuario$ = this.usuarioSubject.asObservable();

  // Hidrata la sesión desde el Keychain/Keystore en plataforma nativa. Se llama desde
  // un APP_INITIALIZER (app.module.ts) para que termine ANTES de que arranquen los
  // guards de ruta; en web no hace nada (ya se hidrató en el constructor).
  async init(): Promise<void> {
    if (!nativo) return;
    const [token, usuarioRaw] = await Promise.all([secureGet(TOKEN_KEY), secureGet(USUARIO_KEY)]);
    this.tokenCache = token;
    if (usuarioRaw) {
      try { this.usuarioSubject.next(JSON.parse(usuarioRaw)); } catch { /* sesión corrupta: queda deslogueado */ }
    }
  }

  // El `taller` viaja en el login porque con multi-tenant el correo ya no identifica
  // a una persona sola: el mismo correo puede existir en varios talleres. Si no se
  // pudo resolver (sin subdominio y sin taller guardado) no se manda la clave, y el
  // backend resuelve por contraseña o pide elegir entre los que coincidan.
  login(email: string, password: string): Observable<{ data: LoginResponse }> {
    return this.http.post<{ data: LoginResponse }>(
      `${this.apiUrl}/auth/login`, this.taller.conTaller({ email, password })
    ).pipe(
      tap(res => this.guardarSesion(res.data.token, res.data.usuario))
    );
  }

  // Login unificado (personal o cliente). No persiste: el llamador decide según `tipo`.
  // Si el usuario tiene verificación en dos pasos, la respuesta NO trae sesión:
  // llega `requiere_2fa` + `token_parcial` para canjear en verificar2FA().
  loginUnificado(email: string, password: string): Observable<{ data: LoginUnificadoResp }> {
    return this.http.post<{ data: LoginUnificadoResp }>(
      `${this.apiUrl}/auth/login`, this.taller.conTaller({ email, password })
    );
  }

  // ── Verificación en dos pasos (personal) ──
  // Canjea el token parcial + el código por una sesión real.
  verificar2FA(tokenParcial: string, codigo: string): Observable<{ data: { token: string; usuario: Usuario } }> {
    return this.http.post<{ data: { token: string; usuario: Usuario } }>(
      `${this.apiUrl}/auth/2fa/verificar`, { token_parcial: tokenParcial, codigo }
    );
  }

  estado2FA(): Observable<{ data: { activado: boolean; backup_restantes: number } }> {
    return this.http.get<{ data: { activado: boolean; backup_restantes: number } }>(`${this.apiUrl}/auth/2fa/estado`);
  }

  // Paso 1 del alta: genera la clave para configurar la app de autenticación.
  setup2FA(): Observable<{ data: { secreto: string; secreto_legible: string; uri: string } }> {
    return this.http.post<{ data: { secreto: string; secreto_legible: string; uri: string } }>(
      `${this.apiUrl}/auth/2fa/setup`, {}
    );
  }

  // Paso 2: confirma con un código y activa. Devuelve los códigos de respaldo (una sola vez).
  activar2FA(codigo: string): Observable<{ data: { codigos_respaldo: string[] }; message: string }> {
    return this.http.post<{ data: { codigos_respaldo: string[] }; message: string }>(
      `${this.apiUrl}/auth/2fa/activar`, { codigo }
    );
  }

  desactivar2FA(password: string): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(`${this.apiUrl}/auth/2fa/desactivar`, { password });
  }

  /**
   * Recuperar la contraseña del personal: pide el código al correo. Funciona sin
   * taller (se resuelve por el correo); si hay uno resuelto, se acota a ese.
   */
  solicitarRecuperacion(email: string, antibot: { website?: string; turnstileToken?: string } = {}): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(`${this.apiUrl}/auth/recuperar/solicitar`, this.taller.conTaller({ email, ...antibot }));
  }

  /** Canjea el código y fija la contraseña nueva. No abre sesión: se vuelve al login. */
  confirmarRecuperacion(datos: { email: string; codigo: string; password: string }): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(`${this.apiUrl}/auth/recuperar/confirmar`, this.taller.conTaller(datos));
  }

  // Confirmación del correo del personal. No es 2FA ni le pone una traba a nadie: ese
  // correo es la única vía para recuperar la contraseña, y hasta ahora nadie comprobaba
  // que existiera.
  enviarCodigoCorreo(): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(`${this.apiUrl}/auth/verificar-correo/enviar`, {});
  }

  confirmarCorreo(codigo: string): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(`${this.apiUrl}/auth/verificar-correo`, { codigo });
  }

  // Guarda la sesión del personal (la usa el login unificado cuando tipo === 'staff').
  aplicarSesionStaff(token: string, usuario: Usuario) {
    this.guardarSesion(token, usuario);
  }

  private guardarSesion(token: string, usuario: Usuario) {
    // La caché en memoria se actualiza YA (lecturas síncronas inmediatas); la
    // escritura persistente es fire-and-forget y no bloquea el login.
    this.tokenCache = token;
    this.usuarioSubject.next(usuario);
    secureSet(TOKEN_KEY, token);
    secureSet(USUARIO_KEY, JSON.stringify(usuario));
  }

  logout() {
    this.tokenCache = null;
    this.usuarioSubject.next(null);
    secureRemove(TOKEN_KEY);
    secureRemove(USUARIO_KEY);
  }

  getToken(): string | null {
    return this.tokenCache;
  }

  getUsuario(): Usuario | null {
    return this.usuarioSubject.value;
  }

  isLoggedIn(): boolean {
    return !!this.getToken();
  }

  isTokenExpired(): boolean {
    const token = this.getToken();
    if (!token) return true;
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      return payload.exp * 1000 < Date.now();
    } catch {
      return true;
    }
  }

  tieneRol(...roles: string[]): boolean {
    const usuario = this.getUsuario();
    return !!usuario && roles.includes(usuario.rol);
  }

  private getUsuarioGuardadoWeb(): Usuario | null {
    try {
      const raw = localStorage.getItem(USUARIO_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }
}
