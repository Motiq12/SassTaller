import { Component, OnDestroy, inject } from '@angular/core';
import { Router } from '@angular/router';
import { AlertController, LoadingController, ToastController } from '@ionic/angular';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { ClientesService } from '../../services/clientes.service';
import { VehiculosService } from '../../services/vehiculos.service';
import { OrdenesService } from '../../services/ordenes.service';
import { Cliente } from '../../models/cliente.model';
import { Vehiculo } from '../../models/vehiculo.model';

@Component({ standalone: false,
  selector: 'app-nueva-orden',
  templateUrl: './nueva-orden.page.html',
  styleUrls: ['./nueva-orden.page.scss'],
})
export class NuevaOrdenPage implements OnDestroy {
  private clienteSvc = inject(ClientesService);
  private motoSvc = inject(VehiculosService);
  private ordenSvc = inject(OrdenesService);
  private router = inject(Router);
  private loading = inject(LoadingController);
  private toast = inject(ToastController);
  private alert = inject(AlertController);

  private destroy$ = new Subject<void>();
  paso = 1; // 1=cliente, 2=vehiculo, 3=recepcion

  // Paso 1
  busquedaCliente = '';
  clientes: Cliente[] = [];
  clienteSeleccionado: Cliente | null = null;

  // Paso 2
  vehiculos: Vehiculo[] = [];
  motoSeleccionada: Vehiculo | null = null;

  // Paso 3
  form = {
    problema_reportado: '',
    kilometraje_ingreso: null as number | null,
    nivel_combustible: 'cuarto',
    accesorios_entregados: '',
    estado_fisico: '',
    prioridad: 'normal',
    categoria: 'diagnostico',
    fecha_estimada_entrega: '',
  };

  ngOnDestroy() { this.destroy$.next(); this.destroy$.complete(); }

  buscarClientes() {
    if (!this.busquedaCliente.trim()) { this.clientes = []; return; }
    this.clienteSvc.getAll(this.busquedaCliente).pipe(takeUntil(this.destroy$)).subscribe(res => this.clientes = res.data);
  }

  seleccionarCliente(c: Cliente) {
    this.clienteSeleccionado = c;
    this.clientes = [];
    this.busquedaCliente = `${c.nombre} ${c.apellido}`;
    this.motoSvc.getAll({ cliente_id: c.id }).pipe(takeUntil(this.destroy$)).subscribe(res => this.vehiculos = res.data);
    this.paso = 2;
  }

  seleccionarMoto(m: Vehiculo) {
    this.motoSeleccionada = m;
    this.paso = 3;
  }

  async guardar() {
    if (!this.form.problema_reportado.trim()) {
      const a = await this.alert.create({ header: 'Error', message: 'Ingrese el problema reportado', buttons: ['OK'] });
      return a.present();
    }
    const l = await this.loading.create({ message: 'Creando orden...' });
    await l.present();
    this.ordenSvc.create({
      moto_id: this.motoSeleccionada!.id!,
      cliente_id: this.clienteSeleccionado!.id!,
      ...this.form,
    }).pipe(takeUntil(this.destroy$)).subscribe({
      next: async (res) => {
        await l.dismiss();
        const t = await this.toast.create({ message: `Orden ${res.data.numero_orden} creada`, duration: 2500, color: 'success' });
        await t.present();
        this.router.navigate(['/detalle-orden', res.data.id], { replaceUrl: true });
      },
      error: async (err) => {
        await l.dismiss();
        const a = await this.alert.create({ header: 'Error', message: err.error?.error || 'Error al crear la orden', buttons: ['OK'] });
        await a.present();
      },
    });
  }

  volver() { this.router.navigate(['/tabs/ordenes']); }
  pasoAnterior() { if (this.paso > 1) this.paso--; }
}
