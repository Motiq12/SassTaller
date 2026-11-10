import { AfterViewInit, Component, ElementRef, EventEmitter, OnDestroy, Output, inject } from '@angular/core';
import { PRODUCTO } from '../../../shared/producto';
import { MOMENTOS, VEHICULOS_TEXTO } from './datos';

/**
 * La portada: una tarjeta negra con la foto de un taller de fondo (en negro y
 * carmesí, ver assets/landing/taller-*.webp), el titular gigante y, abajo, la frase,
 * la acción y dos tarjetas de vidrio.
 *
 * Todo es HTML y una imagen liviana: lo primero que se pinta es el titular y la foto,
 * sin esperar a ningún script. Antes había un disco de freno en 3D con Three.js; la
 * foto lo reemplazó por pedido del usuario (más clima de taller, menos peso).
 *
 * La foto actual es de Wikimedia Commons (CC BY 2.0, crédito en el pie de la landing):
 * para cambiarla, reemplazar los tres archivos taller-*.webp y el crédito.
 */
@Component({
  selector: 'app-lp-hero',
  templateUrl: './hero.component.html',
  styleUrls: ['./hero.component.scss'],
  standalone: false,
})
export class HeroComponent implements AfterViewInit, OnDestroy {
  private host = inject(ElementRef<HTMLElement>);

  @Output() hablar = new EventEmitter<void>();
  /** Abre el menú de pantalla completa. */
  @Output() menu = new EventEmitter<void>();
  /** Lleva a una sección de la página. */
  @Output() ir = new EventEmitter<string>();

  producto = PRODUCTO;
  readonly vehiculos = VEHICULOS_TEXTO;

  // Momentos del producto en la tarjeta de vidrio: pasan solos cada 3,8 s mientras
  // la portada se ve, y se detienen con movimiento reducido o al elegir uno.
  readonly momentos = MOMENTOS;
  momento = 0;
  private reloj?: ReturnType<typeof setInterval>;
  private visible = true;
  private obs?: IntersectionObserver;

  ngAfterViewInit() {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    this.obs = new IntersectionObserver(([e]) => (this.visible = e.isIntersecting));
    this.obs.observe(this.host.nativeElement as HTMLElement);
    this.reloj = setInterval(() => {
      if (this.visible && !document.hidden) this.momento = (this.momento + 1) % this.momentos.length;
    }, 3800);
  }

  /** Elegir un momento a mano detiene el paso automático. */
  elegirMomento(i: number) {
    this.momento = i;
    clearInterval(this.reloj);
  }

  ngOnDestroy() {
    clearInterval(this.reloj);
    this.obs?.disconnect();
  }
}
