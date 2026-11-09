import { Component, Input } from '@angular/core';
import {
  AGENDA, ENTREGADAS, ETAPAS, FACTURADO, HISTORIAL, ORDEN, PORTAL, SEMANAS, SERVICIOS_TOP, TICKET,
  TOTAL_HISTORIAL, TOTAL_ORDEN, crc,
} from './datos';

export type TipoPantalla = 'historial' | 'portal' | 'agenda' | 'reportes' | 'orden';

/**
 * Un fragmento real de la interfaz de Motiq, con el aspecto de la app (DESIGN.md:
 * tarjetas blancas, carmesí, cifras tabulares). Está hecho en HTML y no
 * como captura: nítido a cualquier tamaño, y la orden cambia de estado en vivo
 * cuando el visitante la arrastra por sus etapas.
 *
 * Lleva `data-ui` en la raíz: es interfaz del producto, con sus propias reglas
 * (bordes, etiquetas chicas, monoespaciada en los montos).
 */
@Component({
  selector: 'app-lp-pantalla',
  templateUrl: './pantalla.component.html',
  styleUrls: ['./pantalla.component.scss'],
  standalone: false,
})
export class PantallaComponent {
  @Input() tipo: TipoPantalla = 'orden';
  /** Solo para `orden`: 0 recepción · 1 diagnóstico · 2 aprobación · 3 entrega. */
  @Input() etapa = 0;

  readonly crc = crc;
  readonly orden = ORDEN;
  readonly totalOrden = TOTAL_ORDEN;
  readonly etapas = ETAPAS;
  readonly historial = HISTORIAL;
  readonly totalHistorial = TOTAL_HISTORIAL;
  readonly portal = PORTAL;
  readonly agenda = AGENDA;
  readonly semanas = SEMANAS;
  readonly facturado = FACTURADO;
  readonly entregadas = ENTREGADAS;
  readonly ticket = TICKET;
  readonly serviciosTop = SERVICIOS_TOP;
  readonly maxSemana = Math.max(...SEMANAS.map((s) => s.monto));

  get estado() { return this.etapas[Math.min(Math.max(this.etapa, 0), 3)]; }
}
