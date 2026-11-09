import { Component, OnInit, OnDestroy } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Location } from '@angular/common';
import { LoadingController, ToastController } from '@ionic/angular';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { VehiculosService } from '../../services/vehiculos.service';
import { Moto } from '../../models/moto.model';
import { TipoVehiculo } from '../../services/taller.service';

@Component({ standalone: false,
  selector: 'app-moto-form',
  templateUrl: './moto-form.page.html',
  styleUrls: ['./moto-form.page.scss'],
})
export class MotoFormPage implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  esEdicion = false;
  motoId: number | null = null;
  guardando = false;

  form: Moto = {
    cliente_id: 0, marca: '', modelo: '',
    anio: null, placa: '', color: '',
    numero_motor: '', numero_chasis: '', kilometraje_actual: 0,
  };

  // Los tipos que atiende este taller. Con uno solo no se pregunta nada.
  tipos: TipoVehiculo[] = [];
  atributos: Record<string, string | number | null> = {};

  get tipoActual(): TipoVehiculo | undefined {
    return this.tipos.find(t => t.clave === this.form.tipo) || this.tipos[0];
  }

  // "moto" cuando el taller solo atiende motos; "vehículo" en cualquier otro caso.
  get nombre(): string {
    return this.tipos.length === 1 ? this.tipos[0].etiqueta.toLowerCase() : 'vehículo';
  }

  // Al cambiar de tipo, los datos del anterior ya no aplican.
  cambiarTipo(): void {
    this.atributos = {};
  }

  // Requeridos: marca y modelo.
  get valido(): boolean {
    return !!(this.form.marca?.trim() && this.form.modelo?.trim());
  }

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private location: Location,
    private motoSvc: VehiculosService,
    private loading: LoadingController,
    private toast: ToastController
  ) {}

  ngOnInit() {
    this.motoSvc.getTipos().pipe(takeUntil(this.destroy$)).subscribe({
      next: res => {
        this.tipos = res.data;
        if (!this.form.tipo) this.form.tipo = this.tipos[0]?.clave;
      },
      error: () => { this.tipos = []; },
    });

    const id = this.route.snapshot.paramMap.get('id');
    const clienteId = this.route.snapshot.queryParamMap.get('cliente_id');

    if (id) {
      this.esEdicion = true;
      this.motoId = +id;
      this.motoSvc.getById(+id).pipe(takeUntil(this.destroy$)).subscribe(res => { this.form = res.data; this.atributos = { ...(res.data.atributos || {}) }; });
    } else if (clienteId) {
      this.form.cliente_id = +clienteId;
    }
  }

  async guardar() {
    if (!this.valido || this.guardando) return;
    this.guardando = true;
    this.form.atributos = this.atributos;
    const l = await this.loading.create({ message: 'Guardando...', cssClass: 'portal-loading', spinner: 'crescent' });
    await l.present();
    const op = this.esEdicion
      ? this.motoSvc.update(this.motoId!, this.form)
      : this.motoSvc.create(this.form);
    op.pipe(takeUntil(this.destroy$)).subscribe({
      next: async () => {
        await l.dismiss(); this.guardando = false;
        const t = await this.toast.create({ message: 'Vehículo guardado', duration: 2000, color: 'success' });
        await t.present();
        this.location.back();
      },
      error: async () => {
        await l.dismiss(); this.guardando = false;
        const t = await this.toast.create({ message: 'Error al guardar', duration: 2000, color: 'danger' });
        await t.present();
      },
    });
  }

  ngOnDestroy() { this.destroy$.next(); this.destroy$.complete(); }
}
