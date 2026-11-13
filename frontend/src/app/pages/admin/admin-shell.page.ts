import { Component, OnDestroy, OnInit } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { Subject, interval } from 'rxjs';
import { filter, takeUntil } from 'rxjs/operators';
import { AuthService } from '../../services/auth.service';
import { MensajeriaService } from '../../services/mensajeria.service';

// Carpetas del menú y qué rutas viven en cada una: la carpeta de la pantalla en la
// que se está se abre sola (al entrar por un enlace, o al abrir una orden desde
// Gestión de citas, se ve dónde está uno). El orden importa: config/bloqueos va en
// Agenda, el resto de config/ en Configuración.
const CARPETA_DE_RUTA: [string, string][] = [
  ['/admin/recibir', 'agenda'], ['/admin/citas', 'agenda'], ['/admin/cita-form', 'agenda'], ['/admin/calendario', 'agenda'], ['/admin/config/bloqueos', 'agenda'],
  ['/admin/empleados', 'equipo'], ['/admin/roles', 'equipo'], ['/admin/tareas', 'equipo'], ['/admin/mensajes', 'equipo'],
  ['/admin/reportes', 'analisis'], ['/admin/opiniones', 'analisis'], ['/admin/promos', 'analisis'],
  // Las órdenes se manejan en Gestión de citas (Agenda): abrir una deja esa carpeta abierta.
  ['/admin/ordenes', 'agenda'], ['/admin/detalle-orden', 'agenda'], ['/admin/nueva-orden', 'agenda'], ['/admin/factura', 'agenda'],
  ['/admin/clientes', 'operacion'], ['/admin/cliente-', 'operacion'],
  ['/admin/moto-', 'operacion'], ['/admin/servicios', 'operacion'], ['/admin/inventario', 'operacion'], ['/admin/garantias', 'operacion'],
  ['/admin/config', 'config'],
];
const KEY_CARPETAS = 'tallerms_menu_carpetas';

@Component({
  styleUrls: ['../../../theme/panel/base.scss', '../../../theme/panel/contenidos.scss', '../../../theme/panel/agenda.scss', '../../../theme/panel/capsulas.scss', '../../../theme/panel/estandar.scss'],
  standalone: false,
  selector: 'app-admin-shell',
  templateUrl: './admin-shell.page.html',
})
export class AdminShellPage implements OnInit, OnDestroy {
  // El sitio web público se apagó de forma definitiva: su sección del panel, su
  // menú y sus contadores se quitaron (F-02). El panel es todo del admin.
  private destroy$ = new Subject<void>();
  noLeidos = 0;
  // Carpetas abiertas del menú. La primera vez, Agenda (lo que más se usa).
  private abiertas = new Set<string>(this.leerAbiertas());

  constructor(
    private auth: AuthService,
    private msj: MensajeriaService,
    private router: Router,
  ) {}

  get esAdmin(): boolean { return this.auth.getUsuario()?.rol === 'admin'; }
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
    return ['agenda'];
  }
  private guardarAbiertas() {
    try { localStorage.setItem(KEY_CARPETAS, JSON.stringify([...this.abiertas])); } catch {}
  }

  ngOnInit() {
    this.abrirCarpetaDe(this.router.url);
    this.router.events.pipe(filter(e => e instanceof NavigationEnd), takeUntil(this.destroy$))
      .subscribe(e => this.abrirCarpetaDe((e as NavigationEnd).urlAfterRedirects));
    // La mensajería interna es del taller: la consulta y el globo son solo del admin.
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
