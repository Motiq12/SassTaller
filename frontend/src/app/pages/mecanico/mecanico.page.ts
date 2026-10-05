import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { Router } from '@angular/router';
import { AlertController, ToastController } from '@ionic/angular';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { MecanicoService, ResumenMecanico } from '../../services/mecanico.service';
import { AuthService } from '../../services/auth.service';

@Component({
  standalone: false,
  selector: 'app-mecanico',
  templateUrl: './mecanico.page.html',
  styleUrls: ['./mecanico.page.scss'],
})
export class MecanicoPage implements OnInit, OnDestroy {
  private mecanico = inject(MecanicoService);
  private auth = inject(AuthService);
  private router = inject(Router);
  private alert = inject(AlertController);
  private toast = inject(ToastController);

  private destroy$ = new Subject<void>();
  resumen?: ResumenMecanico;
  citas: any[] = [];
  cargando = true;
  notasAbiertas = new Set<number>();
  hoy = new Date().toISOString().slice(0, 10);

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
  readonly estadoBadge: Record<string, string> = {
    agendado: 'agendado',
    en_revision: 'revision',
    en_mantenimiento: 'mantenimiento',
    listo: 'listo',
    entregado: 'entregado',
    cancelado: 'cancelado',
  };
  readonly progreso: Record<string, number> = {
    agendado: 10, en_revision: 35, en_mantenimiento: 65, listo: 85, entregado: 100, cancelado: 0,
  };
  // Caja de cotización de la orden vinculada.
  readonly cotizLabel: Record<string, string> = { aprobado: 'Aprobada', rechazado: 'Rechazada', pendiente: 'Pendiente' };
  readonly cotizPill: Record<string, string> = { aprobado: 'green', rechazado: 'rose', pendiente: 'amber' };

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
  get citasHoy(): any[] {
    return this.citas.filter(c =>
      c.fecha?.slice(0, 10) === this.hoy || ['en_revision', 'en_mantenimiento'].includes(c.estado)
    );
  }

  progresoPct(estado: string): number { return this.progreso[estado] ?? 0; }

  toggleNotas(id: number) {
    this.notasAbiertas.has(id) ? this.notasAbiertas.delete(id) : this.notasAbiertas.add(id);
  }

  necesitaMonto(_estado: string): boolean { return false; }

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

  // Cambio desde el <select>: si pide monto, lo pregunta; si se cancela, la vista revierte sola.
  onEstadoChange(cita: any, nuevo: string) {
    if (!nuevo || nuevo === cita.estado) return;
    this.cambiarEstado(cita, nuevo);
  }

  async cambiarEstado(cita: any, estado: string) {
    if (this.necesitaMonto(estado)) {
      const al = await this.alert.create({
        header: this.estadoLabel[estado],
        message: 'Monto cobrado por el servicio (₡)',
        inputs: [{ name: 'monto', type: 'number', value: cita.monto || '', placeholder: '0' }],
        buttons: [
          { text: 'Cancelar', role: 'cancel' },
          { text: 'Guardar', handler: (data) => this.aplicarEstado(cita, estado, data.monto) },
        ],
      });
      await al.present();
      return;
    }
    this.aplicarEstado(cita, estado);
  }

  private aplicarEstado(cita: any, estado: string, monto?: any) {
    this.mecanico.cambiarEstado(cita.id, estado, monto !== undefined ? Number(monto) || 0 : undefined).pipe(takeUntil(this.destroy$)).subscribe({
      next: async () => {
        cita.estado = estado;
        if (monto !== undefined) cita.monto = Number(monto) || 0;
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
