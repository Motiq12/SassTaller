import { Component, EventEmitter, Output } from '@angular/core';
import { PRODUCTO } from '../../../shared/producto';

/**
 * El pie oscuro de Baseline: arriba la última invitación, en el medio las columnas de
 * enlaces y abajo la marca en grande, de borde a borde. Sin correo ni teléfono: el
 * contacto es el formulario.
 */
@Component({
  selector: 'app-lp-pie',
  templateUrl: './pie.component.html',
  styleUrls: ['./pie.component.scss'],
  standalone: false,
})
export class PieComponent {
  @Output() ir = new EventEmitter<string>();
  @Output() hablar = new EventEmitter<void>();
  readonly producto = PRODUCTO;
  readonly anio = new Date().getFullYear();
}
