import { AfterViewInit, Component, ElementRef, NgZone, OnDestroy, inject } from '@angular/core';
import type { TipoPantalla } from './pantalla.component';

interface Problema {
  nombre: string;
  pantalla: TipoPantalla;
  /** Para la pantalla de la orden: en qué etapa mostrarla. */
  etapa?: number;
  hecho: string;
  /** Cuatro palabras gigantes de fondo, en dos filas de dos. La tercera va en tinta. */
  palabras: [string, string, string, string];
}

/**
 * "Lo que deja de pasar": un carrusel de los cuatro problemas del taller, con la
 * forma de la sección "Trusted by" de Baseline. Cada problema trae cuatro palabras
 * gigantes de fondo (suben desde una máscara al cambiar), la pantalla de Motiq que lo
 * resuelve inclinada en el centro, y una tarjeta con el problema y lo que hace Motiq.
 *
 * Las palabras de fondo se desplazan apenas en sentidos opuestos con el scroll.
 */
@Component({
  selector: 'app-lp-vitrina',
  templateUrl: './vitrina.component.html',
  styleUrls: ['./vitrina.component.scss'],
  standalone: false,
})
export class VitrinaComponent implements AfterViewInit, OnDestroy {
  private zona = inject(NgZone);
  private host = inject(ElementRef<HTMLElement>);

  readonly problemas: Problema[] = [
    {
      nombre: 'Información que se pierde',
      pantalla: 'historial',
      hecho: 'Cada vehículo que entra queda con su orden: qué se le hizo, qué repuestos llevó, quién lo atendió y cuánto se cobró. Con el historial completo de cada placa.',
      palabras: ['Todo', 'queda', 'anotado', 'siempre'],
    },
    {
      nombre: 'Trabajos que se atrasan',
      pantalla: 'agenda',
      hecho: 'La agenda reparte el día por mecánico y cada orden muestra en qué etapa está. Lo atrasado se ve en el panel, no cuando el cliente llama a reclamar.',
      palabras: ['Lo', 'atrasado', 'salta', 'primero'],
    },
    {
      nombre: 'Presupuestos sin aprobar',
      pantalla: 'orden',
      etapa: 1,
      hecho: 'El presupuesto le llega al cliente a su portal y lo aprueba con un toque. La orden pasa sola a reparación y queda registrado cuándo aprobó.',
      palabras: ['Aprobado', 'con un', 'toque', 'desde casa'],
    },
    {
      nombre: 'Clientes que preguntan por WhatsApp',
      pantalla: 'portal',
      hecho: 'Tu cliente ve en su portal en qué etapa está su vehículo y cuándo puede retirarlo, y recibe un aviso por correo cuando cambia.',
      palabras: ['Menos', 'mensajes', 'más', 'trabajo'],
    },
  ];

  activo = 0;
  /** Cambia de identidad con cada diapositiva: re-crea las palabras y su revelado. */
  diapositiva: number[] = [0];

  private quitar?: () => void;

  ir(i: number) {
    const n = this.problemas.length;
    this.activo = ((i % n) + n) % n;
    this.diapositiva = [this.activo];
  }

  async ngAfterViewInit() {
    // El desplazamiento de las palabras con el scroll: una variable --p (0 a 1) con el
    // avance de la sección por la pantalla. Fuera de Angular y a un cuadro por evento.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const nodo = this.host.nativeElement as HTMLElement;
    const contenido = nodo.closest('ion-content') as (HTMLElement & { getScrollElement?: () => Promise<HTMLElement> }) | null;
    const scroll = await contenido?.getScrollElement?.();
    if (!scroll) return;
    this.zona.runOutsideAngular(() => {
      let pedido = 0;
      const medir = () => {
        pedido = 0;
        const r = nodo.getBoundingClientRect();
        const alto = window.innerHeight;
        const p = Math.min(1, Math.max(0, (alto - r.top) / (alto + r.height)));
        nodo.style.setProperty('--p', p.toFixed(3));
      };
      const alScroll = () => { if (!pedido) pedido = requestAnimationFrame(medir); };
      scroll.addEventListener('scroll', alScroll, { passive: true });
      medir();
      this.quitar = () => { scroll.removeEventListener('scroll', alScroll); cancelAnimationFrame(pedido); };
    });
  }

  ngOnDestroy() { this.quitar?.(); }
}
