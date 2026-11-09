import { AfterViewInit, Component, ElementRef, NgZone, OnDestroy, OnInit, ViewChild, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { IonContent } from '@ionic/angular';
import { MarcaService } from '../../services/marca.service';
import { PRODUCTO } from '../../shared/producto';

/**
 * La cara pública de Motiq: lo que ve alguien que llega sin saber qué es esto.
 *
 * Tiene DOS caminos a propósito, porque son dos ventas distintas:
 *
 *  · El taller de uno o dos mecánicos se registra solo. No va a hablar con nadie ni
 *    a esperar una llamada: si no puede probarlo en el momento, se va. Para ese está
 *    "Probá gratis", que lleva directo a /registro-taller.
 *
 *  · Un grupo con varias sucursales no se da de alta desde una página web. Decide
 *    por comité, pregunta por facturación, migración de datos y quién responde si
 *    algo falla. Para ese está el cupón de contacto (partes/cupon.component): lo que
 *    deja ahí cae en la bandeja del panel de Motiq y se cierra hablando.
 *
 * El diseño: un solo motivo, el disco de freno. Enorme y en 3D en la portada, plano
 * detrás de cada pantalla del producto, en los botones, las viñetas y la marca del
 * cierre. Cada sección es un componente en partes/ (los estilos de una página así no
 * entran en el tope por componente de Angular, y así cada uno se lee solo).
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
  @ViewChild('barra', { static: true }) barra!: ElementRef<HTMLElement>;

  producto = PRODUCTO;
  /** Recién con el script corriendo se esconden las piezas para su entrada. */
  conScript = false;

  private quitarScroll?: () => void;

  ngOnInit() {
    // Puede quedar pintado el color de un taller de una sesión anterior en el mismo
    // navegador. Acá se muestra Motiq, no un cliente.
    this.marca.limpiar();
    this.conScript = true;
  }

  async ngAfterViewInit() {
    const el = await this.contenido?.getScrollElement();
    if (!el) return;
    // La barra se vuelve sólida apenas se baja. Se toca la clase a mano y fuera de
    // Angular: un evento de scroll no merece recorrer la página entera.
    this.zona.runOutsideAngular(() => {
      const alScroll = () => this.barra.nativeElement.classList.toggle('solida', el.scrollTop > 24);
      el.addEventListener('scroll', alScroll, { passive: true });
      this.quitarScroll = () => el.removeEventListener('scroll', alScroll);
      alScroll();
    });
    // Llegar con #contacto (o cualquier sección) desde otra pantalla, por ejemplo el
    // "escribinos" del login: el scroll vive en ion-content, así que el navegador no
    // lo resuelve solo.
    const destino = this.route.snapshot.fragment;
    if (destino) setTimeout(() => this.irA(destino), 300);
  }

  ngOnDestroy() { this.quitarScroll?.(); }

  irA(id: string) {
    const destino = document.getElementById(id);
    if (!destino || !this.contenido) return;
    // scrollIntoView no conoce el contenedor de Ionic; se calcula la posición.
    this.contenido.getScrollElement().then((el) => {
      const top = destino.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop - 72;
      const suave = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      el.scrollTo({ top, behavior: suave ? 'smooth' : 'auto' });
    });
  }
}
