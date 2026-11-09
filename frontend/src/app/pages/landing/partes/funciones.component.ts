import { Component } from '@angular/core';

interface Funcion { nombre: string; texto: string; nota?: string; }

/**
 * Lo que trae Motiq, con la forma de "Facilities" de Baseline: una tarjeta blanca que
 * se monta sobre "Cómo funciona", con dos pantallas grandes y las seis partes debajo. Cada frase describe algo que el sistema hace hoy
 * (revisado contra el código): si una función cambia, esta lista cambia con ella.
 * Sin íconos: el número, el nombre y una línea que dice para qué sirve.
 */
@Component({
  selector: 'app-lp-funciones',
  templateUrl: './funciones.component.html',
  styleUrls: ['./funciones.component.scss'],
  standalone: false,
})
export class FuncionesComponent {
  readonly funciones: Funcion[] = [
    { nombre: 'Órdenes de trabajo',
      texto: 'Recepción, diagnóstico, presupuesto, aprobación del cliente, reparación y entrega con garantía. Cada orden con su estado a la vista.' },
    { nombre: 'Agenda',
      texto: 'Citas por mecánico y por día. El cliente puede agendar desde su portal y le llega un recordatorio por correo.' },
    { nombre: 'Técnicos',
      texto: 'Cada mecánico entra con su usuario, ve sus tareas del día y, desde el celular, avanza sus trabajos y anota los repuestos que usa.' },
    { nombre: 'Clientes y vehículos',
      texto: 'La ficha de cada cliente con sus vehículos y el historial completo de cada placa.' },
    { nombre: 'Sucursales',
      texto: 'Varias sedes en una sola cuenta, con su agenda y su equipo.',
      nota: 'En la prueba y en Pro.' },
    { nombre: 'Portal de clientes',
      texto: 'Tus clientes siguen su vehículo, aprueban presupuestos y agendan citas desde el celular, sin instalar nada.',
      nota: 'Con tu logo y tus colores en la prueba y en Pro.' },
  ];
}
