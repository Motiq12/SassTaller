import { Injectable } from '@angular/core';
import { ToastController } from '@ionic/angular';
import { CLASE_AVISO_SERVIDOR } from '../shared/avisos-sin-repetir';

@Injectable({ providedIn: 'root' })
export class ToastService {
  constructor(private toastCtrl: ToastController) {}

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

  // El aviso de un error del servidor (lo usa ErrorInterceptor). Lleva la clase que
  // AvisosSinRepetir respeta, y dura un poco más: es el que dice qué pasó.
  async errorServidor(message: string) {
    const toast = await this.toastCtrl.create({
      message,
      duration: 4500,
      color: 'danger',
      position: 'bottom',
      icon: 'alert-circle-outline',
      cssClass: CLASE_AVISO_SERVIDOR,
      buttons: [{ icon: 'close', role: 'cancel', side: 'end' }],
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
