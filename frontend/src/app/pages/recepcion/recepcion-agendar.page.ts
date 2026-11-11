import { Component, OnInit, OnDestroy } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ToastController } from '@ionic/angular';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { RecepcionService } from '../../services/recepcion.service';
import { ClientesService } from '../../services/clientes.service';
import { VehiculosService } from '../../services/vehiculos.service';
import { AuthService } from '../../services/auth.service';
import { DURACIONES_CITA, OPCIONES_TIEMPO } from '../../shared/duraciones';
import { enPanel, rutaPanel } from '../../shared/ruta-panel';
import { hoyCR } from '../../utils/fecha-cita';

// "Recibir cliente": flujo único de mostrador. Se busca el cliente una sola vez y
// se elige qué hacer con él:
//   • Ingresar ahora  → abre la orden de trabajo (el cliente ya está en el taller).
//   • Agendar cita    → reserva fecha + hora (el cliente llamó o vendrá luego).
// Si el cliente no está registrado, o no tiene moto, se registra en un cuadro sin
// salir de la pantalla y queda elegido solo: todo el trámite en un solo lugar.
// El panel de administración abre esta misma pantalla como "Nueva cita u orden"
// (/admin/recibir); ahí además se elige la duración de la cita.
@Component({
  standalone: false,
  selector: 'app-recepcion-agendar',
  templateUrl: './recepcion-agendar.page.html',
  styleUrls: ['./recepcion-agendar.page.scss'],
})
export class RecepcionAgendarPage implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  modo: 'ahora' | 'agendar' = 'ahora';

  qCliente = '';
  clientes: any[] = [];
  cliente: any = null;
  motos: any[] = [];
  tecnicos: any[] = [];
  servicios: string[] = [];
  sucursales: any[] = [];
  disp: { horas: string[]; max: number; ocupacion: Record<string, number>; bloqueadas?: Record<string, string>; pasadas?: string[] } | null = null;
  guardando = false;

  // Cuadros para registrar un cliente o una moto sin salir de aquí.
  modalCliente = false;
  modalMoto = false;
  guardandoAlta = false;
  nuevoCliente = { nombre: '', apellido: '', telefono: '', cedula: '', email: '' };
  nuevaMoto = { marca: '', modelo: '', placa: '', anio: null as number | null, color: '' };
  // Sugerencias al escribir (se puede poner cualquier otra): primero las marcas que
  // distribuye el taller.
  readonly marcasSugeridas = ['Freedom', 'Hero', 'KYMCO', 'Honda', 'Yamaha', 'Suzuki', 'Bajaj', 'TVS', 'Kawasaki', 'KTM'];
  readonly coloresSugeridos = ['Negro', 'Blanco', 'Rojo', 'Azul', 'Gris', 'Plata', 'Verde', 'Amarillo', 'Naranja'];
  readonly anioActual = new Date().getFullYear();

  // Administración: la duración de la cita, y puede agendar aunque la hora esté
  // llena o bloqueada (recepción no).
  readonly duraciones = DURACIONES_CITA;
  duracion = 1;
  // Ingresar ahora · tiempo estimado: 0 = normal (ocupa la hora); 20, 30 o 40 = servicio
  // rápido, que usa solo esos minutos de la hora y deja el resto para otro cliente.
  readonly opcionesTiempo = OPCIONES_TIEMPO;
  minutos = 0;
  get esAdmin(): boolean { return this.auth.tieneRol('admin'); }
  get enPanel(): boolean { return enPanel(this.router); }
  get titulo(): string { return this.enPanel ? 'Nueva cita u orden' : 'Recibir cliente'; }

  form = {
    vehiculo_id: null as number | null,
    // Agendar cita
    servicios: [] as string[],
    tecnico_id: null as number | null,
    fecha: hoyCR(),
    hora: '',
    motivo: '',
    // Ingresar ahora (orden)
    problema_reportado: '',
    sucursal_id: null as number | null,
    kilometraje_ingreso: null as number | null,
    prioridad: 'normal',
  };

  constructor(
    private rec: RecepcionService,
    private route: ActivatedRoute,
    private router: Router,
    private toast: ToastController,
    private clientesSvc: ClientesService,
    private motosSvc: VehiculosService,
    private auth: AuthService,
  ) {}

  ngOnInit() {
    // El dashboard abre este flujo en modo "ahora" (?modo=ahora) para walk-ins.
    const m = this.route.snapshot.queryParamMap.get('modo');
    if (m === 'ahora' || m === 'agendar') this.modo = m;
    // La agenda abre este flujo con un día ya elegido (?fecha=YYYY-MM-DD).
    const f = this.route.snapshot.queryParamMap.get('fecha');
    if (f && /^\d{4}-\d{2}-\d{2}$/.test(f)) this.form.fecha = f;

    this.rec.getServicios().pipe(takeUntil(this.destroy$)).subscribe({ next: r => this.servicios = r.data, error: () => {} });
    // Las sucursales definen qué mecánicos y qué cupos aplican: se cargan al resolverlas.
    this.rec.getSucursales().pipe(takeUntil(this.destroy$)).subscribe({
      next: r => {
        this.sucursales = r.data || [];
        if (this.sucursales.length === 1) this.form.sucursal_id = this.sucursales[0].id;
        this.cargarTecnicos();
        if (this.modo === 'agendar') this.cargarDisponibilidad();
      },
      error: () => { this.sucursales = []; this.cargarTecnicos(); },
    });
  }

  // Mecánicos de la sede elegida (+ los de "ambas"). Si el elegido ya no aplica, se limpia.
  cargarTecnicos() {
    this.rec.getTecnicos(this.form.sucursal_id).pipe(takeUntil(this.destroy$)).subscribe({
      next: r => {
        this.tecnicos = r.data || [];
        if (this.form.tecnico_id && !this.tecnicos.some(t => t.id === this.form.tecnico_id)) {
          this.form.tecnico_id = null;
        }
      },
      error: () => { this.tecnicos = []; },
    });
  }

  // Al volver de crear un cliente/moto, refresca las motos del cliente elegido.
  ionViewWillEnter() { if (this.cliente) this.cargarMotos(this.cliente.id); }

  setModo(m: 'ahora' | 'agendar') {
    if (this.modo === m) return;
    this.modo = m;
    if (m === 'agendar' && !this.disp) this.cargarDisponibilidad();
  }

  buscarClientes() {
    const q = this.qCliente.trim();
    if (!q || this.cliente) { this.clientes = []; return; }
    this.rec.getClientes(q).pipe(takeUntil(this.destroy$)).subscribe({ next: r => this.clientes = r.data, error: () => {} });
  }

  seleccionarCliente(c: any) {
    this.cliente = c;
    this.qCliente = `${c.nombre} ${c.apellido || ''}`.trim();
    this.clientes = [];
    this.form.vehiculo_id = null;
    this.cargarMotos(c.id);
  }

  private cargarMotos(clienteId: number) {
    this.rec.getMotos(clienteId).pipe(takeUntil(this.destroy$)).subscribe({
      next: r => { this.motos = r.data; if (r.data.length === 1) this.form.vehiculo_id = r.data[0].id; },
      error: () => { this.motos = []; },
    });
  }

  limpiarCliente() {
    this.cliente = null; this.qCliente = ''; this.clientes = [];
    this.motos = []; this.form.vehiculo_id = null;
  }

  // —— Registrar cliente / moto sin salir de la pantalla ——
  // Lo que se escribió en el buscador ya viene puesto: un número de 8 dígitos es el
  // teléfono, uno más largo la cédula; si no, nombre y apellido.
  crearCliente() {
    const q = this.qCliente.trim();
    const digitos = q.replace(/[\s-]/g, '');
    this.nuevoCliente = { nombre: '', apellido: '', telefono: '', cedula: '', email: '' };
    if (/^\d+$/.test(digitos)) {
      if (digitos.length === 8) this.nuevoCliente.telefono = digitos; else this.nuevoCliente.cedula = digitos;
    } else if (q) {
      const [nombre, ...resto] = q.split(/\s+/);
      this.nuevoCliente.nombre = nombre;
      this.nuevoCliente.apellido = resto.join(' ');
    }
    this.modalCliente = true;
  }

  // Lo obligatorio, para habilitar el botón (el servidor igual lo revisa).
  get clienteCompleto(): boolean {
    const c = this.nuevoCliente;
    return !!(c.nombre.trim() && c.apellido.trim() && c.telefono.trim() && c.cedula.trim());
  }
  get motoCompleta(): boolean { return !!(this.nuevaMoto.marca.trim() && this.nuevaMoto.modelo.trim()); }

  // Al abrir un cuadro, el cursor va al primer campo vacío (lo del buscador ya viene puesto).
  enfocarVacio(ev: Event) {
    const caja = ev.target as HTMLElement;
    // Ionic pone el foco en el cuadro al terminar de abrirlo: se espera un instante.
    setTimeout(() => {
      const campos = Array.from(caja.querySelectorAll<HTMLInputElement>('input'));
      (campos.find(i => !i.value) || campos[0])?.focus();
    }, 120);
  }

  guardarCliente() {
    if (!this.clienteCompleto || this.guardandoAlta) return;
    const c = this.nuevoCliente;
    this.guardandoAlta = true;
    this.clientesSvc.create({
      nombre: c.nombre.trim(), apellido: c.apellido.trim(), telefono: c.telefono.trim(),
      cedula: c.cedula.trim(), email: c.email.trim() || null,
    }).pipe(takeUntil(this.destroy$)).subscribe({
      next: r => {
        this.guardandoAlta = false;
        this.modalCliente = false;
        this.seleccionarCliente(r.data);
        this.aviso('Cliente registrado');
        // Un cliente nuevo no tiene moto: se sigue directo con ella.
        setTimeout(() => this.registrarMoto(), 350);
      },
      // El aviso y el campo con el problema los marca ErrorInterceptor.
      error: () => { this.guardandoAlta = false; },
    });
  }

  registrarMoto() {
    if (!this.cliente) return;
    this.nuevaMoto = { marca: '', modelo: '', placa: '', anio: null, color: '' };
    this.modalMoto = true;
  }

  guardarMoto() {
    if (!this.motoCompleta || this.guardandoAlta) return;
    const m = this.nuevaMoto;
    this.guardandoAlta = true;
    this.motosSvc.create({
      cliente_id: this.cliente.id, marca: m.marca.trim(), modelo: m.modelo.trim(),
      placa: m.placa.trim().toUpperCase() || null, anio: m.anio || null, color: m.color.trim() || null,
    }).pipe(takeUntil(this.destroy$)).subscribe({
      next: r => {
        this.guardandoAlta = false;
        this.modalMoto = false;
        this.motos = [...this.motos, r.data];
        this.form.vehiculo_id = r.data.id!;
        this.aviso('Vehículo registrado');
      },
      error: () => { this.guardandoAlta = false; },
    });
  }

  // Al cambiar de sucursal cambian los mecánicos disponibles y, en agendar, el cupo.
  onSucursal() {
    this.cargarTecnicos();
    if (this.modo === 'agendar') this.cargarDisponibilidad();
  }

  cargarDisponibilidad() {
    this.form.hora = '';
    if (!this.form.fecha) { this.disp = null; return; }
    // Con más de una sucursal, el cupo es por local: hay que elegirla primero.
    if (this.sucursales.length > 1 && !this.form.sucursal_id) { this.disp = null; return; }
    this.rec.getDisponibilidad(this.form.fecha, this.form.sucursal_id).pipe(takeUntil(this.destroy$)).subscribe({
      next: r => this.disp = r.data,
      error: () => this.disp = null,
    });
  }

  // No se agenda en un día que ya pasó: el calendario arranca hoy (hora de Costa Rica).
  get hoy(): string { return hoyCR(); }

  // Nadie puede elegir una hora que ya pasó (la manda el servidor en `pasadas`).
  // Recepción tampoco una llena o bloqueada; administración sí (se le muestra igual
  // cómo está, para que decida). El servidor revisa lo mismo al guardar.
  horaDeshabilitada(h: string): boolean { return this.pasada(h) || (!this.esAdmin && (this.llena(h) || this.bloqueada(h))); }
  pasada(h: string): boolean { return !!this.disp?.pasadas?.includes(h); }
  // Qué dice la primera opción del selector de hora.
  get textoSinHora(): string {
    if (this.sucursales.length > 1 && !this.form.sucursal_id) return 'Elegí la sucursal';
    if (!this.disp || !this.disp.horas.length) return 'Día cerrado';
    if (this.disp.horas.every((h: string) => this.pasada(h))) return this.form.fecha < this.hoy ? 'Ese día ya pasó' : 'Ya no quedan horas hoy';
    return 'Elegí una hora';
  }

  llena(h: string): boolean { return !!this.disp && (this.disp.ocupacion[h] || 0) >= this.disp.max; }
  // Horas que bloqueó administración (feriado, capacitación…): no se agenda ahí.
  bloqueada(h: string): boolean { return !!this.disp?.bloqueadas && this.disp.bloqueadas[h] !== undefined; }
  restantes(h: string): number { return this.disp ? Math.max(0, this.disp.max - (this.disp.ocupacion[h] || 0)) : 0; }
  iniciales(c: any): string {
    return `${(c?.nombre || '?')[0] || ''}${(c?.apellido || '')[0] || ''}`.toUpperCase() || '?';
  }

  get valido(): boolean {
    if (!this.cliente) return false;
    const sucursalOk = this.sucursales.length <= 1 || !!this.form.sucursal_id;
    if (this.modo === 'agendar') {
      return !!this.form.fecha && !!this.form.hora && this.form.servicios.length > 0 && sucursalOk;
    }
    return !!this.form.vehiculo_id && !!this.form.problema_reportado.trim() && sucursalOk;
  }

  confirmar() {
    if (!this.valido) {
      this.aviso(this.modo === 'agendar' ? 'Completá servicio, fecha y hora' : 'Elegí el vehículo y describí el problema', 'warning');
      return;
    }
    this.guardando = true;
    if (this.modo === 'agendar') this.confirmarCita();
    else this.confirmarOrden();
  }

  private confirmarCita() {
    this.rec.crearCita({
      cliente_id: this.cliente.id,
      vehiculo_id: this.form.vehiculo_id,
      fecha: this.form.fecha,
      hora: this.form.hora,
      motivo: this.form.motivo.trim() || this.form.servicios.join(' + '),
      servicios: this.form.servicios,
      tecnico_id: this.form.tecnico_id,
      sucursal_id: this.form.sucursal_id,
      ...(this.esAdmin ? { duracion_horas: this.duracion } : {}),
    }).pipe(takeUntil(this.destroy$)).subscribe({
      next: () => { this.guardando = false; this.aviso('Cita agendada'); this.reset(); },
      error: (e) => { this.guardando = false; this.aviso(e.error?.error || 'No se pudo agendar', 'danger'); },
    });
  }

  private confirmarOrden() {
    this.rec.crearOrden({
      cliente_id: this.cliente.id,
      vehiculo_id: this.form.vehiculo_id!,
      problema_reportado: this.form.problema_reportado.trim(),
      sucursal_id: this.form.sucursal_id,
      kilometraje_ingreso: this.form.kilometraje_ingreso || null,
      prioridad: this.form.prioridad || 'normal',
      duracion_min: this.minutos || null,
    }).pipe(takeUntil(this.destroy$)).subscribe({
      next: (r) => { this.guardando = false; this.aviso(`Orden ${r.data.numero_orden} creada`); this.router.navigate([rutaPanel(this.router, '/detalle-orden'), r.data.id]); },
      error: (e) => { this.guardando = false; this.aviso(e.error?.error || 'No se pudo crear la orden', 'danger'); },
    });
  }

  private reset() {
    const fecha = this.form.fecha;
    const sucursal_id = this.sucursales.length === 1 ? this.sucursales[0].id : null;
    this.limpiarCliente();
    this.form = {
      vehiculo_id: null, servicios: [] as string[], tecnico_id: null, fecha, hora: '', motivo: '',
      problema_reportado: '', sucursal_id, kilometraje_ingreso: null, prioridad: 'normal',
    };
    this.duracion = 1;
    this.minutos = 0;
    this.cargarDisponibilidad();
  }

  ngOnDestroy() { this.destroy$.next(); this.destroy$.complete(); }

  private async aviso(message: string, color = 'success') {
    const t = await this.toast.create({ message, duration: 1800, color });
    await t.present();
  }
}
