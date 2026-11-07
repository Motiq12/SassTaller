import { Component, OnInit, OnDestroy } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Location } from '@angular/common';
import { LoadingController, ToastController } from '@ionic/angular';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { ClientesService } from '../../services/clientes.service';
import { Cliente } from '../../models/cliente.model';

@Component({ standalone: false,
  selector: 'app-cliente-form',
  templateUrl: './cliente-form.page.html',
  styleUrls: ['./cliente-form.page.scss'],
})
export class ClienteFormPage implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  esEdicion = false;
  clienteId: number | null = null;
  guardando = false;

  form: Cliente = {
    nombre: '', apellido: '', telefono: '',
    email: '', cedula: '', direccion: '',
  };

  get valido(): boolean {
    if (this.esEdicion) {
      return !!(this.form.nombre?.trim() && this.form.apellido?.trim() && this.form.telefono?.trim());
    }
    return !!(this.form.nombre?.trim() && this.form.apellido?.trim() && this.form.telefono?.trim() && this.form.cedula?.trim());
  }

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private location: Location,
    private clienteSvc: ClientesService,
    private loading: LoadingController,
    private toast: ToastController
  ) {}

  ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.esEdicion = true;
      this.clienteId = +id;
      this.clienteSvc.getById(+id).pipe(takeUntil(this.destroy$)).subscribe(res => { this.form = res.data; });
    }
  }

  async guardar() {
    if (!this.valido || this.guardando) return;
    this.guardando = true;
    const l = await this.loading.create({ message: 'Guardando...', cssClass: 'portal-loading', spinner: 'crescent' });
    await l.present();
    const op = this.esEdicion
      ? this.clienteSvc.update(this.clienteId!, this.form)
      : this.clienteSvc.create(this.form);
    op.pipe(takeUntil(this.destroy$)).subscribe({
      next: async () => {
        await l.dismiss(); this.guardando = false;
        const t = await this.toast.create({ message: 'Cliente guardado', duration: 2000, color: 'success' });
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
