import { Component } from '@angular/core';
import { PRODUCTO } from '../../../shared/producto';

interface Ajuste {
  frase: string;
  consecuencia: string;
  prendido: boolean;
}

/**
 * "Se adapta a tu taller, no al revés": una frase por cosa que el taller decide,
 * cada una con su interruptor. Prendido, la banda se llena de carmesí y aparece lo
 * que cambia. Son botones role="switch": clic, Espacio y Enter.
 */
@Component({
  selector: 'app-lp-adapta',
  templateUrl: './adapta.component.html',
  styleUrls: ['./adapta.component.scss'],
  standalone: false,
})
export class AdaptaComponent {
  readonly producto = PRODUCTO;

  readonly ajustes: Ajuste[] = [
    {
      frase: 'Atendés motos, autos o las dos cosas.',
      consecuencia: 'Al registrarte lo elegís, y el catálogo de servicios y los formularios se arman acorde.',
      prendido: true,
    },
    {
      frase: 'Tus clientes ven tu marca, no la nuestra.',
      consecuencia: 'Tu nombre, tu logo y tus colores en el portal y en los correos. Motiq no aparece.',
      prendido: true,
    },
    {
      frase: 'Las citas se recuerdan solas.',
      consecuencia: 'Cada cliente recibe un aviso el día antes. Menos huecos en la agenda.',
      prendido: false,
    },
    {
      frase: 'El cliente sigue su orden sin llamarte.',
      consecuencia: 'Ve en qué va su vehículo, aprueba el presupuesto y sabe cuándo retirarlo.',
      prendido: false,
    },
    {
      frase: 'Varias sucursales, una sola cuenta.',
      consecuencia: 'Agenda, mecánicos y reportes por sucursal, desde un mismo panel. Plan Pro.',
      prendido: false,
    },
  ];

  alternar(a: Ajuste) { a.prendido = !a.prendido; }
}
