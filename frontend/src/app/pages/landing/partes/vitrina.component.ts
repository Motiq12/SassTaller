import { Component, ElementRef, NgZone, OnDestroy, OnInit, inject } from '@angular/core';
import type { TipoPantalla } from './pantalla.component';

interface Problema {
  nombre: string;
  pantalla: TipoPantalla;
  hecho: string;
}

/**
 * "Lo que deja de pasar": cada problema del taller con la pantalla de Motiq que lo
 * resuelve, parada delante del disco plano. Se recorren solos con un fundido lento
 * (la firma de movimiento de la página) hasta que el visitante elige uno.
 */
@Component({
  selector: 'lp-vitrina',
  templateUrl: './vitrina.component.html',
  styleUrls: ['./vitrina.component.scss'],
  standalone: false,
})
export class VitrinaComponent implements OnInit, OnDestroy {
  private zona = inject(NgZone);
  private host = inject(ElementRef<HTMLElement>);

  readonly problemas: Problema[] = [
    {
      nombre: '¿Dónde anoté ese trabajo?',
      pantalla: 'historial',
      hecho: 'Cada vehículo que entra queda con su orden: qué se le hizo, qué repuestos llevó, quién lo atendió y cuánto se cobró. Con el historial completo de cada placa.',
    },
    {
      nombre: '¿Ya está mi carro?',
      pantalla: 'portal',
      hecho: 'Tu cliente entra a su portal y lo ve solo: en qué va, qué se le encontró y cuándo lo retira. Deja de sonar el teléfono cada veinte minutos.',
    },
    {
      nombre: 'Citas que nadie olvida',
      pantalla: 'agenda',
      hecho: 'La agenda por mecánico y por sucursal, con recordatorio automático. Menos huecos en el día y menos gente que no aparece.',
    },
    {
      nombre: 'Saber cómo va el mes',
      pantalla: 'reportes',
      hecho: 'Cuánto entró, qué servicios se repiten, qué mecánico rinde y qué clientes no vuelven. Números, no impresiones.',
    },
  ];

  activo = 0;
  /** El fundido lento solo cuando cambia solo; al elegir, respuesta inmediata. */
  lento = true;

  private reloj?: ReturnType<typeof setInterval>;
  private obs?: IntersectionObserver;
  private enPantalla = false;
  private detenido = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  ngOnInit() {
    if (this.detenido || !('IntersectionObserver' in window)) return;
    this.obs = new IntersectionObserver(([e]) => { this.enPantalla = e.isIntersecting; }, { threshold: 0.35 });
    this.obs.observe(this.host.nativeElement as HTMLElement);
    this.zona.runOutsideAngular(() => {
      this.reloj = setInterval(() => {
        if (this.detenido || !this.enPantalla || document.hidden) return;
        this.zona.run(() => { this.lento = true; this.activo = (this.activo + 1) % this.problemas.length; });
      }, 6500);
    });
  }

  ngOnDestroy() {
    if (this.reloj) clearInterval(this.reloj);
    this.obs?.disconnect();
  }

  elegir(i: number) {
    this.detenido = true;      // una vez que el visitante elige, deja de cambiar solo
    this.lento = false;
    this.activo = i;
  }

  /** Flechas arriba/abajo (o izquierda/derecha en el teléfono) recorren la lista. */
  teclado(ev: KeyboardEvent, i: number) {
    const paso = ev.key === 'ArrowDown' || ev.key === 'ArrowRight' ? 1 : ev.key === 'ArrowUp' || ev.key === 'ArrowLeft' ? -1 : 0;
    if (!paso) return;
    ev.preventDefault();
    const sig = (i + paso + this.problemas.length) % this.problemas.length;
    this.elegir(sig);
    const botones = (this.host.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('.nombre');
    botones[sig]?.focus();
  }
}
