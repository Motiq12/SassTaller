import { AfterViewInit, Component, ElementRef, NgZone, OnDestroy, OnInit, ViewChild, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { IonContent } from '@ionic/angular';
import { MarcaService } from '../../services/marca.service';
import { PRODUCTO } from '../../shared/producto';

type Lenis = import('lenis').default;

/**
 * La cara pública de Motiq: lo que ve alguien que llega sin saber qué es esto.
 *
 * Tiene DOS caminos a propósito, porque son dos ventas distintas:
 *
 *  · El taller de uno o dos mecánicos se registra solo. No va a hablar con nadie ni
 *    a esperar una llamada: si no puede probarlo en el momento, se va. Para ese está
 *    "Probá gratis", que lleva directo a /registro-taller.
 *
 *  · Un grupo con varias sucursales no se da de alta desde una página web. Para ese
 *    está "Hablá con nosotros" (partes/contacto.component): lo que deja ahí cae en la
 *    bandeja del panel de Motiq y se cierra hablando.
 *
 * El diseño sigue el sistema de partes/_sistema.scss: la estructura y el movimiento de
 * "Baseline" en los colores de Motiq. Página clara en un marco blanco, secciones
 * oscuras como tarjetas, el carmesí como único acento y el disco de freno en 3D como
 * la foto de la portada.
 *
 * Es del PRODUCTO, no de ningún taller: acá manda la marca de Motiq (ver producto.ts).
 */
@Component({
  selector: 'app-landing',
  templateUrl: './landing.page.html',
  styleUrls: ['./landing.page.scss'],
  standalone: false,
})
export class LandingPage implements OnInit, AfterViewInit, OnDestroy {
  private marca = inject(MarcaService);
  private zona = inject(NgZone);
  private route = inject(ActivatedRoute);

  @ViewChild(IonContent) contenido?: IonContent;
  @ViewChild('pagina', { static: true }) pagina!: ElementRef<HTMLElement>;

  producto = PRODUCTO;
  /** Recién con el script corriendo se esconden las piezas para su entrada. */
  conScript = false;
  menuAbierto = false;
  contactoAbierto = false;

  private lenis?: Lenis;
  private quitar: (() => void)[] = [];

  ngOnInit() {
    // Puede quedar pintado el color de un taller de una sesión anterior en el mismo
    // navegador. Acá se muestra Motiq, no un cliente.
    this.marca.limpiar();
    this.conScript = true;
  }

  async ngAfterViewInit() {
    const el = await this.contenido?.getScrollElement();
    if (!el) return;
    this.zona.runOutsideAngular(() => this.suavizarScroll(el));

    // Llegar con #contacto desde otra pantalla (el "escribinos" del login) abre el
    // formulario; con cualquier otra sección, baja hasta ella.
    const destino = this.route.snapshot.fragment;
    if (destino === 'contacto') setTimeout(() => this.abrirContacto(), 300);
    else if (destino) setTimeout(() => this.irA(destino), 300);
  }

  ngOnDestroy() {
    this.quitar.forEach((f) => f());
    this.lenis?.destroy();
  }

  /**
   * Scroll suave con Lenis, sobre el contenedor de ion-content (no la ventana). Solo
   * con mouse y sin movimiento reducido: en el teléfono el scroll nativo ya es mejor.
   *
   * Lenis necesita un cuadro por frame para animar, pero no se deja un bucle corriendo
   * siempre: arranca con la rueda o el teclado y se apaga solo cuando el scroll se
   * detuvo. En reposo, la página no pide ni un cuadro.
   */
  private async suavizarScroll(el: HTMLElement) {
    const fino = window.matchMedia('(pointer: fine)').matches;
    const reducido = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!fino || reducido) return;
    const { default: Lenis } = await import('lenis');
    const lenis = new Lenis({ wrapper: el, content: this.pagina.nativeElement, eventsTarget: el, smoothWheel: true });
    this.lenis = lenis;

    let raf = 0;
    let quieto = 0;
    const paso = (t: number) => {
      lenis.raf(t);
      quieto = lenis.isScrolling ? 0 : quieto + 1;
      raf = quieto > 10 ? 0 : requestAnimationFrame(paso);
    };
    const despertar = () => { quieto = 0; if (!raf) raf = requestAnimationFrame(paso); };
    el.addEventListener('wheel', despertar, { passive: true });
    window.addEventListener('keydown', despertar);
    this.quitar.push(() => {
      cancelAnimationFrame(raf);
      el.removeEventListener('wheel', despertar);
      window.removeEventListener('keydown', despertar);
    });
    this.despertarScroll = despertar;
  }
  private despertarScroll?: () => void;

  irA(id: string) {
    const destino = document.getElementById(id);
    if (!destino || !this.contenido) return;
    if (this.lenis) {
      this.despertarScroll?.();
      this.lenis.scrollTo(destino, { offset: -12 });
      return;
    }
    // scrollIntoView no conoce el contenedor de Ionic; se calcula la posición.
    this.contenido.getScrollElement().then((el) => {
      const top = destino.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop - 12;
      const suave = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      el.scrollTo({ top, behavior: suave ? 'smooth' : 'auto' });
    });
  }

  // Con el menú o el formulario abiertos, el scroll de atrás se detiene.
  abrirMenu() {
    this.menuAbierto = true;
    this.lenis?.stop();
  }
  cerrarMenu() {
    this.menuAbierto = false;
    if (!this.contactoAbierto) this.lenis?.start();
  }
  abrirContacto() {
    this.contactoAbierto = true;
    this.lenis?.stop();
  }
  cerrarContacto() {
    this.contactoAbierto = false;
    this.lenis?.start();
  }
}
