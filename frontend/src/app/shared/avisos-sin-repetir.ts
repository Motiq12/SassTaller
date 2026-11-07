// Que el aviso específico de un error no quede tapado por uno genérico.
//
// Cuando el servidor rechaza algo, ErrorInterceptor muestra su mensaje ("Ese correo ya
// está registrado"). Pero muchas pantallas, además, ponen su propio aviso de error
// justo después ("No se pudo guardar", o una alerta "Error"), que salía encima del
// bueno: la persona solo veía "Error" y no sabía qué pasó.
//
// En vez de tocar las ~130 pantallas, estos dos controladores reemplazan a los de
// Ionic (app.module.ts): durante unos segundos después de un aviso del servidor, los
// avisos de error de las pantallas se crean pero no se muestran. Todo lo demás
// (avisos de éxito, confirmaciones, alertas con otro título) pasa igual que siempre.
import { Injectable } from '@angular/core';
import { AlertController, ToastController } from '@ionic/angular';
import { hayAvisoReciente } from './errores';

// La clase que lleva el aviso del propio interceptor: ese nunca se calla.
export const CLASE_AVISO_SERVIDOR = 'aviso-servidor';

function silenciar<T extends { present: () => Promise<void> }>(overlay: T): T {
  overlay.present = async () => {};
  return overlay;
}

@Injectable()
export class ToastSinRepetir extends ToastController {
  override async create(opts?: Parameters<ToastController['create']>[0]) {
    const toast = await super.create(opts);
    const deError = opts?.color === 'danger';
    const delServidor = String(opts?.cssClass || '').includes(CLASE_AVISO_SERVIDOR);
    return deError && !delServidor && hayAvisoReciente() ? silenciar(toast) : toast;
  }
}

@Injectable()
export class AlertaSinRepetir extends AlertController {
  override async create(opts?: Parameters<AlertController['create']>[0]) {
    const alerta = await super.create(opts);
    // Solo las alertas de error ("Error", "No se pudo…") con un único botón: nunca una
    // que pide confirmar algo.
    const titulo = String(opts?.header || '');
    const botones = Array.isArray(opts?.buttons) ? opts!.buttons.length : 1;
    const deError = /^(error|no se pudo)/i.test(titulo) && botones <= 1;
    return deError && hayAvisoReciente() ? silenciar(alerta) : alerta;
  }
}
