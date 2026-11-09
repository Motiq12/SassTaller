import { Component, OnInit, inject } from '@angular/core';
import { TallerService } from '../../../services/taller.service';

interface Cifra { valor: string; rotulo: string; texto: string; }

/**
 * "En números", la banda oscura de "Stats" de Baseline. Solo cifras del producto que
 * se pueden comprobar (los días de prueba salen del mismo endpoint que los precios),
 * nunca de clientes ni de facturación: no hay testimonios ni cifras de uso inventadas.
 */
@Component({
  selector: 'app-lp-numeros',
  templateUrl: './numeros.component.html',
  styleUrls: ['./numeros.component.scss'],
  standalone: false,
})
export class NumerosComponent implements OnInit {
  private taller = inject(TallerService);
  cifras = armar(30);

  ngOnInit() {
    this.taller.planes().subscribe({
      next: (r) => { if (r.data?.dias_prueba) this.cifras = armar(r.data.dias_prueba); },
      error: () => { /* queda el valor de fábrica */ },
    });
  }
}

/** Un arreglo fijo (no un getter): el *ngFor no debe recrear las celdas en cada ciclo. */
function armar(dias: number): Cifra[] {
  return [
    { valor: String(dias), rotulo: 'días de prueba', texto: 'Con el sistema completo y sin tarjeta.' },
    { valor: '₡0', rotulo: 'plan Gratis', texto: 'Para siempre, con órdenes y clientes sin límite.' },
    { valor: '6', rotulo: 'tipos de vehículo', texto: 'Motos, autos, camiones, buses, busetas y otros.' },
    { valor: '2', rotulo: 'pasos', texto: 'Para registrar tu taller y empezar a cargar órdenes.' },
  ];
}
