import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Capacitor } from '@capacitor/core';
import { BehaviorSubject, Observable, tap } from 'rxjs';
import { environment } from '../../environments/environment';
import { Usuario, LoginResponse } from '../models/usuario.model';
import { secureGet, secureSet, secureRemove } from '../shared/secure-store.util';
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
  taller?: { nombre: string; slug: string } | null;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private apiUrl = environment.apiUrl;
  // En nativo el token vive en el Keychain/Keystore (ver secure-store.util); acá solo
  // se cachea en memoria para lecturas síncronas (interceptor, guards). En web sigue
  // siendo localStorage de punta a punta, igual que antes.
  private tokenCache: string | null = nativo ? null : localStorage.getItem(TOKEN_KEY);
  private usuarioSubject = new BehaviorSubject<Usuario | null>(nativo ? null : this.getUsuarioGuardadoWeb());

  usuario$ = this.usuarioSubject.asObservable();

  private taller = inject(TallerService);

  constructor(private http: HttpClient) {}

  // Confirmación del correo del personal: es la única vía para recuperar la contraseña.
  enviarCodigoCorreo(): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(`${this.apiUrl}/auth/verificar-correo/enviar`, {});
  }

  confirmarCorreo(codigo: string): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(`${this.apiUrl}/auth/verificar-correo`, { codigo });
  }

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

  login(email: string, password: string): Observable<{ data: LoginResponse }> {
    return this.http.post<{ data: LoginResponse }>(`${this.apiUrl}/auth/login`, this.taller.conTaller({ email, password })).pipe(
      tap(res => this.guardarSesion(res.data.token, res.data.usuario))
    );
  }

  // Login unificado (personal o cliente). No persiste: el llamador decide según `tipo`.
  // Si el usuario tiene verificación en dos pasos, la respuesta NO trae sesión:
  // llega `requiere_2fa` + `token_parcial` para canjear en verificar2FA().
  // Un solo login para todos. No se acota al taller guardado en el navegador: quien
  // visitó el enlace de un taller tiene que poder entrar igual a su cuenta de otro. Ese
  // taller solo se ofrece como `preferido`, por si el correo está en varios.
  loginUnificado(email: string, password: string, elegido?: string): Observable<{ data: LoginUnificadoResp }> {
    const taller = elegido || this.taller.deSubdominio();
    const preferido = taller ? undefined : this.taller.actual();
    return this.http.post<{ data: LoginUnificadoResp }>(`${this.apiUrl}/auth/login`, {
      email, password, ...(taller ? { taller } : {}), ...(preferido ? { preferido } : {}),
    });
  }

  private conSubdominio<T extends object>(cuerpo: T): T & { taller?: string } {
    const taller = this.taller.deSubdominio();
    return taller ? { ...cuerpo, taller } : cuerpo;
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
    return this.http.post<{ message: string }>(`${this.apiUrl}/auth/recuperar/solicitar`, this.conSubdominio({ email, ...antibot }));
  }

  /** Canjea el código y fija la contraseña nueva. No abre sesión: se vuelve al login. */
  confirmarRecuperacion(datos: { email: string; codigo: string; password: string }): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(`${this.apiUrl}/auth/recuperar/confirmar`, this.conSubdominio(datos));
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
    // Que la sesión deje de valer también en el servidor (si alguien copió el token).
    // Sin esperar la respuesta: salir no puede depender de la red. Solo el personal
    // tiene esta ruta; el token del portal la recibiría con 403.
    const token = this.tokenCache;
    if (token && this.usuarioSubject.value && !this.isTokenExpired()) {
      this.http.post(`${this.apiUrl}/auth/salir`, {}, { headers: { Authorization: `Bearer ${token}` } }).subscribe({ error: () => {} });
    }
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

  // Relee los datos del usuario de la API (/auth/me) y actualiza la sesión
  // guardada. Sirve para que un cambio de permisos que hizo el admin se refleje
  // en el menú sin tener que volver a iniciar sesión.
  refrescarUsuario(): Observable<{ data: Usuario }> {
    return this.http.get<{ data: Usuario }>(`${this.apiUrl}/auth/me`).pipe(
      tap(res => {
        const actual = this.getUsuario();
        const token = this.getToken();
        if (!actual || !token) return;
        this.guardarSesion(token, {
          ...actual,
          rol: res.data.rol,
          permisos_web: res.data.permisos_web || {},
          rol_id: res.data.rol_id ?? null,
          rol_nombre: res.data.rol_nombre ?? null,
          permisos: res.data.permisos || [],
          permisos_ajustables: res.data.permisos_ajustables || [],
          preferencias: res.data.preferencias ?? actual.preferencias,
          // La foto vive en el servidor: así se ve también al entrar desde otro equipo.
          foto: res.data.foto !== undefined ? res.data.foto : actual.foto,
        });
      })
    );
  }

  // ¿Las casillas de su rol (Equipo → Roles) le dejan hacer esto? Solo sirve para
  // esconder botones: el servidor lo vuelve a revisar en cada acción. Una casilla que
  // no se elige en su base no se revisa (decide la pantalla, como siempre), y con una
  // sesión de antes de que hubiera casillas se deja todo como estaba.
  puede(permiso: string): boolean {
    const u = this.getUsuario();
    if (!u) return false;
    if (u.rol === 'admin' || !u.permisos_ajustables) return true;
    return !u.permisos_ajustables.includes(permiso) || (u.permisos || []).includes(permiso);
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
