import { Component, OnInit, OnDestroy } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ToastController } from '@ionic/angular';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { RecepcionService } from '../../services/recepcion.service';

// "Recibir cliente": flujo único de mostrador. Se busca el cliente una sola vez y
// se elige qué hacer con él:
//   • Ingresar ahora  → abre la orden de trabajo (el cliente ya está en el taller).
//   • Agendar cita    → reserva fecha + hora (el cliente llamó o vendrá luego).
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
  vehiculos: any[] = [];
  tecnicos: any[] = [];
  servicios: string[] = [];
  sucursales: any[] = [];
  disp: { horas: string[]; max: number; ocupacion: Record<string, number> } | null = null;
  guardando = false;

  form = {
    moto_id: null as number | null,
    // Agendar cita
    tipo_servicio: '',
    tecnico_id: null as number | null,
    fecha: new Date().toISOString().slice(0, 10),
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
    private toast: ToastController
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

  // Al volver de crear un cliente/vehiculo, refresca las vehiculos del cliente elegido.
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
    this.form.moto_id = null;
    this.cargarMotos(c.id);
  }

  private cargarMotos(clienteId: number) {
    this.rec.getMotos(clienteId).pipe(takeUntil(this.destroy$)).subscribe({
      next: r => { this.vehiculos = r.data; if (r.data.length === 1) this.form.moto_id = r.data[0].id; },
      error: () => { this.vehiculos = []; },
    });
  }

  limpiarCliente() {
    this.cliente = null; this.qCliente = ''; this.clientes = [];
    this.vehiculos = []; this.form.moto_id = null;
  }

  // Altas nuevas: reusan los formularios existentes.
  crearCliente() { this.router.navigate(['/cliente-form']); }
  registrarMoto() {
    if (this.cliente) this.router.navigate(['/vehiculo-form'], { queryParams: { cliente_id: this.cliente.id } });
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

  llena(h: string): boolean { return !!this.disp && (this.disp.ocupacion[h] || 0) >= this.disp.max; }
  restantes(h: string): number { return this.disp ? Math.max(0, this.disp.max - (this.disp.ocupacion[h] || 0)) : 0; }
  iniciales(c: any): string {
    return `${(c?.nombre || '?')[0] || ''}${(c?.apellido || '')[0] || ''}`.toUpperCase() || '?';
  }

  get valido(): boolean {
    if (!this.cliente) return false;
    const sucursalOk = this.sucursales.length <= 1 || !!this.form.sucursal_id;
    if (this.modo === 'agendar') {
      return !!this.form.fecha && !!this.form.hora && !!this.form.tipo_servicio && sucursalOk;
    }
    return !!this.form.moto_id && !!this.form.problema_reportado.trim() && sucursalOk;
  }

  confirmar() {
    if (!this.valido) {
      this.aviso(this.modo === 'agendar' ? 'Completá servicio, fecha y hora' : 'Elegí vehiculo y describí el problema', 'warning');
      return;
    }
    this.guardando = true;
    if (this.modo === 'agendar') this.confirmarCita();
    else this.confirmarOrden();
  }

  private confirmarCita() {
    this.rec.crearCita({
      cliente_id: this.cliente.id,
      moto_id: this.form.moto_id,
      fecha: this.form.fecha,
      hora: this.form.hora,
      motivo: this.form.motivo.trim() || this.form.tipo_servicio,
      tipo_servicio: this.form.tipo_servicio || null,
      tecnico_id: this.form.tecnico_id,
      sucursal_id: this.form.sucursal_id,
    }).pipe(takeUntil(this.destroy$)).subscribe({
      next: () => { this.guardando = false; this.aviso('Cita agendada'); this.reset(); },
      error: (e) => { this.guardando = false; this.aviso(e.error?.error || 'No se pudo agendar', 'danger'); },
    });
  }

  private confirmarOrden() {
    this.rec.crearOrden({
      cliente_id: this.cliente.id,
      moto_id: this.form.moto_id!,
      problema_reportado: this.form.problema_reportado.trim(),
      sucursal_id: this.form.sucursal_id,
      kilometraje_ingreso: this.form.kilometraje_ingreso || null,
      prioridad: this.form.prioridad || 'normal',
    }).pipe(takeUntil(this.destroy$)).subscribe({
      next: (r) => { this.guardando = false; this.aviso(`Orden ${r.data.numero_orden} creada`); this.router.navigate(['/detalle-orden', r.data.id]); },
      error: (e) => { this.guardando = false; this.aviso(e.error?.error || 'No se pudo crear la orden', 'danger'); },
    });
  }

  private reset() {
    const fecha = this.form.fecha;
    const sucursal_id = this.sucursales.length === 1 ? this.sucursales[0].id : null;
    this.limpiarCliente();
    this.form = {
      moto_id: null, tipo_servicio: '', tecnico_id: null, fecha, hora: '', motivo: '',
      problema_reportado: '', sucursal_id, kilometraje_ingreso: null, prioridad: 'normal',
    };
    this.cargarDisponibilidad();
  }

  ngOnDestroy() { this.destroy$.next(); this.destroy$.complete(); }

  private async aviso(message: string, color = 'success') {
    const t = await this.toast.create({ message, duration: 1800, color });
    await t.present();
  }
}
