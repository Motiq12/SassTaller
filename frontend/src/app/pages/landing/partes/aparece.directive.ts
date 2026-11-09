import { Directive, ElementRef, Input, OnDestroy, OnInit, inject } from '@angular/core';

/**
 * Entrada de una pieza cuando su sección entra en pantalla: le pone `.visto` una
 * sola vez y el estilo (mixin `entrada` de _base.scss) la hace subir y aparecer.
 *
 * El contenido nunca depende de esto: el estado oculto solo se aplica bajo
 * `.lp-js`, que la landing pone cuando el script ya está corriendo, y con
 * movimiento reducido el estilo lo anula.
 */
@Directive({ selector: '[lpAparece]', standalone: false })
export class ApareceDirective implements OnInit, OnDestroy {
  private el = inject(ElementRef<HTMLElement>);
  private obs?: IntersectionObserver;

  /** Escalonado dentro de la sección, en milisegundos (60–90 entre piezas). */
  @Input() retraso = 0;

  ngOnInit() {
    const nodo = this.el.nativeElement as HTMLElement;
    nodo.style.setProperty('--retraso', `${this.retraso}ms`);
    if (!('IntersectionObserver' in window)) {
      nodo.classList.add('visto');
      return;
    }
    this.obs = new IntersectionObserver((entradas) => {
      if (entradas.some((e) => e.isIntersecting)) {
        nodo.classList.add('visto');
        this.obs?.disconnect();
      }
    }, { rootMargin: '0px 0px -12% 0px' });
    this.obs.observe(nodo);
  }

  ngOnDestroy() { this.obs?.disconnect(); }
}
