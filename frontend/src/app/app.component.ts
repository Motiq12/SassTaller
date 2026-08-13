import { Component, NgZone, OnDestroy, OnInit } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { AlertController, ToastController } from '@ionic/angular';
import { filter, take } from 'rxjs/operators';
import { AccesibilidadService } from './services/accesibilidad.service';
import { MarcaService } from './services/marca.service';
import { AuthService } from './services/auth.service';
import { AvisoActivo, AvisoSistemaService } from './services/aviso-sistema.service';
import { ReporteFallaService } from './services/reporte-falla.service';
import { iniciarWebVitals } from './shared/web-vitals.util';

declare global {
  interface Window { __hideBootSplash?: () => void; }
}

@Component({
  selector: 'app-root',
  templateUrl: 'app.component.html',
  styleUrls: ['app.component.scss'],
  standalone: false,
})
export class AppComponent implements OnInit, OnDestroy {
  // Estado de conexión para el banner global "sin conexión".
  enLinea = typeof navigator !== 'undefined' ? navigator.onLine : true;

  // Aviso de Motiq hacia el personal del taller (franja arriba, distinta de la de
  // conexión). Es SOLO para staff (admin/recepción/mecánico): ni el portal de
  // clientes ni el panel de Motiq lo ven — cada uno es una audiencia distinta.
  avisoVisible: AvisoActivo | null = null;
  private readonly CERRADOS_KEY = 'motiq_avisos_cerrados';
  // Se reconsulta cada tanto mientras hay una sesión de staff abierta: alguien que
  // deja la pestaña abierta todo el día tiene que enterarse de un aviso nuevo sin
  // tener que recargar.
  private timerAviso: ReturnType<typeof setInterval> | null = null;
  private readonly AVISO_CADA_MS = 3 * 60 * 1000;

  // El botón de "reportar un problema" es la otra mitad de la pareja con el aviso:
  // mismo público (staff), sentido contrario (taller → Motiq en vez de Motiq → taller).
  esStaff = false;

  // Inyectar AccesibilidadService aplica la preferencia de tamaño de texto al arrancar.
  constructor(
    private zone: NgZone,
    private _a11y: AccesibilidadService,
    private router: Router,
    private marca: MarcaService,
    private auth: AuthService,
    private avisoSistema: AvisoSistemaService,
    private reporteFalla: ReporteFallaService,
    private alerta: AlertController,
    private toastCtrl: ToastController,
  ) {
    window.addEventListener('online', () => this.zone.run(() => (this.enLinea = true)));
    window.addEventListener('offline', () => this.zone.run(() => (this.enLinea = false)));
  }

  ngOnInit() {
    // Oculta la pantalla de arranque (index.html) recién cuando termina la
    // primera navegación real (ya pasó por guards/redirects) — evita un
    // parpadeo en blanco a mitad de una redirección inicial.
    this.router.events
      .pipe(filter((e) => e instanceof NavigationEnd), take(1))
      .subscribe(() => window.__hideBootSplash?.());

    // Core Web Vitals de usuarios reales. Es la única vía para conocer el INP:
    // Lighthouse no interactúa con la página, así que en laboratorio no existe.
    iniciarWebVitals();

    // Marca del taller. Con sesión se pide la completa; sin ella, la pública por
    // slug — el login se pinta antes de que exista un token. Va acá y no en cada
    // pantalla porque el color se aplica a toda la app: hacerlo por pantalla haría
    // que el color parpadeara al navegar.
    this.auth.usuario$.subscribe(u => {
      if (u) this.marca.get().subscribe();
      else this.marca.cargarPublica().subscribe();

      // El aviso es del lado del personal (admin/recepción/mecánico), no del cliente
      // del portal ni de nadie sin sesión: sin sesión de staff no hay ni token válido
      // para pedirlo (el endpoint usa el mismo middleware `auth` de siempre).
      if (u && this.auth.tieneRol('admin', 'recepcion', 'tecnico')) {
        this.esStaff = true;
        this.consultarAviso();
        if (!this.timerAviso) {
          this.timerAviso = setInterval(() => this.consultarAviso(), this.AVISO_CADA_MS);
        }
      } else {
        this.esStaff = false;
        this.avisoVisible = null;
        if (this.timerAviso) { clearInterval(this.timerAviso); this.timerAviso = null; }
      }
    });
  }

  ngOnDestroy() {
    if (this.timerAviso) clearInterval(this.timerAviso);
  }

  private consultarAviso() {
    this.avisoSistema.activo().subscribe({
      next: (r) => {
        const av = r.data;
        this.avisoVisible = av && !this.estaCerrado(av.id) ? av : null;
      },
      error: () => {},
    });
  }

  private cerradosGuardados(): number[] {
    try { return JSON.parse(localStorage.getItem(this.CERRADOS_KEY) || '[]'); } catch { return []; }
  }

  private estaCerrado(id: number): boolean {
    return this.cerradosGuardados().includes(id);
  }

  cerrarAviso() {
    if (!this.avisoVisible) return;
    // Guarda solo los últimos 20 ids: esta lista no tiene que crecer para siempre en
    // el localStorage de alguien que lleva meses usando el sistema.
    const cerrados = [...this.cerradosGuardados(), this.avisoVisible.id].slice(-20);
    localStorage.setItem(this.CERRADOS_KEY, JSON.stringify(cerrados));
    this.avisoVisible = null;
  }

  claseAviso(): string {
    return `aviso-sistema aviso-${this.avisoVisible?.tipo || 'info'}`;
  }

  iconoAviso(): string {
    const iconos: Record<string, string> = { mantenimiento: 'construct-outline', urgente: 'warning-outline' };
    return iconos[this.avisoVisible?.tipo || ''] || 'megaphone-outline';
  }

  // "Algo no funciona" hacia Motiq. Global (no en cada shell de rol) por la misma
  // razón que el aviso: vale desde cualquier pantalla del personal sin tener que
  // engancharlo en admin-shell, recepcion-tabs, mecanico-tabs y tabs por separado.
  async reportarProblema() {
    const a = await this.alerta.create({
      header: 'Reportar un problema',
      message: 'Contanos qué pasó. Le llega directo a Motiq con tu taller y tu nombre — no hace falta escribir por otro lado.',
      inputs: [
        {
          name: 'descripcion', type: 'textarea',
          placeholder: 'Ej: Al guardar una orden no aparece en la lista.',
          attributes: { maxlength: 2000 },
        },
      ],
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Enviar',
          handler: (d) => {
            const descripcion = String(d.descripcion || '').trim();
            if (!descripcion) return false;
            this.reporteFalla.enviar(descripcion, this.router.url).subscribe({
              next: async (r) => (await this.toastCtrl.create({ message: r.message, duration: 3500, color: 'success', position: 'bottom' })).present(),
              error: async (e) => (await this.toastCtrl.create({ message: e?.error?.error || 'No se pudo enviar', duration: 3500, color: 'danger', position: 'bottom' })).present(),
            });
            return true;
          },
        },
      ],
    });
    await a.present();
  }
}
