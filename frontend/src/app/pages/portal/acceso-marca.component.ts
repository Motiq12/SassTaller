import { Component } from '@angular/core';

// La marca de entrar, crear cuenta y recuperar el acceso: la foto del taller de
// fondo (ocupa toda la pantalla, ver portal-login.page.scss), el logo, el título
// y lo que el portal le resuelve al cliente.
//
// En escritorio el título va grande, abajo a la izquierda, con los tres puntos
// numerados debajo; el formulario es la columna de la derecha. En tablet y
// celular quedan el logo y el título arriba, y el formulario sube como una hoja.
@Component({
  standalone: false,
  selector: 'app-acceso-marca',
  templateUrl: './acceso-marca.component.html',
  styleUrls: ['./acceso-marca.component.scss'],
})
export class AccesoMarcaComponent {
  // Solo lo que el portal hace hoy (Inicio, Agendar, Mis citas, Motos y Ofertas).
  readonly puntos = [
    { titulo: 'El estado de tu moto', texto: 'De la recepción a la entrega, etapa por etapa.' },
    { titulo: 'Citas en línea', texto: 'Elige el día y la hora que el taller tiene libres.' },
    { titulo: 'Presupuestos', texto: 'Revisa y aprueba el trabajo antes de que empiece.' },
  ];
}
