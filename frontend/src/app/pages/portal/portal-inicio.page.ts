import { Component, OnInit, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { AlertController, ToastController } from '@ionic/angular';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { PortalService } from '../../services/portal.service';
import { ESTADO_CITA_LABEL } from '../../utils/servicios';
import { badgeProximidad, BadgeProximidad } from '../../utils/fecha-cita';

@Component({
  standalone: false,
  selector: 'app-portal-inicio',
  templateUrl: './portal-inicio.page.html',
  styleUrls: ['./portal-inicio.page.scss'],
})
export class PortalInicioPage implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  resumen: any = null;
  presupuestos: any[] = [];      // órdenes esperando la aprobación del cliente
  detalle: Record<number, any> = {};
  expandido: number | null = null;
  procesando = false;
  cargando = true;
  readonly estadoLabel = ESTADO_CITA_LABEL;
  readonly fechaHoy = new Date().toLocaleDateString('es-CR', { weekday: 'short', day: 'numeric', month: 'short' });

  constructor(
    public portal: PortalService,
    private router: Router,
    private alert: AlertController,
    private toast: ToastController
  ) {}

  // Aviso del taller arriba del inicio (Configuración → Textos del portal).
  bienvenida: { titulo: string; texto: string } | null = null;

  // Las motos del cliente: "Tu garaje" y la foto de la tarjeta principal.
  motos: any[] = [];

  // Las etapas de una moto en el taller, en orden (los estados de la cita).
  readonly etapas = [
    { estado: 'agendado', label: 'Agendada' },
    { estado: 'en_revision', label: 'Revisión' },
    { estado: 'en_mantenimiento', label: 'Reparación' },
    { estado: 'listo', label: 'Lista' },
    { estado: 'entregado', label: 'Entregada' },
  ];
  etapaActual(estado: string): number { return Math.max(0, this.etapas.findIndex(e => e.estado === estado)); }

  // Sellos de la tarjeta de cliente: los normales, sin contar el de cortesía.
  get metaSellos(): number { return (this.resumen?.recompensas?.meta || 7) - 1; }

  // La foto de la moto de la cita (por la placa), para el fondo de la tarjeta principal.
  fotoDeCita(p: any): string | null {
    const m = p?.placa ? this.motos.find(x => x.placa === p.placa) : null;
    return m?.foto ? `url(${m.foto})` : null;
  }

  // Fechas "AAAA-MM-DD" armadas desde el texto: el pipe date las leería como
  // medianoche UTC, que en Costa Rica cae el día anterior.
  private fecha(f?: string): Date | null {
    const [a, m, d] = String(f || '').slice(0, 10).split('-').map(Number);
    return a && m && d ? new Date(a, m - 1, d) : null;
  }
  diaDelMes(f?: string): number | string { return this.fecha(f)?.getDate() ?? ''; }
  mesCorto(f?: string): string { return this.fecha(f)?.toLocaleDateString('es-CR', { month: 'short' }).replace('.', '') ?? ''; }
  diaSemana(f?: string): string { return this.fecha(f)?.toLocaleDateString('es-CR', { weekday: 'long' }) ?? ''; }
  diaMes(f?: string): string { const x = this.fecha(f); return x ? x.toLocaleDateString('es-CR', { day: 'numeric', month: 'long' }) : ''; }
  fechaLarga(f?: string): string { const x = this.fecha(f); return x ? x.toLocaleDateString('es-CR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : ''; }

  ngOnInit() {
    this.cargar();
    this.portal.getTextos().pipe(takeUntil(this.destroy$)).subscribe({
      next: r => this.bienvenida = r.data?.bienvenida?.texto ? r.data.bienvenida : null,
      error: () => {},
    });
  }
  ionViewWillEnter() { this.cargar(); }

  cargar() {
    this.cargando = true;
    this.portal.getResumen().pipe(takeUntil(this.destroy$)).subscribe({
      next: r => { this.resumen = r.data; this.cargando = false; },
      error: () => { this.cargando = false; },
    });
    this.cargarPresupuestos();
    this.portal.getMotos().pipe(takeUntil(this.destroy$)).subscribe({
      next: r => this.motos = r.data || [],
      error: () => { this.motos = []; },
    });
  }

  // Solo los presupuestos que esperan una decisión del cliente.
  cargarPresupuestos() {
    this.portal.getOrdenes().pipe(takeUntil(this.destroy$)).subscribe({
      next: r => {
        this.presupuestos = r.data.filter(
          (o: any) => o.estado === 'esperando_aprobacion' && o.aprobacion_cliente === 'pendiente'
        );
      },
      error: () => { this.presupuestos = []; },
    });
  }

  // Bloques de recompensa: 6 normales + 1 cortesía (la 7ª).
  get bloques(): boolean[] {
    const ciclo = this.resumen?.recompensas?.ciclo ?? 0;
    return Array.from({ length: this.resumen?.recompensas?.meta || 7 }, (_, i) => i < ciclo);
  }

  // Abre/cierra el desglose de un presupuesto (carga el detalle la primera vez).
  toggle(o: any) {
    if (this.expandido === o.id) { this.expandido = null; return; }
    this.expandido = o.id;
    if (!this.detalle[o.id]) {
      this.portal.getOrden(o.id).pipe(takeUntil(this.destroy$)).subscribe({ next: r => this.detalle[o.id] = r.data });
    }
  }

  // Si ya había aprobado antes, lo que se le pide ahora es un adicional.
  esAdicional(o: any): boolean { return o?.total_aprobado !== null && o?.total_aprobado !== undefined; }

  // Diferencia entre el total de hoy y lo que ya aprobó.
  montoAdicional(d: any): number {
    return Math.max(0, Number(d?.total || 0) - Number(d?.total_aprobado || 0));
  }

  async aprobar(o: any) {
    const d = this.detalle[o.id];
    const al = await this.alert.create({
      cssClass: 'portal-alert',
      header: this.esAdicional(o) ? 'Aprobar adicional' : 'Aprobar presupuesto',
      message: this.esAdicional(o) && d
        ? `¿Apruebas el adicional de ₡${Number(this.montoAdicional(d) || 0).toLocaleString('es-CR', { maximumFractionDigits: 0 })}? El nuevo total de la orden ${o.numero_orden} es ₡${Number(d.total || 0).toLocaleString('es-CR', { maximumFractionDigits: 0 })}.`
        : `¿Apruebas el presupuesto de la orden ${o.numero_orden}? El taller comenzará la reparación.`,
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        { text: 'Aprobar', cssClass: 'portal-alert-confirm', handler: () => this.enviarDecision(o, 'aprobar') },
      ],
    });
    await al.present();
  }

  async rechazar(o: any) {
    const al = await this.alert.create({
      cssClass: 'portal-alert',
      header: this.esAdicional(o) ? 'Rechazar adicional' : 'Rechazar presupuesto',
      message: this.esAdicional(o)
        ? `Lo que ya aprobaste sigue en pie: el taller hace solo eso. Cuéntanos por qué no quieres el adicional (opcional).`
        : `Cuéntanos por qué rechazas el presupuesto de la orden ${o.numero_orden} (opcional).`,
      inputs: [{ name: 'motivo', type: 'textarea', placeholder: 'Motivo (opcional)' }],
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        { text: 'Rechazar', role: 'destructive', cssClass: 'portal-alert-danger', handler: (d) => this.enviarDecision(o, 'rechazar', d?.motivo) },
      ],
    });
    await al.present();
  }

  private enviarDecision(o: any, decision: 'aprobar' | 'rechazar', motivo?: string) {
    if (this.procesando) return;
    this.procesando = true;
    const req = decision === 'aprobar' ? this.portal.aprobar(o.id) : this.portal.rechazar(o.id, motivo || '');
    req.pipe(takeUntil(this.destroy$)).subscribe({
      next: async () => {
        this.procesando = false;
        this.expandido = null;
        const t = await this.toast.create({
          message: decision === 'aprobar' ? 'Presupuesto aprobado ✓' : 'Presupuesto rechazado',
          duration: 1800,
          color: decision === 'aprobar' ? 'success' : 'medium',
        });
        await t.present();
        this.cargarPresupuestos();
      },
      error: async () => {
        this.procesando = false;
        const t = await this.toast.create({ message: 'No se pudo procesar, intenta de nuevo', duration: 2200, color: 'danger' });
        await t.present();
      },
    });
  }

  ngOnDestroy() { this.destroy$.next(); this.destroy$.complete(); }

  irAgendar() { this.router.navigate(['/portal/agendar']); }
  irCitas() { this.router.navigate(['/portal/mis-citas']); }
  verCita(p: any) {
    if (!p?.id) return;
    window.location.href = `/portal/cita/${p.id}`;
  }

  // Título de la tarjeta destacada según el tipo de cita resuelto en el backend.
  tituloCita(tipo?: string): string {
    if (tipo === 'en_curso') return 'En el taller';
    if (tipo === 'vencida') return 'Cita vencida';
    return 'Próxima cita';
  }
  // Etiqueta de la fila de fecha: "Ingreso" si ya está en el taller, etc.
  labelFecha(tipo?: string): string {
    if (tipo === 'en_curso') return 'Ingreso';
    if (tipo === 'vencida') return 'Fecha agendada';
    return 'Fecha y hora';
  }
  // Badge "Hoy/Mañana/En N días" solo para la próxima cita agendada.
  badgeCita(p: any): BadgeProximidad | null {
    return p?.tipo === 'proxima' ? badgeProximidad(p.fecha) : null;
  }

  logout() {
    this.portal.logout();
    this.router.navigate(['/portal/login'], { replaceUrl: true });
  }
}
