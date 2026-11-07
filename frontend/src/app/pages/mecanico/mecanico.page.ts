import { Component, OnInit, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { AlertController, ToastController } from '@ionic/angular';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { MecanicoService, ResumenMecanico } from '../../services/mecanico.service';
import { AuthService } from '../../services/auth.service';
import { hoyCR } from '../../utils/fecha-cita';

@Component({
  standalone: false,
  selector: 'app-mecanico',
  templateUrl: './mecanico.page.html',
  styleUrls: ['./mecanico.page.scss'],
})
export class MecanicoPage implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  resumen?: ResumenMecanico;
  citas: any[] = [];
  cargando = true;
  notasAbiertas = new Set<number>();
  hoy = hoyCR();

  readonly estados = ['agendado', 'en_revision', 'en_mantenimiento', 'listo', 'entregado', 'cancelado'];
  readonly estadoLabel: Record<string, string> = {
    agendado: 'Agendado',
    en_revision: 'En revisión',
    en_mantenimiento: 'En mantenimiento',
    listo: 'Listo',
    entregado: 'Entregado',
    cancelado: 'Cancelado',
  };
  // Clase del badge (coincide con el SCSS .st-badge.<x>).
  // Color de la etiqueta de estado (.pill del estándar: los colores del panel).
  readonly estadoPill: Record<string, string> = {
    agendado: 'indigo',
    en_revision: 'amber',
    en_mantenimiento: 'rose',
    listo: 'green',
    entregado: 'gris',
    cancelado: 'gris',
  };
  readonly progreso: Record<string, number> = {
    agendado: 10, en_revision: 35, en_mantenimiento: 65, listo: 85, entregado: 100, cancelado: 0,
  };
  // Caja de cotización de la orden vinculada.
  readonly cotizLabel: Record<string, string> = { aprobado: 'Aprobada', rechazado: 'Rechazada', pendiente: 'Pendiente' };
  readonly cotizPill: Record<string, string> = { aprobado: 'green', rechazado: 'rose', pendiente: 'amber' };

  constructor(
    private mecanico: MecanicoService,
    private auth: AuthService,
    private router: Router,
    private alert: AlertController,
    private toast: ToastController
  ) {}

  ngOnInit() { this.cargar(); }
  ngOnDestroy() { this.destroy$.next(); this.destroy$.complete(); }
  ionViewWillEnter() { this.cargar(); }

  get nombre(): string { return (this.auth.getUsuario()?.nombre || 'Mecánico').split(' ')[0]; }

  get fechaHoy(): string {
    return new Date().toLocaleDateString('es-CR', { weekday: 'long', day: 'numeric', month: 'long' });
  }

  cargar(ev?: any) {
    this.cargando = true;
    this.mecanico.getResumen().pipe(takeUntil(this.destroy$)).subscribe({ next: r => this.resumen = r.data });
    this.mecanico.getCitas().pipe(takeUntil(this.destroy$)).subscribe({
      next: r => { this.citas = r.data; this.cargando = false; if (ev) ev.target.complete(); },
      error: () => { this.cargando = false; if (ev) ev.target.complete(); },
    });
  }

  // En el Inicio se muestran las citas de hoy + cualquier trabajo activo (no se esconde nada en curso).
  // Por eso la tarjeta se llama "Hoy y en curso" y no "Citas de hoy": la cifra "Citas hoy"
  // de arriba cuenta solo las de hoy, y los dos números no coincidían.
  get citasHoy(): any[] {
    return this.citas.filter(c => this.esDeHoy(c) || ['en_revision', 'en_mantenimiento'].includes(c.estado));
  }

  // Los trabajos de otro día llevan la fecha delante de la hora.
  esDeHoy(c: any): boolean { return c.fecha?.slice(0, 10) === this.hoy; }
  // "27/10" sacado del texto: el pipe date leería "2026-10-27" como medianoche UTC,
  // que en Costa Rica cae el día anterior.
  diaMes(fecha?: string): string { const f = (fecha || '').slice(0, 10); return f ? `${f.slice(8, 10)}/${f.slice(5, 7)}` : ''; }

  progresoPct(estado: string): number { return this.progreso[estado] ?? 0; }

  toggleNotas(id: number) {
    this.notasAbiertas.has(id) ? this.notasAbiertas.delete(id) : this.notasAbiertas.add(id);
  }

  // Transiciones válidas del flujo de la cita (espejo del backend utils/transiciones.js).
  // El <select> ofrece solo el estado actual + sus siguientes, para no pedir saltos que
  // el backend rechaza (p. ej. agendado→listo).
  private readonly siguientesCita: Record<string, string[]> = {
    agendado: ['en_revision'],
    en_revision: ['en_mantenimiento', 'listo'],
    en_mantenimiento: ['listo'],
    listo: [],
    entregado: [],
    cancelado: [],
  };

  opcionesEstado(actual: string): string[] {
    return [actual, ...(this.siguientesCita[actual] || [])];
  }

  // Cambio desde el <select>. El mecánico no anota montos: el cobro lo registra recepción al entregar.
  onEstadoChange(cita: any, nuevo: string) {
    if (!nuevo || nuevo === cita.estado) return;
    this.cambiarEstado(cita, nuevo);
  }

  cambiarEstado(cita: any, estado: string) {
    this.mecanico.cambiarEstado(cita.id, estado).pipe(takeUntil(this.destroy$)).subscribe({
      next: async () => {
        cita.estado = estado;
        this.mecanico.getResumen().pipe(takeUntil(this.destroy$)).subscribe({ next: r => this.resumen = r.data });
        const t = await this.toast.create({ message: 'Estado actualizado', duration: 1400, color: 'success' });
        await t.present();
      },
      error: async () => {
        const t = await this.toast.create({ message: 'No se pudo actualizar', duration: 2000, color: 'danger' });
        await t.present();
      },
    });
  }

  formatMin(min: number | null | undefined): string {
    if (!min) return '—';
    const h = Math.floor(min / 60);
    const m = Math.round(min % 60);
    return h ? `${h}h ${m}m` : `${m}m`;
  }

  estrellas(prom: number | null): string {
    if (!prom) return '—';
    const llenas = Math.round(prom);
    return '★'.repeat(llenas) + '☆'.repeat(5 - llenas);
  }

  irAgenda() { this.router.navigate(['/mecanico/agenda']); }

  // Cita vinculada a una orden: la orden manda, así que el mecánico la trabaja en su pantalla.
  trabajarOrden(c: any) { this.router.navigate(['/detalle-orden', c.orden_id]); }

  logout() {
    this.auth.logout();
    this.router.navigate(['/portal/login'], { replaceUrl: true });
  }
}
