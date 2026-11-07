import { Component, OnInit, OnDestroy } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ActionSheetController, AlertController, ToastController } from '@ionic/angular';
import { OrdenesService } from '../../services/ordenes.service';
import { UsuariosService } from '../../services/usuarios.service';
import { RecepcionService } from '../../services/recepcion.service';
import { GarantiasService } from '../../services/garantias.service';
import { MarcaService } from '../../services/marca.service';
import { AuthService } from '../../services/auth.service';
import { MecanicoService } from '../../services/mecanico.service';
import { VehiculosService } from '../../services/vehiculos.service';
import { EntregaService } from '../../services/entrega.service';
import { Moto } from '../../models/moto.model';
import {
  Orden, OrdenAvance, OrdenRepuesto, OrdenChecklist, OrdenFoto, EstadoOrden, ESTADO_CONFIG,
  EstadoRepuesto, ESTADO_REPUESTO_CONFIG, AvisoCambio, CHECKLIST_ENTREGA, faltantesChecklist,
} from '../../models/orden.model';
import { Garantia, EstadoGarantia, ESTADO_GARANTIA_CONFIG } from '../../models/garantia.model';
import { Usuario } from '../../models/usuario.model';
import { comprimirImagen } from '../../shared/image.util';
import { PLANTILLAS_WA, mensajeSugerido, abrirWhatsApp, DatosMensaje, colones, motoDe } from '../../shared/whatsapp.util';
import { MensajesService } from '../../services/mensajes.service';
import { enPanel, rutaPanel } from '../../shared/ruta-panel';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';

// Un botón de cambio: pasar a otro estado, entregar, o cancelar.
interface AccionOrden {
  texto: string;
  hacia?: EstadoOrden;
  entregar?: boolean;
  peligro?: boolean;
}

// Un paso de la línea de avance de arriba.
//   hecho:   la orden pasó por ahí (abajo, cuánto duró)
//   actual:  está ahí ahora
//   omitido: la orden siguió de largo sin pasar por ahí (p. ej. no hubo que esperar
//            repuestos): antes se pintaba como hecho, y parecía que sí
//   futuro:  todavía no llega
interface PasoOrden {
  id: string;
  label: string;
  tipo: 'hecho' | 'actual' | 'omitido' | 'futuro';
  sub: string;
  alcanzado: boolean;
}

// Una entrada de los menús desplegables (Otro cambio / Más).
interface ItemMenu { texto: string; icono?: string; peligro?: boolean; accion: () => void; }

@Component({ standalone: false,
  selector: 'app-detalle-orden',
  templateUrl: './detalle-orden.page.html',
  styleUrls: ['./detalle-orden.page.scss'],
})
export class DetalleOrdenPage implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  orden: Orden | null = null;
  avances: OrdenAvance[] = [];
  repuestos: OrdenRepuesto[] = [];
  fotos: OrdenFoto[] = [];
  tecnicos: Usuario[] = [];
  cargando = true;
  // Mientras viaja un cambio de estado: los botones se apagan (evita el doble toque).
  cambiando = false;

  tipoFoto: OrdenFoto['tipo'] = 'ingreso';
  private tipoFotoElegido = false;
  subiendoFoto = false;

  readonly tiposFoto: { valor: OrdenFoto['tipo']; label: string }[] = [
    { valor: 'ingreso', label: 'Ingreso' },
    { valor: 'diagnostico', label: 'Diagnóstico' },
    { valor: 'avance', label: 'Avance' },
    { valor: 'entrega', label: 'Entrega' },
  ];

  nuevoAvance = '';
  nuevoRepuesto: OrdenRepuesto = { nombre: '', cantidad: 1, costo_unitario: 0, estado: 'pendiente' };
  // Repuesto que se está editando en línea (copia: se aplica al guardar).
  editandoRepuesto: OrdenRepuesto | null = null;
  readonly estadosRepuesto = (Object.keys(ESTADO_REPUESTO_CONFIG) as EstadoRepuesto[])
    .map(valor => ({ valor, label: ESTADO_REPUESTO_CONFIG[valor].label }));
  mostrarFormRepuesto = false;
  mostrarFormSolicitud = false;
  listaSolicitud: { nombre: string; cantidad: number }[] = [];
  enviandoSolicitud = false;

  tiempos: { etapa: string; inicio: string; fin: string | null }[] = [];
  verEtapas = false;

  // === Línea de avance ===
  readonly flujoOrden = ['recepcion', 'diagnostico', 'esperando_aprobacion', 'esperando_repuestos', 'en_reparacion', 'lista_entrega', 'entregada'];
  readonly flujoLabel: Record<string, string> = {
    recepcion: 'Recepción', diagnostico: 'Diagnóstico', esperando_aprobacion: 'Aprobación',
    esperando_repuestos: 'Repuestos', en_reparacion: 'Reparación', lista_entrega: 'Lista', entregada: 'Entregada'
  };
  pasos: PasoOrden[] = [];
  resumenPaso = '';
  resumenPasoSub = '';

  readonly estrellas = [1, 2, 3, 4, 5];

  readonly etapaLabel: Record<string, string> = {
    recepcion: 'Recepción', diagnostico: 'Diagnóstico', esperando_aprobacion: 'Esperando aprobación',
    esperando_repuestos: 'Esperando repuestos', en_reparacion: 'En reparación', lista_entrega: 'Lista para entrega',
  };

  // Etiqueta del estado (fondo + texto del panel) en el encabezado.
  private readonly claseEstado: Record<string, string> = {
    recepcion: 'bg-n', diagnostico: 'bg-am', esperando_aprobacion: 'bg-in', esperando_repuestos: 'bg-am',
    en_reparacion: 'bg-in', lista_entrega: 'bg-em', entregada: 'bg-n', cancelada: 'bg-rd',
  };
  private readonly claseRepuesto: Record<string, string> = {
    solicitado: 'bg-cr', pendiente: 'bg-n', pedido_especial: 'bg-am', disponible: 'bg-em',
  };

  // Checklist de entrega: ayuda a no olvidar nada, pero NO impide entregar (antes el
  // botón quedaba apagado hasta marcar las cuatro casillas y no decía por qué). Se
  // guarda solo, en cada casilla.
  readonly checklistItems = CHECKLIST_ENTREGA;
  checklist: OrdenChecklist = {
    prueba_realizada: false,
    lavado: false,
    calidad_revisada: false,
    facturacion_lista: false,
    cliente_notificado: false,
    observaciones: '',
  };
  estadoChecklist = '';

  // Nombres de las formas de pago (para mostrar la de una orden ya entregada).
  metodosPago: { valor: string; etiqueta: string }[] = [];

  garantias: Garantia[] = [];
  mostrarFormReclamo = false;
  nuevoReclamo = { descripcion_problema: '', cubre_repuestos: false, cubre_mano_obra: false };

  // "Editar datos de ingreso". Las opciones son las que acepta la base.
  editando = false;
  guardandoEdicion = false;
  edicion: Partial<Orden> = {};
  motosCliente: Moto[] = [];
  sucursales: { id: number; nombre: string }[] = [];
  readonly prioridades = [
    { v: 'normal', l: 'Normal' }, { v: 'urgente', l: 'Urgente' },
    { v: 'emergencia', l: 'Emergencia' }, { v: 'garantia', l: 'Garantía' },
  ];
  readonly combustibles = [
    { v: 'vacio', l: 'Vacío' }, { v: 'cuarto', l: '1/4' }, { v: 'mitad', l: '1/2' },
    { v: 'tres_cuartos', l: '3/4' }, { v: 'lleno', l: 'Lleno' },
  ];

  // Mensajes internos sobre esta orden (contexto de orden).
  mensajes: any[] = [];
  nuevoMensaje = '';
  enviandoMensaje = false;
  miId = this.auth.getUsuario()?.id ?? null;

  // Menú desplegable abierto (uno a la vez): sus entradas y dónde se tocó.
  menu: { abierto: boolean; evento: Event | null; lado: 'top' | 'bottom'; items: ItemMenu[] } = { abierto: false, evento: null, lado: 'bottom', items: [] };

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private ordenSvc: OrdenesService,
    private usuarioSvc: UsuariosService,
    private rec: RecepcionService,
    private garantiaSvc: GarantiasService,
    private marcaSvc: MarcaService,
    public auth: AuthService,
    private mecSvc: MecanicoService,
    private motoSvc: VehiculosService,
    private entrega: EntregaService,
    private alert: AlertController,
    private toast: ToastController,
    private actionSheet: ActionSheetController,
    private textosWa: MensajesService
  ) {}

  ngOnInit() {
    this.textosWa.precargar();
    this.marcaSvc.get().pipe(takeUntil(this.destroy$)).subscribe(m => this.metodosPago = m.metodos_pago);
    const id = this.route.snapshot.paramMap.get('id');
    if (id) this.cargar(+id);
  }

  get esTecnico(): boolean { return this.auth.tieneRol('tecnico'); }

  cargar(id: number) {
    this.ordenSvc.getById(id).pipe(takeUntil(this.destroy$)).subscribe(res => {
      this.orden = res.data;
      this.cargando = false;
      this.elegirTipoFoto();
      this.armarPasos();
      this.cargarTecnicos();
    });
    this.ordenSvc.getAvances(id).pipe(takeUntil(this.destroy$)).subscribe(res => this.avances = res.data);
    this.ordenSvc.getRepuestos(id).pipe(takeUntil(this.destroy$)).subscribe(res => this.repuestos = res.data);
    this.ordenSvc.getFotos(id).pipe(takeUntil(this.destroy$)).subscribe(res => this.fotos = res.data);
    // También el mecánico: con los tiempos se sabe qué pasos se saltaron.
    this.ordenSvc.getTiempos(id).pipe(takeUntil(this.destroy$)).subscribe(res => {
      this.tiempos = res.data || [];
      this.armarPasos();
    });
    this.garantiaSvc.getAll({ orden_id: id }).pipe(takeUntil(this.destroy$)).subscribe(res => this.garantias = res.data);
    this.cargarMensajes(id);
    this.ordenSvc.getChecklist(id).pipe(takeUntil(this.destroy$)).subscribe(res => {
      if (res.data) {
        this.checklist = {
          prueba_realizada: !!res.data.prueba_realizada,
          lavado: !!res.data.lavado,
          calidad_revisada: !!res.data.calidad_revisada,
          facturacion_lista: !!res.data.facturacion_lista,
          cliente_notificado: !!res.data.cliente_notificado,
          observaciones: res.data.observaciones || '',
        };
      }
    });
  }

  // Asignación de técnico: la hacen admin y recepción, cada uno por su endpoint
  // permitido (/api/usuarios es admin; recepción tiene /api/recepcion/tecnicos).
  // Recepción ve solo los mecánicos de la sede de la orden (+ "ambas"); admin, todos.
  private cargarTecnicos() {
    if (this.auth.tieneRol('admin')) {
      this.usuarioSvc.getAll().pipe(takeUntil(this.destroy$)).subscribe(res => {
        this.tecnicos = res.data.filter(u => u.rol === 'tecnico' && u.activo);
      });
    } else if (this.auth.tieneRol('recepcion')) {
      this.rec.getTecnicos(this.orden?.sucursal_id).pipe(takeUntil(this.destroy$)).subscribe(res => { this.tecnicos = res.data; });
    }
  }

  get puedeAsignar(): boolean { return this.abierta && this.auth.tieneRol('admin', 'recepcion') && this.auth.puede('ordenes.asignar') && this.tecnicos.length > 0; }

  asignarTecnico(tecnico_id: number) {
    // Cada rol usa el endpoint que tiene permitido (admin → /ordenes, recepción → /recepcion).
    const op = this.auth.tieneRol('admin')
      ? this.ordenSvc.asignarTecnico(this.orden!.id!, tecnico_id)
      : this.rec.asignarTecnico(this.orden!.id!, tecnico_id);
    op.pipe(takeUntil(this.destroy$)).subscribe({
      next: () => { this.cargar(this.orden!.id!); this.mostrarToast('Mecánico asignado'); },
      error: () => {}, // el ErrorInterceptor ya muestra el motivo
    });
  }

  // ── Mensajes de la orden (contexto de orden) ──
  cargarMensajes(id: number) {
    this.ordenSvc.getMensajes(id).pipe(takeUntil(this.destroy$)).subscribe({ next: r => this.mensajes = r.data || [], error: () => {} });
  }
  // Los avisos automáticos (tipo 'sistema') llevan de remitente a alguien del personal
  // porque la tabla lo exige, pero no los escribió esa persona.
  esMensajeMio(m: any): boolean { return m.tipo !== 'sistema' && m.remitente_id === this.miId; }
  async enviarMensaje() {
    const txt = this.nuevoMensaje.trim();
    if (!txt || !this.orden?.id || this.enviandoMensaje) return;
    this.enviandoMensaje = true;
    this.ordenSvc.enviarMensaje(this.orden.id, txt).pipe(takeUntil(this.destroy$)).subscribe({
      next: r => { if (r?.data) this.mensajes.push(r.data); this.nuevoMensaje = ''; this.enviandoMensaje = false; },
      error: () => { this.enviandoMensaje = false; }, // el ErrorInterceptor ya muestra el motivo
    });
  }

  estadoLabel(e: string) { return ESTADO_CONFIG[e as EstadoOrden]?.label ?? e; }
  claseDeEstado(e?: string) { return this.claseEstado[e || ''] || 'bg-n'; }
  get prioridadLabel(): string { return this.prioridades.find(p => p.v === this.orden?.prioridad)?.l || 'Normal'; }
  get combustibleLabel(): string { return this.combustibles.find(c => c.v === this.orden?.nivel_combustible)?.l || '—'; }
  get metodoPagoLabel(): string {
    const v = this.orden?.metodo_pago;
    return this.metodosPago.find(m => m.valor === v)?.etiqueta || v || '—';
  }
  // El cliente ya aprobó un monto alguna vez (null/undefined = nunca).
  get tieneAprobado(): boolean { return this.orden?.total_aprobado !== null && this.orden?.total_aprobado !== undefined; }
  get tieneKm(): boolean { return this.orden?.kilometraje_ingreso !== null && this.orden?.kilometraje_ingreso !== undefined; }
  get telefonoLlamar(): string { return 'tel:' + (this.orden?.cliente_telefono || '').replace(/[^\d+]/g, ''); }

  // ═══ Cambiar de estado ═══
  // Los estados posibles los manda el backend (utils/transiciones.js, ya filtrados por
  // rol). De ahí sale UN botón principal (el paso normal) y el resto va a "Otro cambio".
  get siguientes(): EstadoOrden[] {
    // Sin la casilla "Cambiar el estado" (Equipo → Roles) no se ofrece ningún cambio.
    if (!this.auth.puede('ordenes.estado')) return [];
    return this.orden?.siguientes || [];
  }

  get abierta(): boolean {
    return !!this.orden && !['entregada', 'cancelada'].includes(this.orden.estado!);
  }

  // Entrega quien atiende al cliente: recepción o administración, en cualquier momento
  // (si no estaba lista, el cuadro lo avisa y se entrega igual).
  get puedeEntregar(): boolean {
    return this.abierta && this.auth.tieneRol('recepcion', 'admin') && this.auth.puede('ordenes.entregar');
  }

  // El paso normal desde cada estado.
  private readonly SIGUIENTE: Partial<Record<EstadoOrden, EstadoOrden>> = {
    recepcion: 'diagnostico',
    diagnostico: 'esperando_aprobacion',
    esperando_repuestos: 'en_reparacion',
    en_reparacion: 'lista_entrega',
  };

  get accionPrincipal(): AccionOrden | null {
    const e = this.orden?.estado;
    if (!e || !this.abierta) return null;
    if (e === 'lista_entrega') {
      return this.puedeEntregar ? { texto: 'Entregar al cliente', entregar: true } : null;
    }
    // Aprobado el presupuesto, lo normal es reparar; si faltan repuestos, esperarlos.
    const hacia = e === 'esperando_aprobacion'
      ? (this.repuestosFaltantes ? 'esperando_repuestos' : 'en_reparacion')
      : this.SIGUIENTE[e];
    if (!hacia || !this.siguientes.includes(hacia)) return null;
    return { texto: this.textoCambio(e, hacia, true), hacia };
  }

  get otrosCambios(): AccionOrden[] {
    const e = this.orden?.estado;
    if (!e || !this.abierta) return [];
    const principal = this.accionPrincipal;
    const lista: AccionOrden[] = this.siguientes
      .filter(s => s !== 'cancelada' && s !== principal?.hacia)
      .map(s => ({ texto: this.textoCambio(e, s, false), hacia: s }));
    if (this.puedeEntregar && e !== 'lista_entrega') lista.push({ texto: 'Entregar ahora (todavía no está lista)', entregar: true });
    if (this.siguientes.includes('cancelada')) lista.push({ texto: 'Cancelar orden…', hacia: 'cancelada', peligro: true });
    return lista;
  }

  // Lo que dice cada botón: qué pasa, no solo el nombre del estado.
  private textoCambio(desde: EstadoOrden, hacia: EstadoOrden, principal: boolean): string {
    const aprobado = this.orden?.aprobacion_cliente === 'aprobado';
    switch (hacia) {
      case 'diagnostico': return 'Pasar a diagnóstico';
      case 'esperando_aprobacion': return 'Enviar presupuesto al cliente';
      case 'esperando_repuestos':
        if (desde === 'en_reparacion') return 'Volver a esperar repuestos';
        return desde === 'esperando_aprobacion' && aprobado ? 'Aprobado: esperar repuestos' : 'Esperar repuestos';
      case 'en_reparacion':
        if (desde === 'recepcion') return 'Servicio rápido: directo a reparación';
        if (desde === 'diagnostico') return 'Directo a reparación (sin presupuesto)';
        if (desde === 'lista_entrega') return 'Volver a reparación';
        if (desde === 'esperando_repuestos' && principal) return 'Llegaron: pasar a reparación';
        if (desde === 'esperando_aprobacion' && aprobado) return 'Aprobado: pasar a reparación';
        return 'Pasar a reparación';
      case 'lista_entrega': return 'Marcar lista para entrega';
      default: return this.estadoLabel(hacia);
    }
  }

  ejecutar(a: AccionOrden) {
    if (this.cambiando) return;
    if (a.entregar) { this.entregar(); return; }
    if (a.hacia === 'cancelada') { this.cancelarOrden(); return; }
    if (a.hacia === 'esperando_aprobacion') { this.confirmarEnvioPresupuesto(); return; }
    if (a.hacia) this.ejecutarCambioEstado(a.hacia);
  }

  // Sin "¿Seguro?" en cada cambio: el botón ya dice qué hace, y si hay algo que
  // conviene saber (repuestos sin llegar, sin aprobación, sin fotos) lo pregunta el
  // backend. Se confirma lo que no tiene vuelta: avisarle al cliente y cancelar.
  private async ejecutarCambioEstado(estado: EstadoOrden, confirmar = false, motivo?: string) {
    this.cambiando = true;
    this.ordenSvc.cambiarEstado(this.orden!.id!, estado, confirmar, motivo).pipe(takeUntil(this.destroy$)).subscribe({
      next: () => {
        this.cambiando = false;
        this.cargar(this.orden!.id!);
        this.mostrarToast(`Ahora: ${this.estadoLabel(estado)}`);
      },
      error: (err) => {
        this.cambiando = false;
        if (err.status === 409 && err.error?.codigo === 'requiere_confirmacion') {
          this.confirmarConAvisos(estado, err.error.avisos || [], motivo);
        }
        // Los demás errores los muestra el ErrorInterceptor.
      },
    });
  }

  // El backend avisa lo que conviene saber antes de avanzar (repuestos que no
  // llegaron, moto sin fotos de ingreso, presupuesto sin aprobar). No bloquea: si la
  // persona decide seguir, se reenvía con confirmar.
  private async confirmarConAvisos(estado: EstadoOrden, avisos: AvisoCambio[], motivo?: string) {
    // Texto plano (Ionic 8 no pinta HTML en los cuadros); los saltos de línea los
    // respeta la clase avisos-cambio-alert de global.scss.
    const cuerpo = avisos.map(a =>
      [`• ${a.mensaje}`, ...(a.detalle || []).map(d => `   – ${d}`)].join('\n')
    ).join('\n\n') + '\n\n¿Querés cambiar el estado igual?';
    const al = await this.alert.create({
      header: `Antes de pasar a "${this.estadoLabel(estado)}"`,
      cssClass: 'avisos-cambio-alert',
      message: cuerpo,
      buttons: [
        { text: 'Volver', role: 'cancel' },
        { text: 'Cambiar igual', handler: () => this.ejecutarCambioEstado(estado, true, motivo) },
      ],
    });
    await al.present();
  }

  // Pasar a "Esperando aprobación" le avisa al cliente: se confirma con el monto a la
  // vista (y se advierte si el presupuesto está en cero).
  private async confirmarEnvioPresupuesto() {
    const o = this.orden!;
    const nombre = o.cliente_nombre || 'el cliente';
    const partes = this.esTecnico
      ? [`Se le avisa a ${nombre} para que apruebe el presupuesto en el portal.`]
      : [`Se le avisa a ${nombre} para que apruebe ₡${this.totalOrden.toLocaleString('es-CR')} en el portal.`];
    if (!this.esTecnico && this.totalOrden <= 0) partes.push('Ojo: el presupuesto está en ₡0.');
    const a = await this.alert.create({
      header: 'Enviar presupuesto',
      message: partes.join(' '),
      buttons: [
        { text: 'Volver', role: 'cancel' },
        { text: 'Enviar', handler: () => this.ejecutarCambioEstado('esperando_aprobacion') },
      ],
    });
    await a.present();
  }

  // Cancelar (solo administración): pide el porqué; queda guardado y se ve en la orden.
  private async cancelarOrden() {
    const o = this.orden!;
    const a = await this.alert.create({
      header: `Cancelar ${o.numero_orden}`,
      message: 'La orden queda cerrada sin cobrar. ¿Por qué se cancela?',
      inputs: [{ name: 'motivo', type: 'textarea', placeholder: 'Ej.: el cliente no aprobó y se llevó la moto', attributes: { maxlength: 300 } }],
      buttons: [
        { text: 'Volver', role: 'cancel' },
        {
          text: 'Cancelar orden',
          role: 'destructive',
          handler: (d: { motivo?: string }) => {
            const motivo = (d?.motivo || '').trim();
            if (motivo.length < 5) {
              this.mostrarToast('Escribí por qué se cancela la orden', 'danger');
              return false; // la alerta se queda abierta
            }
            this.ejecutarCambioEstado('cancelada', false, motivo);
            return true;
          },
        },
      ],
    });
    await a.present();
  }

  // El mismo cuadro de entrega que en las listas (EntregaService): total, forma de
  // pago, garantía y lo que falte del checklist, en un solo paso.
  async entregar() {
    const o = this.orden!;
    const ok = await this.entrega.entregarOrden({ id: o.id!, numero_orden: o.numero_orden, total: this.totalOrden, estado: o.estado });
    if (ok) this.cargar(o.id!);
  }

  // ═══ Menús desplegables ═══
  // Desde la barra de abajo del celular el menú abre hacia arriba.
  abrirOtros(ev: Event, lado: 'top' | 'bottom' = 'bottom') {
    this.abrirMenu(ev, this.otrosCambios.map(a => ({ texto: a.texto, peligro: a.peligro, accion: () => this.ejecutar(a) })), lado);
  }

  abrirMas(ev: Event) {
    const items: ItemMenu[] = [];
    if (this.puedeEditar) items.push({ texto: 'Editar datos de ingreso', icono: 'create-outline', accion: () => this.abrirEdicion() });
    if (!this.esTecnico) items.push({ texto: 'Historial de la moto', icono: 'time-outline', accion: () => this.verHistorialMoto() });
    if (this.puedeEliminar) items.push({ texto: 'Eliminar orden…', icono: 'trash-outline', peligro: true, accion: () => this.eliminarOrden() });
    this.abrirMenu(ev, items);
  }

  private abrirMenu(ev: Event, items: ItemMenu[], lado: 'top' | 'bottom' = 'bottom') {
    this.menu = { abierto: true, evento: ev, lado, items };
  }

  elegirDelMenu(it: ItemMenu) {
    this.menu.abierto = false;
    it.accion();
  }

  // ═══ Línea de avance ═══
  // Una sola línea de punta a punta. Lo que dice cada paso sale del registro de
  // tiempos: así un paso que la orden se saltó se ve como "Omitido" y no como hecho.
  private armarPasos() {
    const o = this.orden;
    if (!o) { this.pasos = []; return; }
    const estado = o.estado!;
    const visitadas = new Set(this.tiempos.map(t => t.etapa));
    const sinRegistro = !this.tiempos.length;
    const cancelada = estado === 'cancelada';
    // Hasta dónde llegó: en una cancelada, la última etapa por la que pasó.
    const idx = cancelada
      ? Math.max(0, ...this.tiempos.map(t => this.flujoOrden.indexOf(t.etapa)))
      : this.flujoOrden.indexOf(estado);

    this.pasos = this.flujoOrden.map((id, j) => {
      let tipo: PasoOrden['tipo'];
      if (j < idx || (j === idx && (cancelada || estado === 'entregada'))) {
        tipo = id === 'entregada' || sinRegistro || visitadas.has(id) ? 'hecho' : 'omitido';
      } else if (j === idx) {
        tipo = 'actual';
      } else {
        tipo = 'futuro';
      }
      let sub = '';
      if (tipo === 'hecho') sub = id === 'entregada' ? this.fechaCorta(o.fecha_entrega_real) : this.duracionEtapa(id);
      else if (tipo === 'actual') sub = `En curso · ${this.duracionEtapa(id) || '< 1 min'}`;
      else if (tipo === 'omitido') sub = 'Omitido';
      return { id, label: this.flujoLabel[id], tipo, sub, alcanzado: j <= idx };
    });

    // En el celular, en vez de los nombres de los pasos, una línea que resume.
    const actual = this.pasos[idx];
    if (cancelada) {
      this.resumenPaso = `Cancelada en ${(this.etapaLabel[this.flujoOrden[idx]] || '').toLowerCase()}`;
      this.resumenPasoSub = '';
    } else if (estado === 'entregada') {
      this.resumenPaso = 'Entregada';
      this.resumenPasoSub = this.fechaCorta(o.fecha_entrega_real);
    } else {
      this.resumenPaso = `Paso ${idx + 1} de ${this.flujoOrden.length} · ${actual?.label || ''}`;
      this.resumenPasoSub = actual?.sub || '';
    }
  }

  // Cuánto estuvo en una etapa (sumando las veces que pasó por ella).
  private duracionEtapa(etapa: string): string {
    const min = this.tiempos
      .filter(t => t.etapa === etapa)
      .reduce((s, t) => s + this.minutos(t.inicio, t.fin), 0);
    return this.tiempos.some(t => t.etapa === etapa) ? this.formatoMinutos(min) : '';
  }

  private fechaCorta(f?: string | null): string {
    if (!f) return '';
    return new Date(f).toLocaleDateString('es-CR', { day: '2-digit', month: '2-digit', year: '2-digit' });
  }

  // ═══ Repuestos ═══
  agregarRepuesto() {
    if (!this.nuevoRepuesto.nombre.trim()) return;
    this.ordenSvc.addRepuesto(this.orden!.id!, this.nuevoRepuesto).pipe(takeUntil(this.destroy$)).subscribe({
      next: (res: any) => {
        this.nuevoRepuesto = { nombre: '', cantidad: 1, costo_unitario: 0, estado: 'pendiente' };
        this.mostrarFormRepuesto = false;
        this.cargar(this.orden!.id!);
        this.avisarCambioDeCosto(res, 'Repuesto agregado');
      },
      error: () => {}, // el ErrorInterceptor ya muestra el motivo
    });
  }

  agregarALista() {
    if (!this.nuevoRepuesto.nombre.trim()) return;
    this.listaSolicitud.push({ nombre: this.nuevoRepuesto.nombre.trim(), cantidad: this.nuevoRepuesto.cantidad || 1 });
    this.nuevoRepuesto = { nombre: '', cantidad: 1, costo_unitario: 0, estado: 'pendiente' };
  }

  quitarDeLista(i: number) { this.listaSolicitud.splice(i, 1); }

  // Toda la lista va en un solo pedido: o quedan todas o ninguna. Antes iba una por
  // una y, si fallaba alguna, la lista quedaba entera y reenviar duplicaba las que sí
  // habían entrado.
  enviarSolicitudes() {
    if (!this.listaSolicitud.length || this.enviandoSolicitud) return;
    this.enviandoSolicitud = true;
    this.mecSvc.solicitarRepuestos(this.orden!.id!, this.listaSolicitud)
      .pipe(takeUntil(this.destroy$)).subscribe({
        next: res => {
          this.repuestos.push(...(res.data || []));
          this.listaSolicitud = [];
          this.enviandoSolicitud = false;
          this.mostrarFormSolicitud = false;
          this.mostrarToast(res.message || 'Repuestos solicitados');
        },
        error: () => {
          this.enviandoSolicitud = false;
          // El ErrorInterceptor ya muestra el motivo; la lista queda para reintentar.
        },
      });
  }

  // Edición en línea (nombre, cantidad, precio y estado con una lista, no texto libre).
  // Antes era un cuadro con el estado escrito a mano que, además, venía con
  // "disponible" puesto: al cotizar se marcaba como llegado algo que no había llegado.
  editarRepuesto(r: OrdenRepuesto) {
    this.editandoRepuesto = { ...r };
  }

  cancelarEdicionRepuesto() { this.editandoRepuesto = null; }

  guardarEdicionRepuesto() {
    const e = this.editandoRepuesto;
    if (!e?.id || !e.nombre.trim()) return;
    this.actualizarRepuesto(e.id, {
      nombre: e.nombre.trim(),
      cantidad: Math.max(1, parseInt(String(e.cantidad), 10) || 1),
      costo_unitario: Math.max(0, Number(e.costo_unitario) || 0),
      estado: e.estado,
    }, 'Repuesto actualizado');
  }

  // Atajo para cuando el repuesto llega al taller.
  marcarDisponible(r: OrdenRepuesto) {
    this.actualizarRepuesto(r.id!, { nombre: r.nombre, cantidad: r.cantidad, costo_unitario: r.costo_unitario, estado: 'disponible' }, `${r.nombre}: disponible`);
  }

  private actualizarRepuesto(id: number, datos: OrdenRepuesto, mensaje: string) {
    this.ordenSvc.updateRepuesto(this.orden!.id!, id, datos).pipe(takeUntil(this.destroy$)).subscribe({
      next: (res: any) => {
        this.editandoRepuesto = null;
        this.cargar(this.orden!.id!);
        this.avisarCambioDeCosto(res, mensaje);
      },
      error: () => {}, // el ErrorInterceptor ya muestra el motivo
    });
  }

  // Si el costo nuevo subió la cuenta de una orden ya aprobada, el backend la regresó
  // a "Esperando aprobación" y le avisó al cliente: eso se dice con un cuadro, no con
  // un aviso que se va solo, porque cambia el estado de la orden.
  private async avisarCambioDeCosto(res: any, mensajeNormal: string) {
    if (!res?.reaprobacion) { this.mostrarToast(mensajeNormal); return; }
    const a = await this.alert.create({
      header: 'El cliente tiene que aprobar el adicional',
      message: res.message || 'La orden volvió a «Esperando aprobación».',
      buttons: ['Entendido'],
    });
    await a.present();
  }

  estadoRepuestoLabel(e?: string) { return ESTADO_REPUESTO_CONFIG[e as EstadoRepuesto]?.label ?? e ?? ''; }
  claseDeRepuesto(e?: string) { return this.claseRepuesto[e || ''] || 'bg-n'; }

  // Los repuestos se tocan mientras la orden está abierta: una entregada ya se cobró.
  get editaRepuestos(): boolean { return this.abierta && !this.esTecnico && this.auth.puede('ordenes.costos'); }
  get pideRepuestos(): boolean { return this.abierta && this.esTecnico && this.auth.puede('taller.repuestos'); }
  // Subir fotos de evidencia (casilla "Subir fotos de evidencia" de su rol).
  get subeFotos(): boolean { return this.auth.puede('taller.fotos'); }

  // Repuestos que todavía no están en el taller.
  get repuestosFaltantes(): number { return this.repuestos.filter(r => r.estado !== 'disponible').length; }

  // La moto ya salió de recepción y no tiene fotos de cómo llegó.
  get faltanFotosIngreso(): boolean {
    return !!this.orden && this.orden.estado !== 'recepcion' && this.orden.estado !== 'cancelada'
      && !this.fotos.some(f => f.tipo === 'ingreso');
  }

  async eliminarRepuesto(r: OrdenRepuesto) {
    const conf = await this.alert.create({
      header: 'Eliminar repuesto',
      message: `¿Eliminar "${r.nombre}"?`,
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Eliminar',
          role: 'destructive',
          handler: () => {
            this.ordenSvc.deleteRepuesto(this.orden!.id!, r.id!).pipe(takeUntil(this.destroy$)).subscribe({
              next: () => {
                this.repuestos = this.repuestos.filter(x => x.id !== r.id);
                this.cargar(this.orden!.id!);
              },
              error: () => {}, // el ErrorInterceptor ya muestra el motivo
            });
          },
        },
      ],
    });
    await conf.present();
  }

  // Los montos llegan de MySQL como texto ("15000.00"): sin Number() la suma pegaba
  // textos y el total salía mal (p. ej. ₡15 000 en vez de ₡67 500), también en el
  // "Total a cobrar" de la entrega y en el WhatsApp al cliente.
  get totalRepuestos() {
    return this.repuestos.reduce((s, r) => s + (Number(r.cantidad) || 0) * (Number(r.costo_unitario) || 0), 0);
  }

  get descuento(): number { return Number(this.orden?.descuento) || 0; }

  get totalOrden() {
    if (!this.orden) return 0;
    return (Number(this.orden.costo_mano_obra) || 0) + this.totalRepuestos - this.descuento;
  }

  // ═══ Checklist de entrega ═══
  get faltantesEntrega(): string[] { return faltantesChecklist(this.checklist); }

  marcarCheck(campo: keyof OrdenChecklist, valor: boolean) {
    (this.checklist as any)[campo] = valor;
    this.guardarChecklist();
  }

  guardarChecklist() {
    if (this.orden?.estado === 'entregada') return;
    this.estadoChecklist = 'Guardando…';
    this.ordenSvc.saveChecklist(this.orden!.id!, this.checklist).pipe(takeUntil(this.destroy$)).subscribe({
      next: () => this.estadoChecklist = 'Guardado',
      error: () => this.estadoChecklist = '', // el ErrorInterceptor ya muestra el motivo
    });
  }

  // ═══ Avances ═══
  agregarAvance() {
    if (!this.nuevoAvance.trim()) return;
    this.ordenSvc.addAvance(this.orden!.id!, this.nuevoAvance.trim()).pipe(takeUntil(this.destroy$)).subscribe({
      next: res => {
        this.avances.push(res.data);
        this.nuevoAvance = '';
        this.mostrarToast('Avance registrado');
      },
    });
  }

  // Lo último arriba.
  get avancesRecientes(): OrdenAvance[] { return [...this.avances].reverse(); }

  iniciales(nombre?: string | null): string {
    return (nombre || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]).join('').toUpperCase();
  }

  // ═══ Fotos de evidencia ═══
  // La pestaña de fotos arranca en la que toca según cómo va la orden.
  private elegirTipoFoto() {
    if (this.tipoFotoElegido) return;
    const e = this.orden?.estado;
    this.tipoFoto = e === 'diagnostico' || e === 'esperando_aprobacion' ? 'diagnostico'
      : e === 'esperando_repuestos' || e === 'en_reparacion' ? 'avance'
      : e === 'lista_entrega' || e === 'entregada' ? 'entrega'
      : 'ingreso';
  }

  elegirTipo(t: OrdenFoto['tipo']) { this.tipoFoto = t; this.tipoFotoElegido = true; }
  contarFotos(t: string): number { return this.fotos.filter(f => f.tipo === t).length; }
  get fotosDelTipo(): OrdenFoto[] { return this.fotos.filter(f => f.tipo === this.tipoFoto); }
  get tipoFotoLabel(): string { return this.tiposFoto.find(t => t.valor === this.tipoFoto)?.label || ''; }

  async onArchivoSeleccionado(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      this.mostrarAlertError('El archivo debe ser una imagen');
      input.value = '';
      return;
    }

    this.subiendoFoto = true;
    try {
      const dataUrl = await comprimirImagen(file);
      this.ordenSvc.addFoto(this.orden!.id!, { url: dataUrl, tipo: this.tipoFoto }).pipe(takeUntil(this.destroy$)).subscribe({
        next: res => {
          this.fotos.push(res.data);
          this.subiendoFoto = false;
          this.mostrarToast('Foto agregada');
        },
        error: () => { this.subiendoFoto = false; }, // el ErrorInterceptor ya muestra el motivo
      });
    } catch {
      this.subiendoFoto = false;
      this.mostrarAlertError('No se pudo procesar la imagen');
    }
    input.value = '';
  }

  async verFoto(foto: OrdenFoto) {
    const a = await this.alert.create({
      cssClass: 'foto-preview-alert',
      message: `<img src="${foto.url}" style="width:100%;border-radius:2px" />`,
      buttons: ['Cerrar'],
    });
    await a.present();
  }

  async eliminarFoto(foto: OrdenFoto) {
    const conf = await this.alert.create({
      header: 'Eliminar foto',
      message: '¿Eliminar esta evidencia?',
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Eliminar',
          role: 'destructive',
          handler: () => {
            this.ordenSvc.deleteFoto(this.orden!.id!, foto.id!).pipe(takeUntil(this.destroy$)).subscribe({
              next: () => {
                this.fotos = this.fotos.filter(f => f.id !== foto.id);
                this.mostrarToast('Foto eliminada');
              },
            });
          },
        },
      ],
    });
    await conf.present();
  }

  // ═══ Tiempos ═══
  formatFecha(f: string): string {
    if (!f) return '—';
    return new Date(f).toLocaleString('es-CR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit', hour12: true });
  }

  private minutos(inicio: string, fin: string | null): number {
    if (!inicio) return 0;
    const end = fin ? new Date(fin).getTime() : Date.now();
    return Math.max(0, Math.round((end - new Date(inicio).getTime()) / 60000));
  }

  private formatoMinutos(min: number): string {
    if (min < 1) return '< 1 min';
    if (min < 60) return `${min} min`;
    const h = Math.floor(min / 60);
    const m = min % 60;
    if (h < 24) return m ? `${h} h ${m} min` : `${h} h`;
    const d = Math.floor(h / 24);
    const rh = h % 24;
    return rh ? `${d} d ${rh} h` : `${d} d`;
  }

  duracion(inicio: string, fin: string | null): string {
    return inicio ? this.formatoMinutos(this.minutos(inicio, fin)) : '';
  }

  get duracionTotal(): string {
    if (!this.tiempos.length) return '—';
    const inicio = this.tiempos[0].inicio;
    const ultimo = this.tiempos[this.tiempos.length - 1];
    return this.duracion(inicio, ultimo.fin);
  }

  // ═══ Editar / eliminar la orden ═══
  // Editar: recepción y administración, mientras la orden esté abierta.
  get puedeEditar(): boolean {
    return this.auth.tieneRol('recepcion', 'admin') && this.auth.puede('ordenes.editar') && this.abierta;
  }
  // Eliminar: solo administración, y nunca una orden entregada (ya se cobró).
  get puedeEliminar(): boolean {
    return this.auth.tieneRol('admin') && !!this.orden && this.orden.estado !== 'entregada';
  }

  abrirEdicion() {
    const o = this.orden!;
    this.edicion = {
      moto_id: o.moto_id,
      sucursal_id: o.sucursal_id ?? null,
      problema_reportado: o.problema_reportado || '',
      prioridad: o.prioridad || 'normal',
      categoria: o.categoria,
      kilometraje_ingreso: o.kilometraje_ingreso ?? null,
      nivel_combustible: o.nivel_combustible || 'cuarto',
      fecha_estimada_entrega: o.fecha_estimada_entrega ? String(o.fecha_estimada_entrega).slice(0, 10) : null,
      accesorios_entregados: o.accesorios_entregados || '',
      estado_fisico: o.estado_fisico || '',
    };
    this.editando = true;
    this.motoSvc.getAll({ cliente_id: o.cliente_id }).pipe(takeUntil(this.destroy$))
      .subscribe(r => this.motosCliente = r.data || []);
    this.rec.getSucursales().pipe(takeUntil(this.destroy$))
      .subscribe(r => this.sucursales = r.data || []);
  }

  guardarEdicion() {
    const id = this.orden!.id!;
    this.guardandoEdicion = true;
    this.ordenSvc.editarDatos(id, this.edicion).pipe(takeUntil(this.destroy$)).subscribe({
      next: () => {
        this.guardandoEdicion = false;
        this.editando = false;
        this.mostrarToast('Orden actualizada');
        this.cargar(id);
      },
      error: () => { this.guardandoEdicion = false; }, // el ErrorInterceptor marca el campo
    });
  }

  // Pide el motivo antes de eliminar: queda guardado con quién y cuándo, y se ve
  // en Gestión de citas → Órdenes → Eliminadas.
  async eliminarOrden() {
    const o = this.orden!;
    const a = await this.alert.create({
      header: `Eliminar ${o.numero_orden}`,
      message: 'Se borra la orden con sus avances, repuestos y fotos, y el cliente deja de verla. No se puede deshacer. ¿Por qué se elimina?',
      inputs: [{ name: 'motivo', type: 'textarea', placeholder: 'Ej.: se creó por error, estaba repetida…', attributes: { maxlength: 500 } }],
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Eliminar',
          role: 'destructive',
          handler: (d: { motivo?: string }) => {
            const motivo = (d?.motivo || '').trim();
            if (motivo.length < 5) {
              this.mostrarToast('Escribí por qué se elimina la orden', 'danger');
              return false; // la alerta se queda abierta
            }
            this.confirmarEliminar(o.id!, motivo);
            return true;
          },
        },
      ],
    });
    await a.present();
  }

  private confirmarEliminar(id: number, motivo: string) {
    this.ordenSvc.eliminar(id, motivo).pipe(takeUntil(this.destroy$)).subscribe({
      next: (r) => {
        this.mostrarToast(r.message || 'Orden eliminada');
        this.router.navigateByUrl(this.listaOrdenes, { replaceUrl: true });
      },
      error: () => {}, // el ErrorInterceptor ya muestra el motivo
    });
  }

  private async mostrarToast(msg: string, color = 'success') {
    const t = await this.toast.create({ message: msg, duration: 2000, color });
    await t.present();
  }

  private async mostrarAlertError(msg?: string) {
    const a = await this.alert.create({ header: 'Error', message: msg || 'Ocurrió un error', buttons: ['OK'] });
    await a.present();
  }

  // ═══ Garantía ═══
  estadoGarantiaLabel(e: EstadoGarantia) { return ESTADO_GARANTIA_CONFIG[e]?.label ?? e; }
  claseGarantia(e?: EstadoGarantia): string {
    const color = e ? ESTADO_GARANTIA_CONFIG[e]?.color : '';
    return color === 'success' ? 'bg-em' : color === 'danger' ? 'bg-rd' : color === 'warning' ? 'bg-am' : color === 'primary' ? 'bg-cr' : 'bg-n';
  }

  // Días restantes de cobertura desde la fecha de entrega real
  get diasGarantiaRestantes(): number | null {
    if (!this.orden?.fecha_entrega_real || !this.orden?.garantia_dias) return null;
    const entrega = new Date(this.orden.fecha_entrega_real);
    const vence = new Date(entrega.getTime() + this.orden.garantia_dias * 86400000);
    return Math.ceil((vence.getTime() - Date.now()) / 86400000);
  }

  get garantiaVigente(): boolean {
    const d = this.diasGarantiaRestantes;
    return d !== null && d >= 0;
  }

  registrarReclamo() {
    if (!this.nuevoReclamo.descripcion_problema.trim()) return;
    this.garantiaSvc.create({ orden_id: this.orden!.id!, ...this.nuevoReclamo }).pipe(takeUntil(this.destroy$)).subscribe({
      next: res => {
        this.garantias.unshift(res.data);
        this.nuevoReclamo = { descripcion_problema: '', cubre_repuestos: false, cubre_mano_obra: false };
        this.mostrarFormReclamo = false;
        this.mostrarToast('Reclamo de garantía registrado');
      },
      error: () => {}, // el ErrorInterceptor ya muestra el motivo
    });
  }

  // ═══ Notificar al cliente por WhatsApp (click-to-send) ═══
  async notificarWhatsApp() {
    if (!this.orden?.cliente_telefono) {
      this.mostrarAlertError('El cliente no tiene teléfono registrado');
      return;
    }
    const datos: DatosMensaje = {
      nombre: this.orden.cliente_nombre || '',
      moto: motoDe(this.orden),
      orden: this.orden.numero_orden,
      total: colones(this.totalOrden),
      portal: `${location.origin}/portal/login`,
    };
    const sugerido = mensajeSugerido(this.orden.estado);

    // Los de la orden, menos el de las fotos del avance (ese sale de Órdenes, con su nota).
    const buttons = PLANTILLAS_WA.filter(m => m.grupo === 'orden' && m.clave !== 'orden_avance').map(m => ({
      text: m.clave === sugerido ? `${m.label}  ·  sugerido` : m.label,
      icon: 'logo-whatsapp',
      handler: () => abrirWhatsApp(this.orden!.cliente_telefono!, this.textosWa.armar(m.clave, datos)),
    }));
    buttons.push({ text: 'Cancelar', icon: 'close', role: 'cancel' } as any);

    const sheet = await this.actionSheet.create({ header: 'Notificar al cliente', buttons });
    await sheet.present();
  }

  irAGarantias() { this.router.navigate([enPanel(this.router) ? '/admin/garantias' : '/garantias']); }

  verFactura() { this.router.navigate([rutaPanel(this.router, '/factura'), this.orden!.id]); }
  verCliente() { this.router.navigate([rutaPanel(this.router, '/cliente-detalle'), this.orden!.cliente_id]); }
  verHistorialMoto() { this.router.navigate([rutaPanel(this.router, '/moto-historial'), this.orden!.moto_id]); }

  ngOnDestroy() { this.destroy$.next(); this.destroy$.complete(); }

  volver() { this.router.navigate([this.listaOrdenes]); }

  // A dónde vuelve si no hay historial (se abrió con un enlace directo).
  // A dónde vuelve la flecha si no hay historial: la lista de órdenes de cada rol (antes,
  // fuera del panel, iba a /tabs/ordenes, la pantalla vieja).
  get listaOrdenes(): string {
    if (enPanel(this.router)) return '/admin/citas';
    const rol = this.auth.getUsuario()?.rol;
    return rol === 'recepcion' ? '/recepcion/ordenes' : rol === 'tecnico' ? '/mecanico/inicio' : '/admin/citas';
  }
}
