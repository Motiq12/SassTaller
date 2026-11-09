import { Component } from '@angular/core';
import { ETAPAS } from './datos';

/**
 * "Cómo funciona", con la forma de la sección "Programs" de Baseline: las cuatro etapas
 * de una orden como filas numeradas, y a la derecha la pantalla de la orden, fija
 * mientras se lee, en la etapa elegida. Es la parte viva de la página: tocar una fila
 * cambia el estado de la orden en la pantalla.
 *
 * Las filas son botones de verdad (teclado, lector de pantalla) y no dependen del scroll.
 */
@Component({
  selector: 'app-lp-etapas',
  templateUrl: './etapas.component.html',
  styleUrls: ['./etapas.component.scss'],
  standalone: false,
})
export class EtapasComponent {
  readonly etapas = ETAPAS;
  etapa = 0;

  cambiar(i: number) { this.etapa = Math.min(this.etapas.length - 1, Math.max(0, i)); }

  /** Flechas arriba/abajo entre filas, como en una lista de pestañas. */
  teclas(ev: KeyboardEvent, i: number) {
    const paso = ev.key === 'ArrowDown' ? 1 : ev.key === 'ArrowUp' ? -1 : 0;
    if (!paso) return;
    ev.preventDefault();
    const n = (i + paso + this.etapas.length) % this.etapas.length;
    this.cambiar(n);
    const lista = (ev.currentTarget as HTMLElement).closest('ol');
    (lista?.querySelectorAll('button')[n] as HTMLElement | undefined)?.focus();
  }
}
