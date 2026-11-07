import { Injectable } from '@angular/core';
import { MarcaService } from './marca.service';
import { DatosMensaje, armarMensaje, plantillaDeCita, motoDe } from '../shared/whatsapp.util';

// Arma los mensajes de WhatsApp al cliente con lo que el taller reescribió en
// Configuración → Mensajes al cliente (viene con la marca, /api/marca).
//
// Es sincrónico a propósito: WhatsApp se abre con window.open, que el navegador solo
// deja hacer en el mismo toque del botón. Por eso cada pantalla llama a precargar()
// al abrirse; si todavía no llegó, sale el texto de fábrica.
@Injectable({ providedIn: 'root' })
export class MensajesService {
  private propias: Record<string, string> = {};

  constructor(private marca: MarcaService) {}

  precargar() {
    this.marca.get().subscribe(m => this.propias = m.plantillas?.whatsapp || {});
  }

  armar(clave: string, datos: DatosMensaje): string {
    return armarMensaje(clave, datos, this.propias);
  }

  // El de una cita del día, según su estado.
  deCita(c: any): string {
    return this.armar(plantillaDeCita(c), {
      nombre: (c?.cliente_nombre || '').trim(), moto: motoDe(c), orden: c?.numero_orden, hora: (c?.hora || '').slice(0, 5),
    });
  }
}
