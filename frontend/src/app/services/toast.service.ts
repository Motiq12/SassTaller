import { Injectable, inject } from '@angular/core';
import { ToastController } from '@ionic/angular';

@Injectable({ providedIn: 'root' })
export class ToastService {
  private toastCtrl = inject(ToastController);

  async success(message: string, duration = 2000) {
    const toast = await this.toastCtrl.create({
      message,
      duration,
      color: 'success',
      position: 'bottom',
      icon: 'checkmark-circle-outline',
    });
    await toast.present();
  }

  async error(message = 'Ocurrió un error. Intentá de nuevo.', duration = 3000) {
    const toast = await this.toastCtrl.create({
      message,
      duration,
      color: 'danger',
      position: 'bottom',
      icon: 'alert-circle-outline',
    });
    await toast.present();
  }

  async warn(message: string, duration = 3000) {
    const toast = await this.toastCtrl.create({
      message,
      duration,
      color: 'warning',
      position: 'bottom',
      icon: 'warning-outline',
    });
    await toast.present();
  }
}
