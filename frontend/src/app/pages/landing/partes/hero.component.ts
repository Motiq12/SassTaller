import {
  AfterViewInit, Component, ElementRef, EventEmitter, NgZone, OnDestroy, Output, ViewChild, inject,
} from '@angular/core';
import { PRODUCTO } from '../../../shared/producto';
import type { Disco, Encuadre } from './disco-3d';

/**
 * La portada: el titular a la izquierda y el disco de freno enorme entrando por
 * la derecha, cortado por la pantalla. Detrás, el mismo círculo plano en carmesí
 * (el motivo de toda la página); delante, el disco en 3D que gira con el scroll y
 * se inclina hacia el puntero.
 *
 * Si no hay WebGL, el círculo plano queda solo y la portada sigue entera.
 */
@Component({
  selector: 'lp-hero',
  templateUrl: './hero.component.html',
  styleUrls: ['./hero.component.scss'],
  standalone: false,
})
export class HeroComponent implements AfterViewInit, OnDestroy {
  private zona = inject(NgZone);
  private host = inject(ElementRef<HTMLElement>);

  @ViewChild('lienzo', { static: true }) lienzo!: ElementRef<HTMLCanvasElement>;
  @Output() hablar = new EventEmitter<void>();

  producto = PRODUCTO;
  con3d = false;

  private disco: Disco | null = null;
  private raf = 0;
  private visible = true;
  private animando = false;
  private scrollEl?: HTMLElement;
  private quitar: (() => void)[] = [];
  private reducido = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  ngAfterViewInit() {
    this.encuadrar();
    // Todo lo del 3D corre fuera de Angular: cada cuadro no tiene por qué
    // disparar la detección de cambios de la página entera.
    this.zona.runOutsideAngular(() => this.iniciar());
  }

  ngOnDestroy() {
    cancelAnimationFrame(this.raf);
    this.quitar.forEach((f) => f());
    this.disco?.destruir();
  }

  /** Dónde va el disco y de qué tamaño, según la forma de la pantalla. */
  private calcularEncuadre(): Encuadre {
    const el = this.host.nativeElement as HTMLElement;
    const w = el.clientWidth || window.innerWidth;
    const h = el.clientHeight || window.innerHeight;
    if (w / h >= 0.95) {
      // Escritorio: entra por la derecha, cortado, sin tocar el titular.
      return { cx: 0.8, cy: 0.5, diametro: Math.min(h * 0.98, w * 0.55) };
    }
    // Teléfono: arriba, casi del ancho de la pantalla y cortado a la derecha; su
    // borde de arriba queda debajo de la barra y el caliper, encima del titular.
    return { cx: 0.6, cy: 0.31, diametro: w * 0.94 };
  }

  private encuadrar() {
    const e = this.calcularEncuadre();
    const el = this.host.nativeElement as HTMLElement;
    // El círculo plano de CSS usa el mismo encuadre: con o sin WebGL, están juntos.
    el.style.setProperty('--disco-cx', `${e.cx * 100}%`);
    el.style.setProperty('--disco-cy', `${e.cy * 100}%`);
    el.style.setProperty('--disco-d', `${e.diametro}px`);
    this.disco?.encuadrar(e);
    this.dibujar();
  }

  private async iniciar() {
    const { montarDisco } = await import('./disco-3d');
    this.disco = await montarDisco(this.lienzo.nativeElement, { reducido: this.reducido }).catch(() => null);
    if (!this.disco) return;
    this.zona.run(() => (this.con3d = true));
    this.disco.encuadrar(this.calcularEncuadre());

    const alRedimensionar = () => this.encuadrar();
    window.addEventListener('resize', alRedimensionar, { passive: true });
    this.quitar.push(() => window.removeEventListener('resize', alRedimensionar));

    // El scroll vive en el <ion-content>, no en la ventana.
    const contenido = (this.host.nativeElement as HTMLElement).closest('ion-content') as
      (HTMLElement & { getScrollElement?: () => Promise<HTMLElement> }) | null;
    this.scrollEl = (await contenido?.getScrollElement?.()) ?? undefined;
    if (this.scrollEl) {
      const alScroll = () => {
        const alto = (this.host.nativeElement as HTMLElement).clientHeight || 1;
        this.disco?.scroll(Math.min(1, Math.max(0, this.scrollEl!.scrollTop / alto)));
        this.dibujar();
      };
      this.scrollEl.addEventListener('scroll', alScroll, { passive: true });
      this.quitar.push(() => this.scrollEl?.removeEventListener('scroll', alScroll));
    }

    if (window.matchMedia('(pointer: fine)').matches) {
      const alPuntero = (ev: PointerEvent) => {
        this.disco?.puntero((ev.clientX / window.innerWidth) * 2 - 1, (ev.clientY / window.innerHeight) * 2 - 1);
        this.dibujar();
      };
      window.addEventListener('pointermove', alPuntero, { passive: true });
      this.quitar.push(() => window.removeEventListener('pointermove', alPuntero));
    }

    // Solo se dibuja mientras la portada se ve y la pestaña está activa.
    const obs = new IntersectionObserver(([e]) => { this.visible = e.isIntersecting; this.dibujar(); });
    obs.observe(this.lienzo.nativeElement);
    this.quitar.push(() => obs.disconnect());
    const alVisibilidad = () => this.dibujar();
    document.addEventListener('visibilitychange', alVisibilidad);
    this.quitar.push(() => document.removeEventListener('visibilitychange', alVisibilidad));

    this.dibujar();
  }

  /** Pide cuadros mientras haya algo que mover; se detiene sola en reposo. */
  private dibujar() {
    if (!this.disco || this.animando || !this.visible || document.hidden) return;
    this.animando = true;
    const paso = (t: number) => {
      if (!this.disco || !this.visible || document.hidden) { this.animando = false; return; }
      const sigue = this.disco.cuadro(t);
      if (sigue) this.raf = requestAnimationFrame(paso);
      else this.animando = false;
    };
    this.raf = requestAnimationFrame(paso);
  }
}
