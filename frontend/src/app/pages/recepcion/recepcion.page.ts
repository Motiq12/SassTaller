import { Component, OnDestroy, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { ToastController, ActionSheetController, AlertController } from '@ionic/angular';
import { Subject, interval } from 'rxjs';
import { debounceTime, distinctUntilChanged, takeUntil } from 'rxjs/operators';
import { RecepcionService, ResumenRecepcion } from '../../services/recepcion.service';
import { AuthService } from '../../services/auth.service';
import { abrirWhatsApp, mensajeCita } from '../../shared/utils/whatsapp.util';
import { alertaIcono, alertaColor, alertaTexto, haceTexto } from '../../shared/recepcion-alertas';
import { ahoraTaller } from '../../shared/utils/fecha-cita.util';

@Component({
  standalone: false,
  selector: 'app-recepcion',
  templateUrl: './recepcion.page.html',
  styleUrls: ['./recepcion.page.scss'],
})
export class RecepcionPage implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  resumen?: ResumenRecepcion;
  citas: any[] = [];
  alertas: any[] = [];
  listas: any[] = [];   // órdenes listas para entregar
  cargando = true;
  entregando: number | null = null;

  // Buscador rápido (cliente / placa).
  buscarTexto = '';
  resultados: any[] = [];
  buscando = false;
  private busqueda$ = new Subject<string>();

  // Etiquetas y colores de los estados de la cita.
  readonly estadoLabel: Record<string, string> = {
    agendado: 'Agendado',
    en_revision: 'En revisión',
    en_mantenimiento: 'En mantenimiento',
    listo: 'Listo',
    entregado: 'Entregado',
    cancelado: 'Cancelado',
  };
  readonly estadoPill: Record<string, string> = {
    agendado: 'indigo',
    en_revision: 'amber',
    en_mantenimiento: 'rose',
    listo: 'green',
    entregado: 'gris',
    cancelado: 'gris',
  };

  creandoOrden: number | null = null;
  marcando: number | null = null;

  // Filtro por sucursal sobre las citas de hoy (las opciones salen de las citas cargadas).
  sucursalFiltro: number | '' = '';
  // Modo "trabajar los sin confirmar": muestra solo las citas por venir sin confirmar.
  soloSinConfirmar = false;

  constructor(
    private rec: RecepcionService,
    private auth: AuthService,
    private router: Router,
    private toast: ToastController,
    private actionSheet: ActionSheetController,
    private alertCtrl: AlertController
  ) {}

  ngOnInit() {
    this.cargar();
    interval(30000).pipe(takeUntil(this.destroy$)).subscribe(() => this.refrescarSilencioso());
    // Buscador con debounce: ≥2 caracteres consulta clientes; vacío limpia resultados.
    this.busqueda$.pipe(debounceTime(300), distinctUntilChanged(), takeUntil(this.destroy$)).subscribe(q => {
      if (q.length < 2) { this.resultados = []; this.buscando = false; return; }
      this.rec.getClientes(q).pipe(takeUntil(this.destroy$)).subscribe({
        next: r => { this.resultados = r.data.slice(0, 6); this.buscando = false; },
        error: () => { this.resultados = []; this.buscando = false; },
      });
    });
  }
  ionViewWillEnter() { this.cargar(); }
  ngOnDestroy() { this.destroy$.next(); this.destroy$.complete(); this.busqueda$.complete(); }

  // —— Buscador rápido ——
  onBuscar(v: string) {
    this.buscarTexto = v;
    const q = (v || '').trim();
    this.buscando = q.length >= 2;
    this.busqueda$.next(q);
  }
  limpiarBusqueda() { this.buscarTexto = ''; this.resultados = []; this.buscando = false; this.busqueda$.next(''); }
  abrirResultado(c: any) { this.limpiarBusqueda(); this.router.navigate(['/cliente-detalle', c.id]); }

  // —— Priorización de citas de hoy ——
  private get ahoraCR(): string {
    return ahoraTaller().toISOString().slice(11, 16);
  }
  // Cita agendada cuya hora ya pasó y que aún no ingresó al taller (sin orden) y
  // sin registrar la llegada del cliente (si ya llegó, no es "atrasada", está esperando).
  esAtrasada(c: any): boolean {
    return c.estado === 'agendado' && !c.orden_id && !c.hora_llegada && (c.hora || '') < this.ahoraCR;
  }
  // Id de la próxima cita por atender hoy (primera agendada cuya hora no pasó).
  get proximaId(): number | null {
    const p = this.citas.find(c => c.estado === 'agendado' && (c.hora || '') >= this.ahoraCR);
    return p ? p.id : null;
  }
  // Sucursales presentes en las citas de hoy (para el filtro). Distintas, ordenadas.
  get sucursalesHoy(): { id: number; nombre: string }[] {
    const map = new Map<number, string>();
    for (const c of this.citas) {
      if (c.sucursal_id && c.sucursal_nombre && !map.has(c.sucursal_id)) map.set(c.sucursal_id, c.sucursal_nombre);
    }
    return [...map].map(([id, nombre]) => ({ id, nombre })).sort((a, b) => a.nombre.localeCompare(b.nombre));
  }
  // Citas de hoy aplicando el filtro de sucursal y, si está activo, el de sin confirmar.
  get citasVista(): any[] {
    let v = this.sucursalFiltro ? this.citas.filter(c => c.sucursal_id === this.sucursalFiltro) : this.citas;
    if (this.soloSinConfirmar) v = v.filter(c => c.estado === 'agendado' && !c.confirmada_cliente && !c.hora_llegada);
    return v;
  }
  setSucursalFiltro(v: number | '') { this.sucursalFiltro = v; }
  toggleSinConfirmar() { this.soloSinConfirmar = !this.soloSinConfirmar; }

  // —— Fila viva del mostrador ——
  // Agrupa las citas de hoy por su momento en el flujo. Mutuamente excluyentes y
  // exhaustivos sobre los estados (citas-hoy ya excluye 'cancelado').
  get grupos(): { key: string; label: string; icon: string; citas: any[] }[] {
    const v = this.citasVista;
    const grupos = [
      { key: 'esperando', label: 'Esperando atención', icon: 'hourglass-outline',
        citas: v.filter(c => c.estado === 'agendado' && c.hora_llegada) },
      { key: 'taller', label: 'En taller', icon: 'construct-outline',
        citas: v.filter(c => ['en_revision', 'en_mantenimiento', 'listo'].includes(c.estado)) },
      { key: 'porVenir', label: 'Por venir', icon: 'time-outline',
        citas: v.filter(c => c.estado === 'agendado' && !c.hora_llegada) },
      { key: 'entregadas', label: 'Entregadas hoy', icon: 'checkmark-done-outline',
        citas: v.filter(c => c.estado === 'entregado') },
    ];
    return grupos.filter(g => g.citas.length);
  }

  // Minutos que el cliente lleva esperando desde que se marcó su llegada.
  esperaMin(c: any): number {
    if (!c.hora_llegada) return 0;
    return Math.max(0, Math.round((Date.now() - new Date(c.hora_llegada).getTime()) / 60000));
  }
  esperaTexto(c: any): string {
    const m = this.esperaMin(c);
    if (m < 1) return 'Recién llegó';
    if (m < 60) return `Esperando ${m} min`;
    const h = Math.floor(m / 60), r = m % 60;
    return `Esperando ${h} h${r ? ` ${r} min` : ''}`;
  }
  // Espera larga (más de 20 min sin entrar al taller): la resaltamos en ámbar.
  esperaLarga(c: any): boolean { return this.esperaMin(c) >= 20; }

  // Marca / deshace la llegada del cliente (check-in de mostrador).
  marcarLlegada(c: any) {
    if (this.marcando) return;
    this.marcando = c.id;
    this.rec.marcarLlegada(c.id).pipe(takeUntil(this.destroy$)).subscribe({
      next: async (r) => {
        this.marcando = null;
        c.hora_llegada = r.data.hora_llegada;
        const t = await this.toast.create({ message: 'Llegada registrada', duration: 1400, color: 'success' });
        await t.present();
      },
      error: async (err) => {
        this.marcando = null;
        const t = await this.toast.create({ message: err.error?.error || 'No se pudo registrar la llegada', duration: 2400, color: 'danger' });
        await t.present();
      },
    });
  }
  deshacerLlegada(c: any) {
    this.rec.deshacerLlegada(c.id).pipe(takeUntil(this.destroy$)).subscribe({
      next: () => { c.hora_llegada = null; },
      error: async () => {
        const t = await this.toast.create({ message: 'No se pudo deshacer', duration: 1800, color: 'danger' });
        await t.present();
      },
    });
  }

  // —— WhatsApp ——
  // Abre WhatsApp con el mensaje según el estado de la cita (recordatorio / lista / seguimiento).
  async whatsappCita(c: any) {
    if (!abrirWhatsApp(c.cliente_telefono, mensajeCita(c))) {
      const t = await this.toast.create({ message: 'Este cliente no tiene teléfono cargado', duration: 2200, color: 'warning' });
      await t.present();
    }
  }
  // Avisar por WhatsApp que una orden está lista para retirar.
  async whatsappLista(o: any) {
    const vehiculo = [o.marca, o.modelo].filter(Boolean).join(' ') || 'tu vehiculo';
    const msg = `Hola ${o.cliente_nombre} 👋, tu ${vehiculo} ya está lista para retirar (orden ${o.numero_orden}). ¡Te esperamos! 🏍️`;
    if (!abrirWhatsApp(o.cliente_telefono, msg)) {
      const t = await this.toast.create({ message: 'Este cliente no tiene teléfono cargado', duration: 2200, color: 'warning' });
      await t.present();
    }
  }

  get totalConfirmadas(): number {
    return this.citas.filter(c => c.estado === 'agendado' && c.confirmada_cliente).length;
  }
  get totalSinConfirmar(): number {
    return this.citas.filter(c => c.estado === 'agendado' && !c.confirmada_cliente).length;
  }

  // —— Alertas accionables ——
  alertaClickable(a: any): boolean { return !!a.orden_id; }
  abrirAlerta(a: any) { if (a.orden_id) this.router.navigate(['/detalle-orden', a.orden_id]); }

  get nombre(): string { return this.auth.getUsuario()?.nombre || 'Recepción'; }
  get primerNombre(): string { return this.nombre.split(' ')[0]; }

  get fechaHoy(): string {
    return new Date().toLocaleDateString('es-CR', { weekday: 'long', day: 'numeric', month: 'long' });
  }

  cargar(ev?: any) {
    this.cargando = true;
    let pendientes = 4;
    const listo = () => { if (--pendientes <= 0) this.cargando = false; if (ev) ev.target.complete(); };
    this.rec.getResumen().pipe(takeUntil(this.destroy$)).subscribe({ next: r => { this.resumen = r.data; listo(); }, error: listo });
    this.rec.getCitasHoy().pipe(takeUntil(this.destroy$)).subscribe({ next: r => { this.citas = r.data; listo(); }, error: listo });
    this.rec.getAlertas().pipe(takeUntil(this.destroy$)).subscribe({ next: r => { this.alertas = r.data; listo(); }, error: listo });
    this.rec.getListasEntrega().pipe(takeUntil(this.destroy$)).subscribe({ next: r => { this.listas = r.data; listo(); }, error: listo });
  }

  private refrescarSilencioso() {
    this.rec.getCitasHoy().pipe(takeUntil(this.destroy$)).subscribe({ next: r => this.citas = r.data });
    this.rec.getResumen().pipe(takeUntil(this.destroy$)).subscribe({ next: r => this.resumen = r.data });
    this.rec.getAlertas().pipe(takeUntil(this.destroy$)).subscribe({ next: r => this.alertas = r.data });
    this.rec.getListasEntrega().pipe(takeUntil(this.destroy$)).subscribe({ next: r => this.listas = r.data });
  }

  // —— Entrega + cobro desde el mostrador ——
  totalOrden(o: any): number { return Number(o.total ?? (Number(o.costo_mano_obra || 0) + Number(o.costo_repuestos || 0) - Number(o.descuento || 0))); }

  // Paso 1: elegir método de pago (action sheet con el total a cobrar).
  async entregar(o: any) {
    if (this.entregando) return;
    const total = this.totalOrden(o);
    const metodos = [
      { text: 'Efectivo', val: 'efectivo', icon: 'cash-outline' },
      { text: 'Tarjeta', val: 'tarjeta', icon: 'card-outline' },
      { text: 'SINPE Móvil', val: 'sinpe', icon: 'phone-portrait-outline' },
      { text: 'Transferencia', val: 'transferencia', icon: 'swap-horizontal-outline' },
    ];
    const sheet = await this.actionSheet.create({
      header: `Cobrar ₡${total.toLocaleString('es-CR')} · ${o.numero_orden}`,
      subHeader: 'Método de pago',
      buttons: [
        ...metodos.map(m => ({ text: m.text, icon: m.icon, handler: () => { this.confirmarEntrega(o, m.val); } })),
        { text: 'Cancelar', icon: 'close', role: 'cancel' },
      ],
    });
    await sheet.present();
  }

  // Paso 2: confirmar el cierre y registrar la entrega.
  private async confirmarEntrega(o: any, metodo_pago: string) {
    this.entregando = o.id;
    this.rec.entregarOrden(o.id, { metodo_pago, garantia_dias: 30 }).pipe(takeUntil(this.destroy$)).subscribe({
      next: async (r) => {
        this.entregando = null;
        this.listas = this.listas.filter(x => x.id !== o.id);
        if (this.resumen && this.resumen.ordenes_activas > 0) this.resumen.ordenes_activas--;
        await this.ofrecerFactura(o, r.cortesia_ganada);
      },
      error: async (err) => {
        this.entregando = null;
        const t = await this.toast.create({ message: err.error?.error || 'No se pudo entregar la orden', duration: 2600, color: 'danger' });
        await t.present();
      },
    });
  }

  // Tras entregar: ofrece abrir la factura (y avisa la cortesía si la ganó).
  private async ofrecerFactura(o: any, cortesia: boolean) {
    const al = await this.alertCtrl.create({
      header: 'Orden entregada',
      message: cortesia ? '¡El cliente ganó una cortesía! ¿Abrir la factura?' : '¿Abrir la factura?',
      buttons: [
        { text: 'Ahora no', role: 'cancel' },
        { text: 'Ver factura', handler: () => this.router.navigate(['/factura', o.id]) },
      ],
    });
    await al.present();
  }

  // Ícono / color / texto de cada evento del taller (compartido con la campana del header).
  alertaIcono = alertaIcono;
  alertaColor = alertaColor;
  alertaTexto = alertaTexto;
  hace = haceTexto;

  // Crea la orden de trabajo de una cita y abre su pantalla.
  crearOrden(c: any) {
    if (this.creandoOrden) return;
    this.creandoOrden = c.id;
    this.rec.crearOrdenDesdeCita(c.id).pipe(takeUntil(this.destroy$)).subscribe({
      next: async (r) => {
        this.creandoOrden = null;
        c.orden_id = r.data.orden_id;
        c.numero_orden = r.data.numero_orden;
        if (c.estado === 'agendado') c.estado = 'en_revision';
        const t = await this.toast.create({ message: `Orden ${r.data.numero_orden} creada`, duration: 1600, color: 'success' });
        await t.present();
        this.router.navigate(['/detalle-orden', r.data.orden_id]);
      },
      error: async (err) => {
        this.creandoOrden = null;
        const t = await this.toast.create({ message: err.error?.error || 'No se pudo crear la orden', duration: 2400, color: 'danger' });
        await t.present();
      },
    });
  }

  verOrden(c: any) { this.router.navigate(['/detalle-orden', c.orden_id]); }

  logout() {
    this.auth.logout();
    this.router.navigate(['/portal/login'], { replaceUrl: true });
  }
}
