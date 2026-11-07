import { Component, OnInit, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { ToastController, AlertController } from '@ionic/angular';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { PortalService } from '../../services/portal.service';
import { FLUJO_CITA, ESTADO_CITA_LABEL } from '../../utils/servicios';
import { badgeProximidad, BadgeProximidad, diasHastaCita } from '../../utils/fecha-cita';

@Component({
  standalone: false,
  selector: 'app-portal-citas',
  templateUrl: './portal-citas.page.html',
  styleUrls: ['./portal-citas.page.scss'],
})
export class PortalCitasPage implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  citas: any[] = [];
  cargando = true;
  vista: 'pendientes' | 'historial' = 'pendientes';
  reporteAbierto = new Set<number>();
  confirmando = new Set<number>();

  // Buscador (por moto/placa/servicio) y filtro por estado (solo en pendientes).
  busqueda = '';
  filtroEstado = '';

  readonly flujo = FLUJO_CITA;
  readonly estadoLabel = ESTADO_CITA_LABEL;
  // Estados posibles de una cita pendiente (para los chips de filtro).
  readonly estadosPendiente = ['agendado', 'en_revision', 'en_mantenimiento', 'listo'];

  constructor(private portal: PortalService, private toast: ToastController, private alert: AlertController, private router: Router) {}

  ngOnInit() { this.cargar(); }
  ionViewWillEnter() { this.cargar(); }

  cargar() {
    this.cargando = true;
    this.portal.getCitas().pipe(takeUntil(this.destroy$)).subscribe({
      next: r => { this.citas = r.data; this.cargando = false; },
      error: () => { this.cargando = false; },
    });
  }

  get pendientes(): any[] {
    return this.citas.filter(c => !['entregado', 'cancelado'].includes(c.estado));
  }
  // Completadas (entregadas) del último año: las más viejas se ocultan de la lista.
  // Las canceladas NO aparecen acá; el backend ya no las devuelve al cliente.
  get historial(): any[] {
    const corte = new Date();
    corte.setFullYear(corte.getFullYear() - 1);
    const corteStr = corte.toISOString().slice(0, 10);
    return this.citas.filter(c => c.estado === 'entregado' && (c.fecha || '') >= corteStr);
  }

  // ¿Hay algún filtro/búsqueda activo? (para distinguir "sin resultados" de "sin citas")
  get hayFiltro(): boolean { return !!this.busqueda.trim() || !!this.filtroEstado; }
  limpiarFiltros() { this.busqueda = ''; this.filtroEstado = ''; }
  toggleEstado(e: string) { this.filtroEstado = this.filtroEstado === e ? '' : e; }

  // Texto de la cita contra el que se busca (moto, placa, servicio).
  private coincide(c: any): boolean {
    const q = this.busqueda.trim().toLowerCase();
    if (!q) return true;
    const texto = `${c.marca || ''} ${c.modelo || ''} ${c.placa || ''} ${c.tipo_servicio || c.motivo || ''}`.toLowerCase();
    return texto.includes(q);
  }

  // Listas finales que ve el template (base + búsqueda + filtro de estado).
  get pendientesVista(): any[] {
    return this.pendientes.filter(c => this.coincide(c) && (!this.filtroEstado || c.estado === this.filtroEstado));
  }
  get historialVista(): any[] {
    return this.historial.filter(c => this.coincide(c));
  }

  // Badge "Hoy/Mañana/En N días" para citas agendadas próximas.
  badge(c: any): BadgeProximidad | null {
    return c?.estado === 'agendado' ? badgeProximidad(c.fecha) : null;
  }

  // El botón de confirmar asistencia aparece desde el día antes de la cita
  // (hoy o mañana) y solo si está agendada y aún no la confirmó.
  puedeConfirmar(c: any): boolean {
    if (c?.estado !== 'agendado' || c.confirmada_cliente) return false;
    const d = diasHastaCita(c.fecha);
    return d !== null && d >= 0 && d <= 1;
  }

  // Confirmar asistencia a una cita agendada.
  confirmar(c: any, ev?: Event) {
    ev?.stopPropagation();
    if (this.confirmando.has(c.id)) return;
    this.confirmando.add(c.id);
    this.portal.confirmarCita(c.id).pipe(takeUntil(this.destroy$)).subscribe({
      next: async () => {
        c.confirmada_cliente = 1;
        this.confirmando.delete(c.id);
        const t = await this.toast.create({ message: '¡Asistencia confirmada! Te esperamos.', duration: 2200, color: 'success' });
        await t.present();
      },
      error: async (e) => {
        this.confirmando.delete(c.id);
        const t = await this.toast.create({ message: e.error?.error || 'No se pudo confirmar', duration: 2400, color: 'danger' });
        await t.present();
      },
    });
  }

  irAgendar() { this.router.navigate(['/portal/agendar']); }
  // Total pagado histórico (todas las entregadas, sin importar el filtro de 1 año).
  get totalPagado(): number {
    return this.citas.filter(c => c.estado === 'entregado').reduce((s, c) => s + Number(c.monto || 0), 0);
  }

  // Índice del estado en el flujo (para la barra de progreso). -1 si cancelado.
  pasoActual(estado: string): number {
    return this.flujo.indexOf(estado);
  }
  progresoPct(estado: string): number {
    const i = this.pasoActual(estado);
    if (i < 0) return 0;
    return Math.round((i / (this.flujo.length - 1)) * 100);
  }

  toggleReporte(id: number) {
    this.reporteAbierto.has(id) ? this.reporteAbierto.delete(id) : this.reporteAbierto.add(id);
  }

  async calificar(cita: any) {
    const al = await this.alert.create({
      cssClass: 'portal-alert',
      header: '¿Cómo fue el servicio?',
      inputs: [1, 2, 3, 4, 5].map(n => ({ type: 'radio' as const, label: '★'.repeat(n) + ` (${n})`, value: n })),
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        { text: 'Enviar', handler: (n) => this.enviarCalif(cita, n) },
      ],
    });
    await al.present();
  }

  private enviarCalif(cita: any, n: number) {
    if (!n) return;
    this.portal.calificarCita(cita.id, n).pipe(takeUntil(this.destroy$)).subscribe({
      next: async () => {
        cita.calificacion = n;
        const t = await this.toast.create({ message: '¡Gracias por tu opinión!', duration: 2000, color: 'success' });
        await t.present();
      },
      error: async (err) => {
        const t = await this.toast.create({ message: err.error?.error || 'No se pudo calificar', duration: 2200, color: 'danger' });
        await t.present();
      },
    });
  }

  ngOnDestroy() { this.destroy$.next(); this.destroy$.complete(); }

  estrellas(n: number): string { return '★'.repeat(n) + '☆'.repeat(5 - n); }

  verDetalle(c: any) { window.location.href = `/portal/cita/${c.id}`; }

  // El presupuesto se aprueba en Inicio (donde está el flujo aprobar/rechazar).
  irAInicio() { this.router.navigate(['/portal/inicio']); }
}
