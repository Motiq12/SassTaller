import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, finalize, of, tap } from 'rxjs';
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

// Respuesta del paso de la contraseña: nunca trae sesión, solo un token parcial (5 min)
// y qué falta. `requiere_2fa`: pedir el código. `requiere_configurar_2fa`: primer
// ingreso, configurar la app con el QR.
export interface PasoIngreso {
  token_parcial: string;
  requiere_2fa?: boolean;
  requiere_configurar_2fa?: boolean;
}

// Clave nueva de la app de autenticación. `uri` es la otpauth:// que va en el QR.
export interface ClaveDosPasos { secreto: string; secreto_legible: string; uri: string; }

// Sesión abierta. `codigos_respaldo` llega una sola vez: al activar el segundo factor.
export interface SesionMotiq { token: string; admin: AdminPlataforma; codigos_respaldo?: string[]; }

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
  talleres: { total: number; activos: number; suspendidos: number; en_prueba: number;
              en_gratis?: number; en_pro?: number; nuevos_30d: number };
  uso: { usuarios: number; clientes: number; vehiculos: number; ordenes: number };
  contactos: { sin_atender: number };
  // Altas por mes: un total acumulado no dice si el negocio crece o está plano.
  altas: { mes: string; talleres: number }[];
  // Los números por los que se llama, o se entra a revisar, a alguien.
  alertas: { vencen_semana: number; inactivos: number; reportes_nuevos: number };
}

// La ficha completa de un taller: lo que hay que tener delante cuando llama.
export interface FichaTaller {
  taller: TallerDelPanel & {
    nombre_taller: string | null; telefono: string | null; email: string | null;
    direccion: string | null; tipos_vehiculo: any; tiene_logo: number;
    color_primario: string | null; dias_restantes: number | null;
  };
  usuarios: { id: number; nombre: string; email: string; rol: string; telefono: string | null;
              activo: number; email_verificado: number; created_at: string }[];
  sucursales: { id: number; nombre: string; direccion: string | null; telefono: string | null; activa: number }[];
  uso: { clientes: number; vehiculos: number; ordenes: number; citas: number;
         ultima_orden: string | null; ordenes_30d: number };
}

// A quién se le acaba la prueba. Trae el contacto del dueño porque el paso siguiente
// después de mirar esta lista es escribirle.
export interface Vencimiento {
  id: number; nombre: string; slug: string; plan: string; trial_hasta: string;
  dias_restantes: number; admin_nombre: string | null; admin_email: string | null;
  admin_telefono: string | null; ordenes: number;
}

export interface TallerInactivo {
  id: number; nombre: string; slug: string; plan: string; created_at: string;
  ultima_orden: string | null; ordenes: number; admin_email: string | null;
}

// Mi espacio de trabajo. Los datos del SaaS son compartidos —los dos administran
// todo— pero la agenda de cada uno es suya.
export interface Pendiente {
  id: number; texto: string; tenant_id: number | null; vence_el: string | null;
  hecha: number; created_at: string; taller_nombre: string | null;
  taller_slug: string | null; dias: number | null;
}

export interface TallerSeguido {
  id: number; nota: string | null; nombre: string; slug: string; plan: string;
  estado: string; trial_hasta: string | null; dias_restantes: number | null;
  ordenes: number; ultima_orden: string | null;
}

export interface LineaBitacora {
  id: number; accion: string; tenant_id: number | null; tenant_slug: string | null;
  detalle: string | null; created_at: string; admin_email?: string;
}

export interface MiEspacio {
  tareas: Pendiente[];
  seguidos: TallerSeguido[];
  actividad: LineaBitacora[];
  equipo: LineaBitacora[];
}

export interface CuentaPlataforma {
  id: number; nombre: string; email: string; activo: number;
  ultimo_acceso: string | null; created_at: string;
}

// Lo que incluye cada plan. Antes vivía solo como constante en el backend
// (utils/limites.js); acá se puede editar sin tocar código ni redesplegar.
export interface PlanConfig {
  plan: string;
  precio_mensual: number;
  limite_usuarios: number | null;
  limite_sucursales: number | null;
  marca_propia: number;
  reportes_dias: number | null;
  updated_at: string;
}

// Un aviso de Motiq hacia el personal de los talleres (franja arriba de su
// pantalla) — mantenimiento, una función nueva, lo que haga falta avisar.
export interface AvisoPlataforma {
  id: number; mensaje: string; tipo: 'info' | 'mantenimiento' | 'urgente';
  activo: number; vence_el: string | null;
  admin_email: string | null; created_at: string; updated_at: string;
}

// "Algo no funciona" — del personal de un taller hacia Motiq. Al revés de
// AvisoPlataforma (Motiq hacia el personal).
export interface ReporteFalla {
  id: number;
  tenant_id: number | null; tenant_nombre: string | null; tenant_slug: string | null;
  usuario_nombre: string | null; usuario_email: string | null; usuario_rol: string | null;
  descripcion: string; pantalla: string | null;
  estado: 'nuevo' | 'revisando' | 'resuelto' | 'descartado';
  nota_interna: string | null; created_at: string;
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
  private http = inject(HttpClient);

  private apiUrl = environment.apiUrl;
  // El panel es de escritorio y no se compila a la app nativa, así que acá alcanza
  // localStorage; no hace falta el Keychain como en AuthService.
  private token: string | null = localStorage.getItem(TOKEN_KEY);

  getToken(): string | null { return this.token; }

  get admin(): AdminPlataforma | null {
    try { return JSON.parse(localStorage.getItem(ADMIN_KEY) || 'null'); } catch { return null; }
  }

  // El nombre y el correo del admin logueado viajan en el token/localStorage desde el
  // login, y no se releen del servidor en cada request. Si edita su propio perfil, hay
  // que actualizar esta copia local a mano — si no, el saludo y el pie de la barra
  // lateral siguen mostrando el nombre viejo hasta el próximo login.
  actualizarAdminLocal(datos: Partial<AdminPlataforma>): void {
    const actual = this.admin;
    if (!actual) return;
    localStorage.setItem(ADMIN_KEY, JSON.stringify({ ...actual, ...datos }));
  }

  // ── Ingreso en dos pasos (B-06) ──
  // La contraseña sola nunca abre sesión: devuelve un token PARCIAL que solo sirve
  // para el segundo paso. Ver el contrato en backend/src/routes/motiq.routes.js.

  /** Paso 1: correo y contraseña. No guarda nada: todavía no hay sesión. */
  login(email: string, password: string): Observable<{ data: PasoIngreso }> {
    return this.http.post<{ data: PasoIngreso }>(`${this.apiUrl}/motiq/login`, { email, password });
  }

  /** Primer ingreso: genera la clave de la app de autenticación (para el QR). */
  configurarDosPasos(tokenParcial: string): Observable<{ data: ClaveDosPasos }> {
    return this.http.post<{ data: ClaveDosPasos }>(`${this.apiUrl}/motiq/login/configurar`, { token_parcial: tokenParcial });
  }

  /** Primer ingreso: el primer código activa el segundo factor y abre la sesión. */
  activarDosPasos(tokenParcial: string, codigo: string): Observable<{ data: SesionMotiq }> {
    return this.http.post<{ data: SesionMotiq }>(`${this.apiUrl}/motiq/login/activar`, { token_parcial: tokenParcial, codigo })
      .pipe(tap(res => this.guardarSesion(res.data)));
  }

  /** Con el segundo factor ya configurado: código de la app o uno de respaldo. */
  verificarDosPasos(tokenParcial: string, codigo: string): Observable<{ data: SesionMotiq }> {
    return this.http.post<{ data: SesionMotiq }>(`${this.apiUrl}/motiq/login/verificar`, { token_parcial: tokenParcial, codigo })
      .pipe(tap(res => this.guardarSesion(res.data)));
  }

  private guardarSesion(s: SesionMotiq): void {
    this.token = s.token;
    localStorage.setItem(TOKEN_KEY, s.token);
    localStorage.setItem(ADMIN_KEY, JSON.stringify(s.admin));
  }

  /**
   * "Salir" del panel: cierra la sesión también en el servidor, para que el token no
   * sirva aunque alguien lo haya copiado. Se borra la copia local pase lo que pase.
   */
  salir(): Observable<unknown> {
    return this.http.post(`${this.apiUrl}/motiq/salir`, {}).pipe(
      catchError(() => of(null)),
      finalize(() => this.logout()),
    );
  }

  /** Solo borra la sesión local (token vencido o ya cerrado en el servidor). */
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

  // Cierra el embudo: crea el taller a partir del contacto. Devuelve la contraseña
  // generada del admin, y es la única vez que se puede ver.
  crearTallerDesdeContacto(id: number, nombre: string, slug?: string): Observable<{
    data: { taller: { id: number; nombre: string; slug: string; plan: string }; admin: { email: string; password: string } };
    message: string;
  }> {
    return this.http.post<any>(`${this.apiUrl}/motiq/contactos/${id}/taller`, { nombre, slug });
  }

  resumen(): Observable<{ data: ResumenPlataforma }> {
    return this.http.get<{ data: ResumenPlataforma }>(`${this.apiUrl}/motiq/resumen`);
  }

  talleres(filtros: { estado?: string; plan?: string; q?: string } = {}): Observable<{ data: TallerDelPanel[] }> {
    const params: string[] = [];
    if (filtros.estado) params.push(`estado=${encodeURIComponent(filtros.estado)}`);
    if (filtros.plan) params.push(`plan=${encodeURIComponent(filtros.plan)}`);
    if (filtros.q) params.push(`q=${encodeURIComponent(filtros.q)}`);
    return this.http.get<{ data: TallerDelPanel[] }>(
      `${this.apiUrl}/motiq/talleres${params.length ? '?' + params.join('&') : ''}`
    );
  }

  cambiarEstado(id: number, estado: string, motivo?: string): Observable<{ message: string }> {
    return this.http.patch<{ message: string }>(`${this.apiUrl}/motiq/talleres/${id}/estado`, { estado, motivo });
  }

  // --- Mi espacio de trabajo ---

  espacio(): Observable<{ data: MiEspacio }> {
    return this.http.get<{ data: MiEspacio }>(`${this.apiUrl}/motiq/espacio`);
  }

  anotarPendiente(texto: string, tenant_id?: number | null, vence_el?: string | null): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(`${this.apiUrl}/motiq/tareas`, { texto, tenant_id, vence_el });
  }

  marcarPendiente(id: number, hecha: boolean): Observable<{ message: string }> {
    return this.http.patch<{ message: string }>(`${this.apiUrl}/motiq/tareas/${id}`, { hecha });
  }

  borrarPendiente(id: number): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(`${this.apiUrl}/motiq/tareas/${id}`);
  }

  seguir(tenantId: number, nota?: string): Observable<{ message: string }> {
    return this.http.put<{ message: string }>(`${this.apiUrl}/motiq/seguidos/${tenantId}`, { nota });
  }

  dejarDeSeguir(tenantId: number): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(`${this.apiUrl}/motiq/seguidos/${tenantId}`);
  }

  // --- Ficha, alertas y cuentas: lo que hasta ahora pedía una terminal ---

  ficha(id: number): Observable<{ data: FichaTaller }> {
    return this.http.get<{ data: FichaTaller }>(`${this.apiUrl}/motiq/talleres/${id}`);
  }

  vencimientos(dias = 7): Observable<{ data: Vencimiento[] }> {
    return this.http.get<{ data: Vencimiento[] }>(`${this.apiUrl}/motiq/vencimientos?dias=${dias}`);
  }

  inactivos(dias = 30): Observable<{ data: TallerInactivo[] }> {
    return this.http.get<{ data: TallerInactivo[] }>(`${this.apiUrl}/motiq/inactivos?dias=${dias}`);
  }

  cuentas(): Observable<{ data: CuentaPlataforma[] }> {
    return this.http.get<{ data: CuentaPlataforma[] }>(`${this.apiUrl}/motiq/admins`);
  }

  crearCuenta(nombre: string, email: string): Observable<{ data: CuentaPlataforma & { password: string }; message: string }> {
    return this.http.post<{ data: CuentaPlataforma & { password: string }; message: string }>(
      `${this.apiUrl}/motiq/admins`, { nombre, email }
    );
  }

  activarCuenta(id: number, activo: boolean): Observable<{ message: string }> {
    return this.http.patch<{ message: string }>(`${this.apiUrl}/motiq/admins/${id}`, { activo });
  }

  // Editar el propio perfil o el de un compañero: acá no hay permisos parciales,
  // igual que para suspender un taller.
  editarCuenta(id: number, nombre: string, email: string): Observable<{ message: string }> {
    return this.http.patch<{ message: string }>(`${this.apiUrl}/motiq/admins/${id}`, { nombre, email });
  }

  // --- Planes ---

  planes(): Observable<{ data: PlanConfig[] }> {
    return this.http.get<{ data: PlanConfig[] }>(`${this.apiUrl}/motiq/planes`);
  }

  actualizarPlan(plan: string, datos: {
    precio_mensual: number; limite_usuarios: number | null; limite_sucursales: number | null;
    marca_propia: boolean; reportes_dias: number | null;
  }): Observable<{ message: string }> {
    return this.http.patch<{ message: string }>(`${this.apiUrl}/motiq/planes/${plan}`, datos);
  }

  // --- Avisos hacia los talleres ---

  avisos(): Observable<{ data: AvisoPlataforma[] }> {
    return this.http.get<{ data: AvisoPlataforma[] }>(`${this.apiUrl}/motiq/avisos`);
  }

  crearAviso(mensaje: string, tipo: string, vence_el: string | null = null): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(`${this.apiUrl}/motiq/avisos`, { mensaje, tipo, vence_el });
  }

  actualizarAviso(id: number, datos: { mensaje?: string; tipo?: string; vence_el?: string | null; activo?: boolean }): Observable<{ message: string }> {
    return this.http.patch<{ message: string }>(`${this.apiUrl}/motiq/avisos/${id}`, datos);
  }

  // --- Reportes de falla ---

  reportes(estado = ''): Observable<{ data: ReporteFalla[] }> {
    return this.http.get<{ data: ReporteFalla[] }>(
      `${this.apiUrl}/motiq/reportes${estado ? `?estado=${encodeURIComponent(estado)}` : ''}`
    );
  }

  actualizarReporte(id: number, estado: string, nota_interna?: string): Observable<{ message: string }> {
    return this.http.patch<{ message: string }>(`${this.apiUrl}/motiq/reportes/${id}`, { estado, nota_interna });
  }

  cambiarPassword(actual: string, nueva: string): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(`${this.apiUrl}/motiq/password`, { actual, nueva });
  }

  // Pide el identificador del taller como confirmación: es la única acción del
  // producto que no se puede deshacer.
  borrarTaller(id: number, confirmacion: string): Observable<{ message: string; filas: number }> {
    return this.http.request<{ message: string; filas: number }>(
      'delete', `${this.apiUrl}/motiq/talleres/${id}`, { body: { confirmacion } }
    );
  }

  cambiarPlan(id: number, plan: string, trial_hasta?: string | null): Observable<{ message: string }> {
    return this.http.patch<{ message: string }>(`${this.apiUrl}/motiq/talleres/${id}/plan`, { plan, trial_hasta });
  }
}
