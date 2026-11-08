import { Component, inject } from '@angular/core';
import { MarcaService } from '../../services/marca.service';

// La marca de entrar, crear cuenta y recuperar el acceso: la foto del taller de
// fondo (ocupa toda la pantalla, ver portal-login.page.scss), el logo, el título
// y lo que el portal le resuelve al cliente.
//
// En escritorio el título va grande, abajo a la izquierda, con los tres puntos
// numerados debajo; el formulario es la columna de la derecha. En tablet y
// celular quedan el logo y el título arriba, y el formulario sube como una hoja.
//
// El logo y el nombre salen de MarcaService, NO de un archivo de la app. Venían a
// fuego de MS Motos ("Portal MS Motos", ms-logo-white.png, "Tu moto, en buenas
// manos"), y este portal lo abre el cliente de CUALQUIER taller: quien entra al
// portal de un taller de autos no tiene por qué ver el logo ni el eslogan de otra
// empresa. Es el mismo problema que el logo de respaldo en las facturas.
@Component({
  standalone: false,
  selector: 'app-acceso-marca',
  templateUrl: './acceso-marca.component.html',
  styleUrls: ['./acceso-marca.component.scss'],
})
export class AccesoMarcaComponent {
  readonly marca = inject(MarcaService);

  // Solo lo que el portal hace hoy (Inicio, Agendar, Mis citas, Vehículos y Ofertas).
  // El texto no nombra un tipo de vehículo: el mismo portal lo usa un taller de
  // motos y uno de autos.
  readonly puntos = [
    { titulo: 'El estado de tu vehículo', texto: 'De la recepción a la entrega, etapa por etapa.' },
    { titulo: 'Citas en línea', texto: 'Elige el día y la hora que el taller tiene libres.' },
    { titulo: 'Presupuestos', texto: 'Revisa y aprueba el trabajo antes de que empiece.' },
  ];
}
