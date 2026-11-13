import { Component, OnInit, OnDestroy } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { AlertController, LoadingController, ToastController } from '@ionic/angular';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { CitasService } from '../../services/citas.service';
import { ClientesService } from '../../services/clientes.service';
import { VehiculosService } from '../../services/vehiculos.service';
import { DashboardService } from '../../services/dashboard.service';
import { RecepcionService } from '../../services/recepcion.service';
import { AuthService } from '../../services/auth.service';
import { DURACIONES_CITA } from '../../shared/duraciones';
import { enPanel } from '../../shared/ruta-panel';
import { Cita } from '../../models/cita.model';
import { Cliente } from '../../models/cliente.model';
import { Moto } from '../../models/moto.model';
import { serviciosDeCita } from '../../shared/elegir-servicios.component';

@Component({ standalone: false,
  selector: 'app-cita-form',
  templateUrl: './cita-form.page.html',
  styleUrls: ['../../../theme/panel/base.scss', '../../../theme/panel/contenidos.scss', '../../../theme/panel/agenda.scss', '../../../theme/panel/capsulas.scss', '../../../theme/panel/estandar.scss', './cita-form.page.scss'],
})
export class CitaFormPage implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  esEdicion = false;
  citaId: number | null = null;

  form: Cita = {
    cliente_id: 0, fecha: '', hora: '', motivo: '', duracion_horas: 1,
  };
  readonly duraciones = DURACIONES_CITA;

  busquedaCliente = '';
  clientes: Cliente[] = [];
  motos: Moto[] = [];
  tecnicos: any[] = [];
  // Catálogo del servidor, el mismo que ve el cliente en el portal. Antes esta
  // pantalla tenía su propia lista con otros nombres, así que una cita creada acá
  // no coincidía con ninguna del portal y quedaba fuera de la sugerencia de
  // mantenimiento (que busca por nombre exacto).
  tiposServicio: string[] = [];
  // Los servicios marcados (casillas). Se mandan como lista al guardar.
  listaServicios: string[] = [];

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private citaSvc: CitasService,
    private clienteSvc: ClientesService,
    private motoSvc: VehiculosService,
    private dashSvc: DashboardService,
    private recepcionSvc: RecepcionService,
    public auth: AuthService,
    private loading: LoadingController,
    private toast: ToastController,
    private alert: AlertController,
  ) {}

  // Desde el panel se vuelve a Gestión de citas, en la pestaña Citas.
  // Solo administración abre este formulario: vuelve siempre a Gestión de citas (antes, fuera
  // del panel, iba a /tabs/citas, la pantalla vieja).
  get volverA(): string { return '/admin/citas?ver=citas'; }
  private volver() { this.router.navigateByUrl(this.volverA, { replaceUrl: true }); }

  ngOnInit() {
    this.recepcionSvc.getServicios().pipe(takeUntil(this.destroy$)).subscribe({
      next: r => this.tiposServicio = r.data || [],
    });
    // Lista de técnicos para asignar (solo admin puede).
    if (this.auth.tieneRol('admin')) {
      this.dashSvc.getTecnicos().pipe(takeUntil(this.destroy$)).subscribe({ next: res => this.tecnicos = res.data });
    }
    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.esEdicion = true;
      this.citaId = +id;
      this.citaSvc.getById(+id).pipe(takeUntil(this.destroy$)).subscribe(res => {
        // La base manda la fecha completa (2026-10-21T00:00:00Z) y la hora con segundos:
        // los campos de fecha y hora solo entienden 'AAAA-MM-DD' y 'HH:MM'. Sin esto la
        // fecha aparecía vacía y al guardar se mandaba sin fecha.
        this.form = { ...res.data, fecha: String(res.data.fecha || '').slice(0, 10), hora: String(res.data.hora || '').slice(0, 5), vehiculo_id: res.data.vehiculo_id ?? null };
        this.listaServicios = serviciosDeCita(res.data);
        this.busquedaCliente = `${res.data.cliente_nombre} ${res.data.cliente_apellido}`;
        if (res.data.cliente_id) {
          this.motoSvc.getAll({ cliente_id: res.data.cliente_id }).pipe(takeUntil(this.destroy$)).subscribe(r => this.motos = r.data);
        }
      });
    }
  }
  ngOnDestroy() { this.destroy$.next(); this.destroy$.complete(); }

  buscarClientes() {
    if (!this.busquedaCliente.trim()) { this.clientes = []; return; }
    this.clienteSvc.getAll(this.busquedaCliente).pipe(takeUntil(this.destroy$)).subscribe(res => this.clientes = res.data);
  }

  seleccionarCliente(c: Cliente) {
    this.form.cliente_id = c.id!;
    this.busquedaCliente = `${c.nombre} ${c.apellido}`;
    this.clientes = [];
    this.motoSvc.getAll({ cliente_id: c.id }).pipe(takeUntil(this.destroy$)).subscribe(res => this.motos = res.data);
  }

  async guardar() {
    const l = await this.loading.create({ message: 'Guardando...' });
    await l.present();
    // `servicios` como lista reemplaza al texto que vino del servidor.
    const datos = { ...this.form, servicios: this.listaServicios } as unknown as Cita;
    const op = this.esEdicion
      ? this.citaSvc.update(this.citaId!, datos)
      : this.citaSvc.create(datos);
    op.pipe(takeUntil(this.destroy$)).subscribe({
      next: async () => {
        await l.dismiss();
        const t = await this.toast.create({ message: 'Cita guardada', duration: 2000, color: 'success' });
        await t.present();
        this.volver();
      },
      error: async (e) => {
        await l.dismiss();
        const t = await this.toast.create({ message: e.error?.error || 'Error al guardar', duration: 3000, color: 'danger' });
        await t.present();
      },
    });
  }

  // Borrar (solo administración): para una cita agendada por error. Si el cliente ya
  // no viene, lo normal es cancelarla, que queda en el historial.
  get puedeEliminar(): boolean {
    return this.esEdicion && this.auth.tieneRol('admin') && !this.form.orden_id && this.form.estado !== 'entregado';
  }

  async eliminar() {
    const a = await this.alert.create({
      cssClass: 'alert-light',
      header: '¿Borrar esta cita?',
      message: 'Se borra del todo y no se puede deshacer. Si el cliente ya no viene, mejor cancelala: así queda en el historial.',
      buttons: [
        { text: 'Volver', role: 'cancel' },
        { text: 'Borrar', role: 'destructive', handler: () => { this.confirmarEliminar(); } },
      ],
    });
    await a.present();
  }

  private confirmarEliminar() {
    this.citaSvc.eliminar(this.citaId!).pipe(takeUntil(this.destroy$)).subscribe({
      next: async r => {
        const t = await this.toast.create({ message: r.message, duration: 2000, color: 'success' });
        await t.present();
        this.volver();
      },
      error: async e => {
        const t = await this.toast.create({ message: e.error?.error || 'No se pudo borrar', duration: 3500, color: 'danger' });
        await t.present();
      },
    });
  }
}
