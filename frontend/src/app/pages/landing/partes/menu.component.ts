import { Component, ElementRef, EventEmitter, HostListener, Input, OnChanges, Output, ViewChild } from '@angular/core';
import { PRODUCTO } from '../../../shared/producto';

/**
 * El menú de pantalla completa que abre la hamburguesa de la portada: las secciones
 * en grande, la acción principal y el acceso. Fondo negro que se funde, enlaces que
 * suben escalonados. Escape cierra; al abrir, el foco va al botón de cerrar.
 */
@Component({
  selector: 'app-lp-menu',
  templateUrl: './menu.component.html',
  styleUrls: ['./menu.component.scss'],
  standalone: false,
})
export class MenuComponent implements OnChanges {
  @Input() abierto = false;
  @Output() cerrar = new EventEmitter<void>();
  @Output() ir = new EventEmitter<string>();
  @Output() hablar = new EventEmitter<void>();
  @ViewChild('botonCerrar') botonCerrar?: ElementRef<HTMLButtonElement>;

  readonly producto = PRODUCTO;
  readonly enlaces = [
    { id: 'como', texto: 'Cómo funciona' },
    { id: 'funciones', texto: 'Funciones' },
    { id: 'precios', texto: 'Precios' },
    { id: 'preguntas', texto: 'Preguntas' },
  ];

  ngOnChanges() {
    if (this.abierto) setTimeout(() => this.botonCerrar?.nativeElement.focus(), 120);
  }

  @HostListener('document:keydown.escape')
  alEscape() { if (this.abierto) this.cerrar.emit(); }
}
