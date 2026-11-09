import { Component, EventEmitter, Output } from '@angular/core';
import { PRODUCTO } from '../../../shared/producto';

/**
 * El cierre: la marca en grande, de borde a borde, y la "o" es el disco de freno
 * (el motivo de toda la página). Debajo, los enlaces y una sola acción.
 */
@Component({
  selector: 'app-lp-pie',
  templateUrl: './pie.component.html',
  styleUrls: ['./pie.component.scss'],
  standalone: false,
})
export class PieComponent {
  @Output() ir = new EventEmitter<string>();
  readonly producto = PRODUCTO;
  readonly anio = new Date().getFullYear();
  /** Las letras de la marca; la "o" se dibuja como el disco. */
  readonly letras = [
    { l: 'M' },
    { l: 'o', disco: true },
    { l: 't' },
    { l: 'i' },
    { l: 'q' },
  ];
}
