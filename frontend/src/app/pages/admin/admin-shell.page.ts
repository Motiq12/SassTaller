import { Component, OnDestroy, OnInit } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { Subject, interval } from 'rxjs';
import { filter, takeUntil } from 'rxjs/operators';
import { AuthService } from '../../services/auth.service';
import { MensajeriaService } from '../../services/mensajeria.service';
import { SitioWebService } from '../../services/sitio-web.service';
import { veSitioWeb } from '../../guards/panel-admin.guard';
import { SITIO_WEB_URL } from '../../shared/volver-web.component';
import { sitioWeb } from '../../sitio-web-activo';

// Carpetas del menú y qué rutas viven en cada una: la carpeta de la pantalla en la
// que se está se abre sola (al entrar por un enlace, o al abrir una orden desde
// Gestión de citas, se ve dónde está uno). El orden importa: config/bloqueos va en
// Agenda, el resto de config/ en Configuración.
const CARPETA_DE_RUTA: [string, string][] = [
  ['/admin/web/', 'web'],
  ['/admin/recibir', 'agenda'], ['/admin/citas', 'agenda'], ['/admin/cita-form', 'agenda'], ['/admin/calendario', 'agenda'], ['/admin/config/bloqueos', 'agenda'],
  ['/admin/empleados', 'equipo'], ['/admin/roles', 'equipo'], ['/admin/tareas', 'equipo'], ['/admin/mensajes', 'equipo'],
  ['/admin/reportes', 'analisis'], ['/admin/opiniones', 'analisis'], ['/admin/promos', 'analisis'],
  // Las órdenes se manejan en Gestión de citas (Agenda): abrir una deja esa carpeta abierta.
  ['/admin/ordenes', 'agenda'], ['/admin/detalle-orden', 'agenda'], ['/admin/nueva-orden', 'agenda'], ['/admin/factura', 'agenda'],
  ['/admin/clientes', 'operacion'], ['/admin/cliente-', 'operacion'],
  ['/admin/moto-', 'operacion'], ['/admin/servicios', 'operacion'], ['/admin/garantias', 'operacion'],
  ['/admin/config', 'config'],
];
const KEY_CARPETAS = 'tallerms_menu_carpetas';

@Component({
  standalone: false,
  selector: 'app-admin-shell',
  templateUrl: './admin-shell.page.html',
})
export class AdminShellPage implements OnInit, OnDestroy {
  // El sitio web público, para el enlace del final del menú.
  sitioWeb = SITIO_WEB_URL;
  get sitioWebActivo(): boolean { return sitioWeb.activo; }
  private destroy$ = new Subject<void>();
  noLeidos = 0;
  pendientesWeb = 0;
  consultasWeb = 0;
  resenasWeb = 0;
  // Carpetas abiertas del menú. La primera vez, Agenda (lo que más se usa).
  private abiertas = new Set<string>(this.leerAbiertas());

  constructor(
    private auth: AuthService,
    private msj: MensajeriaService,
    private web: SitioWebService,
    private router: Router,
  ) {}

  get esAdmin(): boolean { return this.auth.getUsuario()?.rol === 'admin'; }
  get veWeb(): boolean { return veSitioWeb(this.auth.getUsuario()); }
  get veConsultas(): boolean { return this.esAdmin || !!this.auth.getUsuario()?.permisos_web?.['consultas']; }
  get veResenas(): boolean { return this.esAdmin || !!this.auth.getUsuario()?.permisos_web?.['resenas']; }
  get vePaginas(): boolean { return this.esAdmin || !!this.auth.getUsuario()?.permisos_web?.['paginas']; }
  get veNegocio(): boolean { return this.esAdmin || !!this.auth.getUsuario()?.permisos_web?.['negocio']; }
  get nombre(): string { return this.auth.getUsuario()?.nombre || 'Administrador'; }
  get foto(): string | null { return (this.auth.getUsuario() as any)?.foto || null; }
  get rolLabel(): string {
    const rol = this.auth.getUsuario()?.rol;
    if (rol === 'admin') return 'Administrador';
    if (rol === 'contenido') return 'Contenido web';
    return rol === 'recepcion' ? 'Recepción · sitio web' : 'Sitio web';
  }
  get iniciales(): string {
    const p = this.nombre.trim().split(/\s+/);
    return ((p[0]?.[0] || '') + (p[1]?.[0] || '')).toUpperCase() || 'A';
  }

  abierta(id: string): boolean { return this.abiertas.has(id); }

  alternar(id: string, ev: Event) {
    // Sin esto, ion-menu-toggle (que envuelve el menú) lo cerraría en el celular.
    ev.stopPropagation();
    if (this.abiertas.has(id)) this.abiertas.delete(id); else this.abiertas.add(id);
    this.guardarAbiertas();
  }

  private abrirCarpetaDe(url: string) {
    const carpeta = CARPETA_DE_RUTA.find(([prefijo]) => url.startsWith(prefijo))?.[1];
    this.carpetaActual = carpeta || null;
    if (carpeta && !this.abiertas.has(carpeta)) { this.abiertas.add(carpeta); this.guardarAbiertas(); }
  }

  // La carpeta de la pantalla en la que se está: se marca aunque esté cerrada.
  carpetaActual: string | null = null;
  actual(id: string): boolean { return this.carpetaActual === id; }

  // Se guarda en este navegador; si el almacenamiento no está (modo privado), el
  // menú funciona igual, solo que no se acuerda.
  private leerAbiertas(): string[] {
    try {
      const v = JSON.parse(localStorage.getItem(KEY_CARPETAS) || 'null');
      if (Array.isArray(v)) return v;
    } catch {}
    return ['agenda', 'web'];
  }
  private guardarAbiertas() {
    try { localStorage.setItem(KEY_CARPETAS, JSON.stringify([...this.abiertas])); } catch {}
  }

  ngOnInit() {
    this.abrirCarpetaDe(this.router.url);
    this.router.events.pipe(filter(e => e instanceof NavigationEnd), takeUntil(this.destroy$))
      .subscribe(e => this.abrirCarpetaDe((e as NavigationEnd).urlAfterRedirects));
    // Los permisos pudieron cambiar desde que inició sesión (el admin se los da o
    // se los quita): se releen para que el menú muestre lo que corresponde.
    this.auth.refrescarUsuario().pipe(takeUntil(this.destroy$)).subscribe({
      next: () => {
        // Si le quitaron todos los permisos, la guardia lo devuelve a su pantalla.
        if (!this.veWeb && !this.esAdmin) this.router.navigateByUrl('/admin/web', { replaceUrl: true });
        else if (this.veWeb) this.web.refrescarPendientes();
      },
      error: () => {},
    });
    this.web.pendientes$.pipe(takeUntil(this.destroy$)).subscribe(n => this.pendientesWeb = n);
    this.web.consultas$.pipe(takeUntil(this.destroy$)).subscribe(n => this.consultasWeb = n);
    this.web.resenas$.pipe(takeUntil(this.destroy$)).subscribe(n => this.resenasWeb = n);
    // Las consultas y las reseñas del sitio llegan solas, sin que nadie toque nada
    // en el panel: cada minuto se vuelve a mirar, para que el globo aparezca sin recargar.
    if (this.veWeb) {
      interval(60000).pipe(takeUntil(this.destroy$)).subscribe(() => this.web.refrescarPendientes());
    }
    // La mensajería interna es del taller: quien entra solo por la web no la usa.
    if (!this.esAdmin) return;
    this.consultarNoLeidos();
    interval(30000).pipe(takeUntil(this.destroy$)).subscribe(() => this.consultarNoLeidos());
  }

  ngOnDestroy() { this.destroy$.next(); this.destroy$.complete(); }

  private consultarNoLeidos() {
    // Con la sesión cerrada o vencida no se pregunta: cada vez sería un rechazo.
    if (!this.auth.isLoggedIn() || this.auth.isTokenExpired()) return;
    this.msj.getNoLeidos().pipe(takeUntil(this.destroy$)).subscribe({
      next: r => this.noLeidos = r.data.count,
      error: () => {},
    });
  }

  logout() {
    this.auth.logout();
    this.router.navigate(['/login'], { replaceUrl: true });
  }
}
