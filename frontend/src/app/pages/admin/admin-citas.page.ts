import { Component, OnInit, OnDestroy } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ActionSheetController, AlertController, ToastController } from '@ionic/angular';
import { Subject } from 'rxjs';
import { debounceTime, takeUntil } from 'rxjs/operators';
import { AdminService } from '../../services/admin.service';
import { AuthService } from '../../services/auth.service';
import { OrdenesService } from '../../services/ordenes.service';
import { EntregaService } from '../../services/entrega.service';
import { CitasService } from '../../services/citas.service';
import { OrdenDesdeCitaService } from '../../services/orden-desde-cita.service';
import { DURACIONES_CITA, duracionCorta } from '../../shared/duraciones';
import { ESTADO_CITA_LABEL } from '../../utils/servicios';
import { ESTADO_CONFIG, EstadoOrden, OrdenEliminada } from '../../models/orden.model';
import { descargarCSV, fechaCorta } from '../../shared/csv.util';
import { hoyCR, sumarDias } from '../../utils/fecha-cita';

// Un día de la agenda en la vista Citas.
interface DiaDeCitas { fecha: string; titulo: string; sub: string; citas: any[]; anteriores: boolean; primeraAnterior: boolean; }

const DIAS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

@Component({
  standalone: false,
  selector: 'app-admin-citas',
  templateUrl: './admin-citas.page.html',
  styleUrls: ['./admin-citas.page.scss'],
})
export class AdminCitasPage implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  private buscar$ = new Subject<void>();
  vista: 'ordenes' | 'citas' = 'ordenes';
  // Se traen todas (con búsqueda, fecha y sede) y el estado se filtra acá: así cada
  // filtro muestra cuántas tiene.
  private citasTodas: any[] = [];
  private ordenesTodas: any[] = [];
  sucursales: any[] = [];
  cargando = true;
  estado = '';
  estadoOrden = '';
  q = '';
  fecha = '';
  sucursalId: number | '' = '';

  readonly estadoLabel = ESTADO_CITA_LABEL;
  readonly filtrosCitas = [
    { v: '', l: 'Todas' }, { v: 'agendado', l: 'Agendadas' }, { v: 'en_revision', l: 'En revisión' },
    { v: 'en_mantenimiento', l: 'En mantenimiento' }, { v: 'listo', l: 'Listas' },
    { v: 'entregado', l: 'Entregadas' }, { v: 'cancelado', l: 'Canceladas' },
    { v: 'sin_orden', l: 'Sin orden' },
  ];
  readonly filtrosOrdenes = [
    { v: '', l: 'Todas' }, { v: 'recepcion', l: 'Recepción' }, { v: 'diagnostico', l: 'Diagnóstico' },
    { v: 'esperando_aprobacion', l: 'Aprobación' }, { v: 'esperando_repuestos', l: 'Repuestos' },
    { v: 'en_reparacion', l: 'Reparación' }, { v: 'lista_entrega', l: 'Lista' },
    { v: 'entregada', l: 'Entregada' }, { v: 'cancelada', l: 'Cancelada' },
    { v: 'eliminadas', l: 'Eliminadas' },
  ];
  // Registro de órdenes eliminadas (filtro "Eliminadas"): quién, cuándo y por qué.
  eliminadas: OrdenEliminada[] = [];
  readonly estadoBadge: Record<string, string> = {
    agendado: 'bg-in', en_revision: 'bg-am', en_mantenimiento: 'bg-cr',
    listo: 'bg-em', entregado: 'bg-n', cancelado: 'bg-rd',
  };
  readonly ordenBadge: Record<string, string> = {
    recepcion: 'bg-cr', diagnostico: 'bg-am', esperando_aprobacion: 'bg-in',
    esperando_repuestos: 'bg-n', en_reparacion: 'bg-cr', lista_entrega: 'bg-em',
    entregada: 'bg-n', cancelada: 'bg-rd',
  };
  // Color de la raya de la tarjeta de una orden (la etapa de un vistazo).
  readonly ordenTono: Record<string, string> = {
    recepcion: 'cr', diagnostico: 'am', esperando_aprobacion: 'in', esperando_repuestos: 'n',
    en_reparacion: 'cr', lista_entrega: 'em', entregada: 'n', cancelada: 'rd',
  };

  ordenLabel(e: string): string { return ESTADO_CONFIG[e as EstadoOrden]?.label ?? e; }

  constructor(
    private admin: AdminService, private ordenSvc: OrdenesService, private router: Router, private alert: AlertController,
    private entrega: EntregaService, private citaSvc: CitasService, private sheet: ActionSheetController,
    private ordenCita: OrdenDesdeCitaService, private auth: AuthService, private route: ActivatedRoute,
    private toast: ToastController,
  ) {}

  // —— Orden de la cita ——
  // Una cita vigente sin orden se la puede abrir aquí, de cualquier fecha (recepción
  // lo hace desde Inicio, solo con las de hoy). Si no tiene moto, se la pide.
  puedeCrearOrden(c: any): boolean { return !c.orden_id && !['entregado', 'cancelado'].includes(c.estado); }
  creandoOrden: number | null = null;

  async crearOrden(c: any) {
    if (this.creandoOrden) return;
    this.creandoOrden = c.id;
    const o = await this.ordenCita.crear({ id: c.id, cliente_id: c.cliente_id, fecha: c.fecha, vehiculo_id: c.vehiculo_id, cliente_nombre: c.cliente_nombre });
    this.creandoOrden = null;
    if (o) this.router.navigate(['/admin/detalle-orden', o.orden_id]);
  }

  // —— Duración de la cita ——
  // Una cita ocupa un lugar en cada hora que dura: así una de todo el día no deja
  // ofrecer en el portal lugares que el taller no tiene.
  readonly duracionCorta = duracionCorta;
  puedeCambiarDuracion(c: any): boolean { return !['entregado', 'cancelado'].includes(c.estado); }

  async cambiarDuracion(c: any) {
    // Un servicio rápido de Ingresar ahora (20, 30 o 40 min) no marca ninguna: elegir
    // horas lo pasa a cita normal.
    const actual = c.duracion_min ? 0 : Number(c.duracion_horas) || 1;
    const s = await this.sheet.create({
      header: 'Cuánto dura la cita',
      subHeader: 'Ocupa un lugar en cada hora que dure',
      buttons: [
        ...DURACIONES_CITA.map(d => ({
          text: d.v === actual ? `${d.l} ✓` : d.l,
          handler: () => { if (d.v !== actual) this.guardarDuracion(c, d.v, false); },
        })),
        { text: 'Cancelar', role: 'cancel' },
      ],
    });
    await s.present();
  }

  // Si en alguna hora nueva ya no hay lugar (o está bloqueada), pregunta antes.
  private guardarDuracion(c: any, duracion: number, forzar: boolean) {
    this.citaSvc.setDuracion(c.id, duracion, forzar).pipe(takeUntil(this.destroy$)).subscribe({
      next: () => { c.duracion_horas = duracion; c.duracion_min = null; },
      error: async (e) => {
        const conflicto = e.status === 409 && e.error?.requiere_confirmacion;
        const a = await this.alert.create({
          cssClass: 'alert-light',
          header: conflicto ? 'No hay lugar en todas las horas' : 'No se pudo cambiar',
          message: conflicto ? `${e.error.error} ¿Guardar igual?` : (e.error?.error || 'Intentá de nuevo.'),
          buttons: conflicto
            ? [{ text: 'Cancelar', role: 'cancel' }, { text: 'Guardar igual', handler: () => this.guardarDuracion(c, duracion, true) }]
            : ['OK'],
        });
        await a.present();
      },
    });
  }

  // Entregar desde aquí, con el mismo diálogo que recepción. Una cita con orden se
  // entrega por la orden (garantía, fidelización y factura); una sin orden, directo.
  puedeEntregarCita(c: any): boolean { return !['entregado', 'cancelado', 'agendado'].includes(c.estado); }
  puedeEntregarOrden(o: any): boolean { return !['entregada', 'cancelada', 'recepcion'].includes(o.estado); }

  async entregarCita(c: any) {
    const ok = c.orden_id
      ? await this.entrega.entregarOrden({ id: c.orden_id, estado: c.estado === 'listo' ? 'lista_entrega' : null })
      : await this.entrega.entregarCita({ id: c.id, estado: c.estado, monto: c.monto });
    if (ok) this.cargar();
  }

  async entregarOrden(o: any, ev: Event) {
    ev.stopPropagation(); // la tarjeta entera abre la orden
    const ok = await this.entrega.entregarOrden({ id: o.id, numero_orden: o.numero_orden, total: o.total, estado: o.estado });
    if (ok) this.cargar();
  }

  // —— Editar, cancelar y borrar una cita ——
  puedeEditar(c: any): boolean { return !['entregado'].includes(c.estado); }
  puedeCancelar(c: any): boolean { return c.estado === 'agendado'; }
  // El servidor también lo revisa: con orden o entregada, no se borra.
  puedeBorrar(c: any): boolean { return !c.orden_id && c.estado !== 'entregado'; }

  editarCita(c: any) { this.router.navigate(['/admin/cita-form', c.id]); }

  // Todo lo que se puede hacer con una cita, en un solo menú.
  async acciones(c: any, ev?: Event) {
    ev?.stopPropagation();
    const botones: any[] = [];
    if (c.orden_id) botones.push({ text: `Abrir la orden ${c.numero_orden || ''}`.trim(), icon: 'clipboard-outline', handler: () => this.abrir(c) });
    if (this.puedeEditar(c)) botones.push({ text: 'Editar cita', icon: 'create-outline', handler: () => this.editarCita(c) });
    if (this.puedeCrearOrden(c)) botones.push({ text: 'Crear orden', icon: 'add-circle-outline', handler: () => { this.crearOrden(c); } });
    if (this.puedeCambiarDuracion(c)) botones.push({ text: `Duración (${duracionCorta(c.duracion_horas, c.duracion_min)})`, icon: 'hourglass-outline', handler: () => { this.cambiarDuracion(c); } });
    if (this.puedeEntregarCita(c)) botones.push({ text: 'Entregar', icon: 'checkmark-done-outline', handler: () => { this.entregarCita(c); } });
    if (this.puedeCancelar(c)) botones.push({ text: 'Cancelar cita', icon: 'close-circle-outline', handler: () => { this.cancelarCita(c); } });
    if (this.puedeBorrar(c)) botones.push({ text: 'Borrar cita', icon: 'trash-outline', role: 'destructive', handler: () => { this.borrarCita(c); } });
    botones.push({ text: 'Cerrar', role: 'cancel' });
    const s = await this.sheet.create({
      header: `${c.cliente_nombre || ''} ${c.cliente_apellido || ''}`.trim() || `Cita #${c.id}`,
      subHeader: `${this.fechaLarga(c.fecha)} · ${c.hora?.slice(0, 5) || ''}`,
      buttons: botones,
    });
    await s.present();
  }

  async cancelarCita(c: any) {
    const a = await this.alert.create({
      cssClass: 'alert-light',
      header: '¿Cancelar esta cita?',
      message: `${c.cliente_nombre || 'El cliente'} · ${this.fechaLarga(c.fecha)} a las ${c.hora?.slice(0, 5)}. Queda en el historial como cancelada y se libera la hora.`,
      buttons: [
        { text: 'Volver', role: 'cancel' },
        { text: 'Cancelar cita', role: 'destructive', handler: () => {
          this.citaSvc.cambiarEstado(c.id, 'cancelado').pipe(takeUntil(this.destroy$)).subscribe({
            next: () => { this.aviso('Cita cancelada'); this.cargar(); },
            error: e => this.aviso(e.error?.error || 'No se pudo cancelar', 'danger'),
          });
        } },
      ],
    });
    await a.present();
  }

  async borrarCita(c: any) {
    const a = await this.alert.create({
      cssClass: 'alert-light',
      header: '¿Borrar esta cita?',
      message: `${c.cliente_nombre || 'El cliente'} · ${this.fechaLarga(c.fecha)} a las ${c.hora?.slice(0, 5)}. Se borra del todo y no se puede deshacer. Si el cliente ya no viene, mejor cancelala.`,
      buttons: [
        { text: 'Volver', role: 'cancel' },
        { text: 'Borrar', role: 'destructive', handler: () => {
          this.citaSvc.eliminar(c.id).pipe(takeUntil(this.destroy$)).subscribe({
            next: r => { this.aviso(r.message); this.citasTodas = this.citasTodas.filter(x => x.id !== c.id); },
            error: e => this.aviso(e.error?.error || 'No se pudo borrar', 'danger'),
          });
        } },
      ],
    });
    await a.present();
  }

  ngOnInit() {
    // Arranca en la sede que la persona eligió en Mi perfil (se puede cambiar acá).
    const sede = this.auth.getUsuario()?.preferencias?.sede_id;
    if (sede) this.sucursalId = sede;
    // La pestaña va en la dirección (?ver=citas): al volver de editar una cita se
    // cae en Citas, y el "atrás" respeta la pestaña.
    this.route.queryParamMap.pipe(takeUntil(this.destroy$)).subscribe(p => {
      const v = p.get('ver') === 'citas' ? 'citas' : 'ordenes';
      if (v !== this.vista || this.cargando) { this.vista = v; this.cargar(); }
    });
    this.buscar$.pipe(debounceTime(350), takeUntil(this.destroy$)).subscribe(() => this.cargar());
    this.cargarSucursales();
  }
  ionViewWillEnter() { if (!this.cargando) this.cargar(); }

  cargar(ev?: any) {
    this.cargando = true;
    const listo = () => { this.cargando = false; if (ev) ev.target.complete(); };
    if (this.vista === 'citas') {
      this.admin.getCitas({ q: this.q.trim(), fecha: this.fecha, sucursal_id: this.sucursalId || undefined }).pipe(takeUntil(this.destroy$)).subscribe({
        next: r => { this.citasTodas = r.data || []; listo(); },
        error: listo,
      });
    } else if (this.estadoOrden === 'eliminadas') {
      this.ordenSvc.getEliminadas().pipe(takeUntil(this.destroy$)).subscribe({
        next: r => { this.eliminadas = r.data || []; listo(); },
        error: listo,
      });
    } else {
      this.ordenSvc.getAll({} as any).pipe(takeUntil(this.destroy$)).subscribe({
        next: r => { this.ordenesTodas = r.data || []; listo(); },
        error: listo,
      });
    }
  }

  cargarSucursales() {
    this.admin.getSucursales().pipe(takeUntil(this.destroy$)).subscribe({ next: r => this.sucursales = r.data || [] });
  }

  setVista(v: 'ordenes' | 'citas') {
    this.router.navigate([], { relativeTo: this.route, queryParams: { ver: v === 'citas' ? 'citas' : null }, replaceUrl: true });
  }
  setFiltro(v: string) { this.estado = v; }
  setFiltroOrden(v: string) {
    const recargar = v === 'eliminadas' || this.estadoOrden === 'eliminadas';
    this.estadoOrden = v;
    if (recargar) this.cargar();
  }
  // Las órdenes se filtran acá al escribir; las citas buscan en toda la base.
  alEscribir() { if (this.vista === 'citas') this.buscar$.next(); }
  limpiarBusqueda() { this.q = ''; if (this.vista === 'citas') this.cargar(); }
  ngOnDestroy() { this.destroy$.next(); this.destroy$.complete(); }

  // —— Órdenes ——
  private coincideOrden(o: any): boolean {
    const lq = this.q.trim().toLowerCase();
    return !lq || `${o.cliente_nombre} ${o.cliente_apellido} ${o.placa} ${o.numero_orden} ${o.marca} ${o.modelo} ${o.cliente_telefono || ''}`.toLowerCase().includes(lq);
  }
  get ordenes(): any[] {
    return this.ordenesTodas.filter(o => (!this.estadoOrden || o.estado === this.estadoOrden) && this.coincideOrden(o));
  }
  get eliminadasFiltradas(): OrdenEliminada[] {
    const lq = this.q.trim().toLowerCase();
    return this.eliminadas.filter(o => !lq || `${o.numero_orden} ${o.cliente_nombre} ${o.moto} ${o.motivo}`.toLowerCase().includes(lq));
  }
  cuantasOrdenes(v: string): number | null {
    if (v === 'eliminadas') return null;
    return this.ordenesTodas.filter(o => (!v || o.estado === v) && this.coincideOrden(o)).length;
  }

  // —— Citas ——
  private pasaFiltro(c: any, v: string): boolean {
    if (!v) return true;
    if (v === 'sin_orden') return !c.orden_id && !['cancelado', 'entregado'].includes(c.estado);
    return c.estado === v;
  }
  get citas(): any[] { return this.citasTodas.filter(c => this.pasaFiltro(c, this.estado)); }
  cuantasCitas(v: string): number { return this.citasTodas.filter(c => this.pasaFiltro(c, v)).length; }

  // Por día: primero hoy y lo que viene (del más cercano al más lejano), después lo
  // anterior (del más reciente hacia atrás).
  get dias(): DiaDeCitas[] {
    const hoy = hoyCR();
    const porDia = new Map<string, any[]>();
    for (const c of this.citas) {
      const f = String(c.fecha || '').slice(0, 10);
      if (!porDia.has(f)) porDia.set(f, []);
      porDia.get(f)!.push(c);
    }
    const fechas = [...porDia.keys()];
    const proximas = fechas.filter(f => f >= hoy).sort();
    const anteriores = fechas.filter(f => f < hoy).sort().reverse();
    return [...proximas, ...anteriores].map(f => ({
      fecha: f,
      titulo: this.nombreDelDia(f),
      sub: this.fechaLarga(f),
      citas: porDia.get(f)!.sort((a, b) => String(a.hora).localeCompare(String(b.hora))),
      anteriores: f < hoy,
      // Donde empieza lo anterior se pone un separador.
      primeraAnterior: f === anteriores[0],
    }));
  }

  private nombreDelDia(f: string): string {
    const hoy = hoyCR();
    if (f === hoy) return 'Hoy';
    if (f === sumarDias(hoy, 1)) return 'Mañana';
    if (f === sumarDias(hoy, -1)) return 'Ayer';
    const d = new Date(`${f}T12:00:00Z`);
    const dia = DIAS[d.getUTCDay()];
    return dia.charAt(0).toUpperCase() + dia.slice(1);
  }

  fechaLarga(fecha: string): string {
    const f = String(fecha || '').slice(0, 10);
    if (!f) return '—';
    const d = new Date(`${f}T12:00:00Z`);
    const mismoAnio = f.slice(0, 4) === hoyCR().slice(0, 4);
    return `${DIAS[d.getUTCDay()]} ${d.getUTCDate()} ${MESES[d.getUTCMonth()]}${mismoAnio ? '' : ' ' + f.slice(0, 4)}`;
  }

  // Las listas se rearman en cada vuelta: sin esto Angular rehace todas las filas.
  porId(_: number, x: any) { return x.id; }
  porFecha(_: number, d: DiaDeCitas) { return d.fecha; }

  abrir(c: any) { if (c.orden_id) this.router.navigate(['/admin/detalle-orden', c.orden_id]); }
  abrirOrden(o: any) { this.router.navigate(['/admin/detalle-orden', o.id]); }

  exportar() {
    descargarCSV(`citas_${hoyCR()}`, [
      { key: 'id', label: '#' }, { key: 'moto', label: 'Moto' }, { key: 'placa', label: 'Placa' },
      { key: 'cliente', label: 'Cliente' }, { key: 'servicio', label: 'Servicio' },
      { key: 'fecha', label: 'Fecha' }, { key: 'hora', label: 'Hora' },
      { key: 'tecnico', label: 'Mecánico' }, { key: 'sucursal', label: 'Sucursal' }, { key: 'estado', label: 'Estado' },
      { key: 'orden', label: 'Orden' },
    ], this.citas.map(c => ({
      id: c.id, moto: `${c.marca || ''} ${c.modelo || ''}`.trim(), placa: c.placa || '',
      cliente: `${c.cliente_nombre || ''} ${c.cliente_apellido || ''}`.trim(),
      servicio: c.tipo_servicio || c.motivo || '', fecha: fechaCorta(c.fecha),
      hora: (c.hora || '').slice(0, 5), tecnico: c.tecnico_nombre || '',
      sucursal: c.sucursal_nombre || '', estado: this.estadoLabel[c.estado] || c.estado,
      orden: c.numero_orden || '',
    })));
  }

  private async aviso(message: string, color = 'success') {
    const t = await this.toast.create({ message, duration: 2200, color });
    await t.present();
  }
}
