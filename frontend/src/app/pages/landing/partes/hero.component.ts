import {
  AfterViewInit, Component, ElementRef, EventEmitter, NgZone, OnDestroy, Output, ViewChild, inject,
} from '@angular/core';
import { PRODUCTO } from '../../../shared/producto';
import type { Disco, Encuadre } from './disco-3d';
import { MOMENTOS, VEHICULOS_TEXTO } from './datos';

/**
 * La portada: el titular a la izquierda y el disco de freno a la derecha.
 *
 * El disco tiene dos versiones y la portada nunca espera por ninguna:
 *  · una imagen fija (un cuadro del mismo render), que es lo que se ve primero y lo
 *    único que ven los equipos de gama baja, quien pidió movimiento reducido o un
 *    navegador sin WebGL;
 *  · el 3D en vivo, que se baja recién cuando la página terminó de cargar y el
 *    navegador está libre, y reemplaza a la imagen con un fundido.
 * El titular, la bajada y el botón no dependen de nada de esto: se pintan primero.
 *
 * Variante que se usó → window.__motiqPortada, para comparar sus Web Vitals.
 */
@Component({
  selector: 'app-lp-hero',
  templateUrl: './hero.component.html',
  styleUrls: ['./hero.component.scss'],
  standalone: false,
})
export class HeroComponent implements AfterViewInit, OnDestroy {
  private zona = inject(NgZone);
  private host = inject(ElementRef<HTMLElement>);

  @ViewChild('lienzo', { static: true }) lienzo!: ElementRef<HTMLCanvasElement>;
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
  con3d = false;
  /** Una imagen de 1,3 veces el diámetro: deja lugar al caliper, que sobresale. */
  readonly FOTO_ESCALA = 1.3;

  private disco: Disco | null = null;
  private raf = 0;
  private visible = true;
  private animando = false;
  private scrollEl?: HTMLElement;
  private quitar: (() => void)[] = [];
  private reducido = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  private movil = window.matchMedia('(pointer: coarse)').matches;
  private ultimoCuadro = 0;

  ngAfterViewInit() {
    this.encuadrar();
    if (!this.reducido) {
      this.reloj = setInterval(() => {
        if (this.visible && !document.hidden) this.momento = (this.momento + 1) % this.momentos.length;
      }, 3800);
    }
    if (this.reducido || gamaBaja()) {
      // Imagen fija y nada más: ni siquiera se baja Three.js.
      marcarVariante('fija');
      return;
    }
    // Todo lo del 3D corre fuera de Angular: cada cuadro no tiene por qué
    // disparar la detección de cambios de la página entera.
    this.zona.runOutsideAngular(() => cuandoEsteLibre(() => this.iniciar()));
  }

  /** Elegir un momento a mano detiene el paso automático. */
  elegirMomento(i: number) {
    this.momento = i;
    clearInterval(this.reloj);
  }

  ngOnDestroy() {
    clearInterval(this.reloj);
    cancelAnimationFrame(this.raf);
    this.quitar.forEach((f) => f());
    this.disco?.destruir();
  }

  /** Dónde va el disco y de qué tamaño, según la forma de la pantalla. */
  private calcularEncuadre(): Encuadre {
    const el = this.host.nativeElement as HTMLElement;
    const w = el.clientWidth || window.innerWidth;
    const h = el.clientHeight || window.innerHeight;
    // Encuadre centrado y entero, solo para regenerar la imagen fija del disco
    // (assets/landing/disco-freno.webp) a partir de este mismo render.
    if (location.search.includes('retrato-disco')) return { cx: 0.5, cy: 0.5, diametro: Math.min(w, h) / 1.4 };
    if (w / h >= 0.95) {
      // Escritorio: el disco es la "foto" de la tarjeta oscura. Va a la derecha del
      // centro, debajo del titular gigante; las tarjetas de vidrio quedan sobre su
      // borde de abajo.
      const d = Math.min(h * 0.66, w * 0.4);
      return { cx: 0.64, cy: 0.57, diametro: d };
    }
    // Teléfono: entre el titular y el texto de abajo, cortado por la derecha.
    const d = Math.min(w * 0.82, h * 0.4);
    return { cx: 0.64, cy: 0.47, diametro: d };
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
    if (!this.disco) { marcarVariante('fija'); return; }   // sin WebGL: queda la imagen
    this.disco.encuadrar(this.calcularEncuadre());
    // El fundido de la imagen al 3D recién cuando hay un cuadro dibujado.
    requestAnimationFrame((t) => {
      this.disco?.cuadro(t);
      this.zona.run(() => (this.con3d = true));
      marcarVariante('3d');
    });

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
      // En el teléfono, 30 cuadros por segundo: el giro es lento y no se nota la
      // diferencia, la batería sí.
      if (this.movil && t - this.ultimoCuadro < 1000 / 30 - 2) { this.raf = requestAnimationFrame(paso); return; }
      this.ultimoCuadro = t;
      const sigue = this.disco.cuadro(t);
      if (sigue) this.raf = requestAnimationFrame(paso);
      else this.animando = false;
    };
    this.raf = requestAnimationFrame(paso);
  }
}

/**
 * Equipo al que conviene ahorrarle el 3D: pidió ahorrar datos, tiene una conexión
 * lenta, poca memoria o pocos núcleos (en el teléfono, con un umbral más alto).
 * Las APIs que faltan en un navegador se ignoran: sin dato, no se castiga.
 */
function gamaBaja(): boolean {
  const nav = navigator as Navigator & {
    deviceMemory?: number;
    connection?: { saveData?: boolean; effectiveType?: string };
  };
  if (nav.connection?.saveData) return true;
  if (/(^|-)(2g|3g)$/.test(nav.connection?.effectiveType || '')) return true;
  const memoria = nav.deviceMemory ?? 8;
  const nucleos = nav.hardwareConcurrency || 8;
  const movil = window.matchMedia('(pointer: coarse)').matches;
  return movil ? (memoria <= 3 || nucleos <= 4) : (memoria <= 2 || nucleos <= 2);
}

/** Corre `fn` cuando la página terminó de cargar y el navegador está libre. */
function cuandoEsteLibre(fn: () => void): void {
  const ocioso = () => {
    const ric = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number })
      .requestIdleCallback;
    if (ric) ric(fn, { timeout: 2000 });
    else setTimeout(fn, 300);
  };
  if (document.readyState === 'complete') ocioso();
  else window.addEventListener('load', ocioso, { once: true });
}

/** Qué mostró la portada, para atribuir las Web Vitals (ver web-vitals.util.ts). */
function marcarVariante(v: '3d' | 'fija'): void {
  (window as Window & { __motiqPortada?: string }).__motiqPortada = v;
}
