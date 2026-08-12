import { Component, Input } from '@angular/core';
import { MarcaService } from '../services/marca.service';

/**
 * Logo del taller, con sus iniciales como respaldo.
 *
 * Reemplaza a los `<img src="assets/logo/ms-*.png">` que estaban repartidos por la
 * app: eso mostraba la marca del taller original a todos los talleres del SaaS.
 *
 * Cuando el taller no cargó logo se pintan sus iniciales sobre su color de marca,
 * en vez de un logo genérico. Una imagen de relleno se lee como un error de carga;
 * las iniciales se leen como una decisión, y funcionan para cualquier empresa.
 */
@Component({
  selector: 'app-marca-logo',
  standalone: false,
  template: `
    <img *ngIf="(marca.marca$ | async)?.logo as logo" [src]="logo" [alt]="marca.actual.nombre_taller"
         class="marca-img" [style.height.px]="tamano" [style.width.px]="tamano" />
    <span *ngIf="!(marca.marca$ | async)?.logo" class="marca-iniciales"
          [style.height.px]="tamano" [style.width.px]="tamano"
          [style.font-size.px]="tamano * 0.4"
          [attr.aria-label]="marca.actual.nombre_taller">{{ marca.iniciales }}</span>
  `,
  styles: [`
    :host { display: inline-flex; align-items: center; }
    .marca-img { object-fit: contain; border-radius: 8px; }
    .marca-iniciales {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: 8px;
      font-weight: 700;
      letter-spacing: .02em;
      background: var(--ion-color-primary);
      color: var(--ion-color-primary-contrast);
    }
  `],
})
export class MarcaLogoComponent {
  /** Lado en píxeles. Cuadrado a propósito: sirve igual para un isotipo o iniciales. */
  @Input() tamano = 36;
  constructor(public marca: MarcaService) {}
}
