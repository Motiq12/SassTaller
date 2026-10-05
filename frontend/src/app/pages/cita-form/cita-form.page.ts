import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { LoadingController, ToastController } from '@ionic/angular';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { CitasService } from '../../services/citas.service';
import { ClientesService } from '../../services/clientes.service';
import { VehiculosService } from '../../services/vehiculos.service';
import { DashboardService } from '../../services/dashboard.service';
import { RecepcionService } from '../../services/recepcion.service';
import { AuthService } from '../../services/auth.service';
import { Cita } from '../../models/cita.model';
import { Cliente } from '../../models/cliente.model';
import { Vehiculo } from '../../models/vehiculo.model';

@Component({ standalone: false,
  selector: 'app-cita-form',
  templateUrl: './cita-form.page.html',
  styleUrls: ['./cita-form.page.scss'],
})
export class CitaFormPage implements OnInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private citaSvc = inject(CitasService);
  private clienteSvc = inject(ClientesService);
  private motoSvc = inject(VehiculosService);
  private dashSvc = inject(DashboardService);
  private recepcionSvc = inject(RecepcionService);
  auth = inject(AuthService);
  private loading = inject(LoadingController);
  private toast = inject(ToastController);

  private destroy$ = new Subject<void>();
  esEdicion = false;
  citaId: number | null = null;

  form: Cita = {
    cliente_id: 0, fecha: '', hora: '', motivo: '',
  };

  busquedaCliente = '';
  clientes: Cliente[] = [];
  vehiculos: Vehiculo[] = [];
  tecnicos: any[] = [];
  // Catálogo del servidor, el mismo que ve el cliente en el portal. Antes esta
  // pantalla tenía su propia lista con otros nombres, así que una cita creada acá
  // no coincidía con ninguna del portal y quedaba fuera de la sugerencia de
  // mantenimiento (que busca por nombre exacto).
  tiposServicio: string[] = [];

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
        this.form = res.data;
        this.busquedaCliente = `${res.data.cliente_nombre} ${res.data.cliente_apellido}`;
        if (res.data.cliente_id) {
          this.motoSvc.getAll({ cliente_id: res.data.cliente_id }).pipe(takeUntil(this.destroy$)).subscribe(r => this.vehiculos = r.data);
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
    this.motoSvc.getAll({ cliente_id: c.id }).pipe(takeUntil(this.destroy$)).subscribe(res => this.vehiculos = res.data);
  }

  async guardar() {
    const l = await this.loading.create({ message: 'Guardando...' });
    await l.present();
    const op = this.esEdicion
      ? this.citaSvc.update(this.citaId!, this.form)
      : this.citaSvc.create(this.form);
    op.pipe(takeUntil(this.destroy$)).subscribe({
      next: async () => {
        await l.dismiss();
        const t = await this.toast.create({ message: 'Cita guardada', duration: 2000, color: 'success' });
        await t.present();
        this.router.navigate(['/tabs/citas']);
      },
      error: async () => {
        await l.dismiss();
        const t = await this.toast.create({ message: 'Error al guardar', duration: 2000, color: 'danger' });
        await t.present();
      },
    });
  }
}
