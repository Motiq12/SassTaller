import { Component, OnInit, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { ToastController } from '@ionic/angular';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { AuthService } from '../../services/auth.service';
import { MarcaService } from '../../services/marca.service';
import { DashboardService } from '../../services/dashboard.service';
import { OrdenesService } from '../../services/ordenes.service';
import { ESTADO_CONFIG, EstadoOrden } from '../../models/orden.model';
import { descargarCSV, fechaCorta } from '../../shared/csv.util';
import { hoyCR } from '../../utils/fecha-cita';

@Component({ standalone: false,
  selector: 'app-dashboard',
  templateUrl: './dashboard.page.html',
  styleUrls: ['./dashboard.page.scss'],
})
export class DashboardPage implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  resumen: any = null;
  tecnicos: any[] = [];
  atrasos: any[] = [];
  tiempos: any[] = [];
  cargando = true;

  // Fecha legible para el encabezado (estilo del export)
  fechaHoy = new Date().toLocaleDateString('es-CR', { weekday: 'short', day: 'numeric', month: 'short' });

  // Filtro de píldoras del semáforo
  filtroSemaforo: 'rojo' | 'amarillo' | 'verde' = 'rojo';
  get atrasosFiltrados(): any[] {
    return this.atrasos.filter(a => this.semaforo(a.dias_restantes) === this.filtroSemaforo);
  }

  // Etiquetas legibles para las etapas en la tabla de tiempos
  readonly etapaLabel: Record<string, string> = {
    recepcion: 'Recepción',
    diagnostico: 'Diagnóstico',
    esperando_aprobacion: 'Esperando aprobación',
    esperando_repuestos: 'Esperando repuestos',
    en_reparacion: 'En reparación',
    lista_entrega: 'Lista para entrega',
  };

  exportando = false;

  constructor(
    public auth: AuthService,
    // El encabezado muestra el nombre del taller, que antes estaba escrito fijo.
    public marca: MarcaService,
    private dashSvc: DashboardService,
    private ordenSvc: OrdenesService,
    private toast: ToastController,
    private router: Router
  ) {}

  ngOnInit() {
    this.cargar();
  }

  ionViewWillEnter() {
    this.cargar();
  }

  cargar() {
    this.cargando = true;
    this.dashSvc.getResumen().pipe(takeUntil(this.destroy$)).subscribe({
      next: res => {
        this.resumen = res.data;
        this.cargando = false;
      },
      error: () => { this.cargando = false; },
    });
    this.dashSvc.getTecnicos().pipe(takeUntil(this.destroy$)).subscribe({
      next: res => { this.tecnicos = res.data; },
    });
    this.dashSvc.getAtrasos().pipe(takeUntil(this.destroy$)).subscribe({
      next: res => { this.atrasos = res.data; },
    });
    this.dashSvc.getTiempos().pipe(takeUntil(this.destroy$)).subscribe({
      next: res => { this.tiempos = res.data; },
    });
  }

  // Semáforo de entrega: rojo = atrasada, amarillo = vence en ≤1 día, verde = a tiempo
  semaforo(dias: number | null): 'rojo' | 'amarillo' | 'verde' | 'gris' {
    if (dias === null || dias === undefined) return 'gris';
    if (dias < 0) return 'rojo';
    if (dias <= 1) return 'amarillo';
    return 'verde';
  }

  semaforoColor(dias: number | null): string {
    return { rojo: 'danger', amarillo: 'warning', verde: 'success', gris: 'medium' }[this.semaforo(dias)];
  }

  semaforoTexto(dias: number | null): string {
    if (dias === null || dias === undefined) return 'Sin fecha';
    if (dias < 0) return `Atrasada ${Math.abs(dias)}d`;
    if (dias === 0) return 'Vence hoy';
    if (dias === 1) return 'Vence mañana';
    return `${dias}d restantes`;
  }

  get countRojo(): number { return this.atrasos.filter(a => this.semaforo(a.dias_restantes) === 'rojo').length; }
  get countAmarillo(): number { return this.atrasos.filter(a => this.semaforo(a.dias_restantes) === 'amarillo').length; }
  get countVerde(): number { return this.atrasos.filter(a => this.semaforo(a.dias_restantes) === 'verde').length; }

  abrirOrden(id: number) {
    this.router.navigate(['/detalle-orden', id]);
  }

  // ===== Exportación de reportes a CSV (Excel) =====
  private hoy() { return hoyCR(); }

  private estadoTexto(e?: string) { return ESTADO_CONFIG[e as EstadoOrden]?.label ?? e ?? ''; }

  exportarOrdenes() {
    this.exportando = true;
    this.ordenSvc.getAll().pipe(takeUntil(this.destroy$)).subscribe({
      next: res => {
        const filas = res.data.map(o => ({
          numero_orden: o.numero_orden,
          estado: this.estadoTexto(o.estado),
          cliente: `${o.cliente_nombre || ''} ${o.cliente_apellido || ''}`.trim(),
          moto: `${o.marca || ''} ${o.modelo || ''}`.trim(),
          placa: o.placa || '',
          tecnico: o.tecnico_nombre || '',
          ingreso: fechaCorta(o.fecha_ingreso),
          entrega_estimada: fechaCorta(o.fecha_estimada_entrega),
          mano_obra: o.costo_mano_obra || 0,
          repuestos: o.costo_repuestos || 0,
          descuento: o.descuento || 0,
          total: Number(o.costo_mano_obra || 0) + Number(o.costo_repuestos || 0) - Number(o.descuento || 0),
        }));
        descargarCSV(`ordenes_${this.hoy()}`, [
          { key: 'numero_orden', label: 'Orden' },
          { key: 'estado', label: 'Estado' },
          { key: 'cliente', label: 'Cliente' },
          { key: 'moto', label: 'Moto' },
          { key: 'placa', label: 'Placa' },
          { key: 'tecnico', label: 'Técnico' },
          { key: 'ingreso', label: 'Ingreso' },
          { key: 'entrega_estimada', label: 'Entrega estimada' },
          { key: 'mano_obra', label: 'Mano de obra' },
          { key: 'repuestos', label: 'Repuestos' },
          { key: 'descuento', label: 'Descuento' },
          { key: 'total', label: 'Total' },
        ], filas);
        this.exportando = false;
        this.mostrarToast(`${filas.length} órdenes exportadas`);
      },
      error: () => { this.exportando = false; this.mostrarToast('No se pudo exportar', 'danger'); },
    });
  }

  exportarFacturacion() {
    this.exportando = true;
    this.ordenSvc.getAll({ estado: 'entregada' }).pipe(takeUntil(this.destroy$)).subscribe({
      next: res => {
        const filas = res.data.map(o => ({
          numero_orden: o.numero_orden,
          cliente: `${o.cliente_nombre || ''} ${o.cliente_apellido || ''}`.trim(),
          moto: `${o.marca || ''} ${o.modelo || ''}`.trim(),
          entrega: fechaCorta(o.fecha_entrega_real),
          metodo_pago: o.metodo_pago || '',
          mano_obra: o.costo_mano_obra || 0,
          repuestos: o.costo_repuestos || 0,
          descuento: o.descuento || 0,
          total: Number(o.costo_mano_obra || 0) + Number(o.costo_repuestos || 0) - Number(o.descuento || 0),
        }));
        descargarCSV(`facturacion_${this.hoy()}`, [
          { key: 'numero_orden', label: 'Orden' },
          { key: 'cliente', label: 'Cliente' },
          { key: 'moto', label: 'Moto' },
          { key: 'entrega', label: 'Entrega' },
          { key: 'metodo_pago', label: 'Método de pago' },
          { key: 'mano_obra', label: 'Mano de obra' },
          { key: 'repuestos', label: 'Repuestos' },
          { key: 'descuento', label: 'Descuento' },
          { key: 'total', label: 'Total' },
        ], filas);
        this.exportando = false;
        this.mostrarToast(`${filas.length} facturas exportadas`);
      },
      error: () => { this.exportando = false; this.mostrarToast('No se pudo exportar', 'danger'); },
    });
  }

  exportarProductividad() {
    if (!this.tecnicos.length) { this.mostrarToast('Sin datos de técnicos', 'warning'); return; }
    descargarCSV(`productividad_${this.hoy()}`, [
      { key: 'nombre', label: 'Técnico' },
      { key: 'ordenes_completadas', label: 'Órdenes completadas' },
      { key: 'horas_promedio', label: 'Horas promedio' },
    ], this.tecnicos.map(t => ({
      nombre: t.nombre,
      ordenes_completadas: t.ordenes_completadas || 0,
      horas_promedio: t.horas_promedio || 0,
    })));
    this.mostrarToast('Productividad exportada');
  }

  private async mostrarToast(message: string, color = 'success') {
    const t = await this.toast.create({ message, duration: 2000, color });
    await t.present();
  }

  logout() {
    this.auth.logout();
    this.router.navigate(['/portal/login'], { replaceUrl: true });
  }

  ngOnDestroy() { this.destroy$.next(); this.destroy$.complete(); }

  irNuevaOrden() {
    this.router.navigate(['/nueva-orden']);
  }
}
