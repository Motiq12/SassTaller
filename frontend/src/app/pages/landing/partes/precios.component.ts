import { Component, EventEmitter, Output } from '@angular/core';

interface Plan {
  nombre: string;
  precio: string;
  plazo: string;
  incluye: string;
  accion: string;
  destino: 'registro' | 'contacto';
}

/**
 * Precios: los nombres de los planes son la lista y el precio que se ve es el del
 * plan elegido. Arranca en "Gratis", el del medio, porque es la pregunta que todos
 * se hacen sin decirla: qué pasa el día 31 (respuesta: nada se borra).
 *
 * Los planes salen del modelo de cuenta decidido (trial 30 días → gratis capado,
 * Pro a convenir; los topes viven en backend/src/utils/limites.js).
 */
@Component({
  selector: 'lp-precios',
  templateUrl: './precios.component.html',
  styleUrls: ['./precios.component.scss'],
  standalone: false,
})
export class PreciosComponent {
  @Output() hablar = new EventEmitter<void>();

  readonly planes: Plan[] = [
    {
      nombre: 'Prueba',
      precio: 'Gratis',
      plazo: '30 días',
      incluye: 'El sistema completo, sin recortes y sin tarjeta. Cuando termina, tus datos se quedan: el taller pasa solo al plan Gratis.',
      accion: 'Empezar la prueba',
      destino: 'registro',
    },
    {
      nombre: 'Gratis',
      precio: '₡0',
      plazo: 'para siempre',
      incluye: 'Órdenes, clientes y vehículos sin límite, con el portal de clientes incluido. Una sucursal y hasta 2 usuarios. Es donde queda tu taller cuando termina la prueba: no se borra nada.',
      accion: 'Crear mi taller',
      destino: 'registro',
    },
    {
      nombre: 'Pro',
      precio: 'A convenir',
      plazo: 'por mes',
      incluye: 'Usuarios sin límite y varias sucursales, tu logo y tus colores en el portal, y soporte directo. Para un grupo con varias sedes lo armamos con vos, con migración de tus datos.',
      accion: 'Hablemos del plan Pro',
      destino: 'contacto',
    },
  ];

  elegido = 1;

  elegir(i: number) { this.elegido = i; }

  teclado(ev: KeyboardEvent, i: number) {
    const paso = ev.key === 'ArrowDown' || ev.key === 'ArrowRight' ? 1 : ev.key === 'ArrowUp' || ev.key === 'ArrowLeft' ? -1 : 0;
    if (!paso) return;
    ev.preventDefault();
    this.elegido = (i + paso + this.planes.length) % this.planes.length;
    (ev.currentTarget as HTMLElement).parentElement?.querySelectorAll<HTMLButtonElement>('.plan')[this.elegido]?.focus();
  }
}
