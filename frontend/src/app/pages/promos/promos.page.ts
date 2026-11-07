import { Component, OnDestroy, OnInit } from '@angular/core';
import { AlertController, ToastController } from '@ionic/angular';
import { PromosService, Promo } from '../../services/promos.service';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';

@Component({
  standalone: false,
  selector: 'app-promos',
  templateUrl: './promos.page.html',
  styleUrls: ['./promos.page.scss'],
})
export class PromosPage implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  promos: Promo[] = [];
  cargando = true;

  mostrarForm = false;
  nueva: Promo = { titulo: '', descripcion: '', descuento: 0, activa: 1, imagen: null };

  constructor(
    private promosSvc: PromosService,
    private alert: AlertController,
    private toast: ToastController
  ) {}

  ngOnInit() { this.cargar(); }
  ionViewWillEnter() { this.cargar(); }
  ngOnDestroy() { this.destroy$.next(); this.destroy$.complete(); }

  cargar() {
    this.cargando = true;
    this.promosSvc.getAll().pipe(takeUntil(this.destroy$)).subscribe({
      next: res => { this.promos = res.data; this.cargando = false; },
      error: () => { this.cargando = false; },
    });
  }

  abrirForm() {
    this.nueva = { titulo: '', descripcion: '', descuento: 0, activa: 1, imagen: null };
    this.mostrarForm = true;
  }

  // Lee el archivo elegido y lo guarda como data URL base64.
  onImagen(event: any) {
    const file = event?.target?.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { this.nueva.imagen = reader.result as string; };
    reader.readAsDataURL(file);
  }

  get valido(): boolean {
    return !!this.nueva.titulo.trim() && !!this.nueva.descripcion.trim();
  }

  crear() {
    if (!this.valido) return;
    this.promosSvc.create(this.nueva).pipe(takeUntil(this.destroy$)).subscribe({
      next: res => {
        this.promos.unshift(res.data);
        this.mostrarForm = false;
        this.mostrarToast('Promoción creada');
      },
      error: err => this.mostrarToast(err.error?.error || 'Error', 'danger'),
    });
  }

  toggle(p: Promo) {
    this.promosSvc.toggle(p.id!).pipe(takeUntil(this.destroy$)).subscribe({
      next: res => { p.activa = res.data.activa; },
      error: err => this.mostrarToast(err.error?.error || 'Error', 'danger'),
    });
  }

  async eliminar(p: Promo) {
    const conf = await this.alert.create({
      header: 'Eliminar promoción',
      message: `¿Eliminar "${p.titulo}"?`,
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Eliminar', role: 'destructive',
          handler: () => {
            this.promosSvc.delete(p.id!).pipe(takeUntil(this.destroy$)).subscribe({
              next: () => { this.promos = this.promos.filter(x => x.id !== p.id); this.mostrarToast('Eliminada'); },
            });
          },
        },
      ],
    });
    await conf.present();
  }

  private async mostrarToast(message: string, color = 'success') {
    const t = await this.toast.create({ message, duration: 2000, color });
    await t.present();
  }
}
