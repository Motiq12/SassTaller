import { Component, OnInit, OnDestroy } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Location } from '@angular/common';
import { LoadingController, ToastController } from '@ionic/angular';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { MotosService } from '../../services/motos.service';
import { Moto } from '../../models/moto.model';

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

  // Requeridos: marca y modelo.
  get valido(): boolean {
    return !!(this.form.marca?.trim() && this.form.modelo?.trim());
  }

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private location: Location,
    private motoSvc: MotosService,
    private loading: LoadingController,
    private toast: ToastController
  ) {}

  ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id');
    const clienteId = this.route.snapshot.queryParamMap.get('cliente_id');

    if (id) {
      this.esEdicion = true;
      this.motoId = +id;
      this.motoSvc.getById(+id).pipe(takeUntil(this.destroy$)).subscribe(res => this.form = res.data);
    } else if (clienteId) {
      this.form.cliente_id = +clienteId;
    }
  }

  async guardar() {
    if (!this.valido || this.guardando) return;
    this.guardando = true;
    const l = await this.loading.create({ message: 'Guardando...', cssClass: 'portal-loading', spinner: 'crescent' });
    await l.present();
    const op = this.esEdicion
      ? this.motoSvc.update(this.motoId!, this.form)
      : this.motoSvc.create(this.form);
    op.pipe(takeUntil(this.destroy$)).subscribe({
      next: async () => {
        await l.dismiss(); this.guardando = false;
        const t = await this.toast.create({ message: 'Moto guardada', duration: 2000, color: 'success' });
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
