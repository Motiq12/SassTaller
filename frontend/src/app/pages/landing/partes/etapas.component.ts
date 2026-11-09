import { Component } from '@angular/core';
import { ETAPAS } from './datos';

/**
 * "Cómo funciona": una orden real que el visitante arrastra por sus cuatro etapas
 * (recepción → diagnóstico → aprobación → entrega). Es la parte viva de la página:
 * la frase de la izquierda y la pantalla de la orden cambian juntas.
 *
 * Es un <input type="range"> de verdad: funciona con el dedo, el mouse, las
 * flechas del teclado y un lector de pantalla, y no depende del scroll.
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

  cambiar(valor: string | number) {
    const n = Math.round(Number(valor));
    if (Number.isFinite(n)) this.etapa = Math.min(3, Math.max(0, n));
  }

  get avance() { return (this.etapa / (this.etapas.length - 1)) * 100; }
}
