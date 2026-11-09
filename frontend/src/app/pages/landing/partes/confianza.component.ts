import { Component, EventEmitter, Output } from '@angular/core';

interface Garantia { titulo: string; texto: string; }

/**
 * Testimonio de un taller que usa Motiq. SOLO reales y con autorización escrita del
 * taller: nombre, ciudad y cita textual. Ni inventados ni "basados en". Mientras la
 * lista esté vacía, la sección de testimonios no se muestra.
 */
export interface Testimonio { cita: string; persona: string; taller: string; ciudad: string; }
export const TESTIMONIOS: Testimonio[] = [];

/**
 * Por qué confiar: solo hechos que se pueden comprobar en el sistema o en los textos
 * legales. Nada de cifras de clientes ni de "miles de talleres" mientras no existan.
 */
@Component({
  selector: 'app-lp-confianza',
  templateUrl: './confianza.component.html',
  styleUrls: ['./confianza.component.scss'],
  standalone: false,
})
export class ConfianzaComponent {
  @Output() hablar = new EventEmitter<void>();
  readonly testimonios = TESTIMONIOS;
  readonly garantias: Garantia[] = [
    { titulo: 'Tus datos son de tu taller',
      texto: 'No los vendemos ni los usamos para publicidad. Podés pedir una copia o que los borremos cuando quieras.' },
    { titulo: 'Separados de los demás',
      texto: 'Los datos de cada taller están aislados, y el sistema verifica en cada consulta que solo se lean los tuyos.' },
    { titulo: 'Accesos protegidos',
      texto: 'Conexión cifrada, contraseñas guardadas con cifrado de una vía y verificación en dos pasos para tu equipo.' },
    { titulo: 'Nada se borra a los 30 días',
      texto: 'Cuando termina la prueba, tu taller sigue en el plan Gratis con todo lo que cargaste. Sin cobros automáticos.' },
  ];
}
