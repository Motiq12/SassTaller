import {
  AfterViewInit, Component, ElementRef, EventEmitter, NgZone, OnDestroy, Output, ViewChild, inject,
} from '@angular/core';
import { PRODUCTO } from '../../../shared/producto';
import { MOMENTOS, VEHICULOS_TEXTO } from './datos';

/**
 * La portada: una tarjeta negra con un taller de fondo, el titular gigante y, abajo,
 * la frase, la acción y dos tarjetas de vidrio.
 *
 * El fondo tiene dos versiones y la portada nunca espera por ninguna:
 *  · un fotograma fijo (assets/landing/taller-*.webp), que es lo primero que se ve y lo
 *    único que ven el teléfono, quien pidió movimiento reducido o ahorro de datos;
 *  · el video en bucle (assets/landing/taller.mp4, 10 s, sin audio, ~0,7 MB), que se
 *    baja recién cuando la página terminó de cargar, solo en escritorio, y reemplaza al
 *    fotograma con un fundido. Se pausa cuando la portada no se ve.
 * El titular, la bajada y el botón no dependen de nada de esto: se pintan primero.
 *
 * El video lo generó el usuario con IA (es suyo). Para cambiarlo: reemplazar taller.mp4
 * y regenerar los tres fotogramas taller-*.webp a partir del nuevo.
 */
@Component({
  selector: 'app-lp-hero',
  templateUrl: './hero.component.html',
  styleUrls: ['./hero.component.scss'],
  standalone: false,
})
export class HeroComponent implements AfterViewInit, OnDestroy {
  private host = inject(ElementRef<HTMLElement>);
  private zona = inject(NgZone);

  @ViewChild('video') video?: ElementRef<HTMLVideoElement>;
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
  /** Se decide una vez, al arrancar: si es true, el <video> existe en el DOM. */
  readonly conVideo = quiereVideo();
  /** true cuando el video ya tiene un cuadro: el fotograma fijo se funde. */
  videoListo = false;

  private reloj?: ReturnType<typeof setInterval>;
  private visible = true;
  private obs?: IntersectionObserver;
  private quitar: (() => void)[] = [];

  ngAfterViewInit() {
    const reducido = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.obs = new IntersectionObserver(([e]) => {
      this.visible = e.isIntersecting;
      this.sincronizarVideo();
    });
    this.obs.observe(this.host.nativeElement as HTMLElement);
    if (!reducido) {
      this.reloj = setInterval(() => {
        if (this.visible && !document.hidden) this.momento = (this.momento + 1) % this.momentos.length;
      }, 3800);
    }
    if (this.conVideo) this.zona.runOutsideAngular(() => cuandoEsteLibre(() => this.cargarVideo()));
  }

  /** Elegir un momento a mano detiene el paso automático. */
  elegirMomento(i: number) {
    this.momento = i;
    clearInterval(this.reloj);
  }

  ngOnDestroy() {
    clearInterval(this.reloj);
    this.obs?.disconnect();
    this.quitar.forEach((f) => f());
  }

  /** Recién acá el navegador empieza a bajar el video: después de la carga de la página. */
  private cargarVideo() {
    const v = this.video?.nativeElement;
    if (!v) return;
    const alListo = () => {
      this.zona.run(() => (this.videoListo = true));
      this.sincronizarVideo();
    };
    v.addEventListener('playing', alListo, { once: true });
    // Si el navegador bloquea la reproducción automática o el archivo falla, queda el
    // fotograma fijo y nada más: no hay error visible.
    v.addEventListener('error', () => this.zona.run(() => (this.videoListo = false)), { once: true });
    // Angular no siempre pasa el atributo `muted` a la propiedad, y sin ella el
    // navegador bloquea la reproducción automática: se fija a mano.
    v.muted = true;
    v.defaultMuted = true;
    v.preload = 'auto';
    v.load();
    v.play().catch(() => undefined);
    const alVisibilidad = () => this.sincronizarVideo();
    document.addEventListener('visibilitychange', alVisibilidad);
    this.quitar.push(() => document.removeEventListener('visibilitychange', alVisibilidad));
  }

  /** Reproduce solo mientras la portada se ve y la pestaña está activa. */
  private sincronizarVideo() {
    const v = this.video?.nativeElement;
    if (!v || !this.videoListo) return;
    if (this.visible && !document.hidden) v.play().catch(() => undefined);
    else v.pause();
  }
}

/**
 * Video solo donde vale la pena: puntero fino y pantalla ancha, sin movimiento reducido,
 * sin ahorro de datos ni conexión lenta. En el teléfono queda el fotograma fijo:
 * gasta datos y batería, y la portada es más chica.
 */
function quiereVideo(): boolean {
  if (!window.matchMedia('(pointer: fine) and (min-width: 640px)').matches) return false;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
  const nav = navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } };
  if (nav.connection?.saveData) return false;
  if (/(^|-)(2g|3g)$/.test(nav.connection?.effectiveType || '')) return false;
  return true;
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
