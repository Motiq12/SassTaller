import { Component, OnInit } from '@angular/core';
import { CuentaService, Cuenta } from '../services/cuenta.service';

/**
 * En qué estado está la cuenta del taller, dicho en una línea.
 *
 * Tiene tres estados y ni uno más:
 *
 *   · Prueba con más de una semana por delante → NADA. Una franja permanente que
 *     avisa de algo que falta un mes deja de leerse a la semana, y entonces tampoco
 *     se lee el día que sí importa.
 *   · Prueba en la última semana → cuántos días quedan y qué pasa después.
 *   · Plan gratuito → qué incluye, sin dramatismo. No es un castigo ni un corte:
 *     el taller sigue trabajando igual y eso tiene que quedar claro en el texto.
 *
 * No hay franja de "estás en Pro": felicitar a alguien por pagar, todos los días, en
 * la parte de arriba de su pantalla de trabajo, es ruido.
 */
@Component({
  selector: 'app-cuenta-franja',
  standalone: false,
  template: `
    <div class="franja" *ngIf="visible" [class.gratis]="cuenta?.plan === 'gratis'">
      <ion-icon [name]="cuenta?.plan === 'gratis' ? 'information-circle-outline' : 'time-outline'"></ion-icon>
      <div class="texto">
        <strong>{{ titulo }}</strong>
        <span>{{ detalle }}</span>
      </div>
      <!-- Abre la landing, donde está el formulario de contacto. En una pestaña nueva
           para no sacar a nadie del trabajo que está haciendo. -->
      <a class="accion" href="/" target="_blank" rel="noopener">
        {{ cuenta?.plan === 'gratis' ? 'Pasar a Pro' : 'Hablemos' }}
      </a>
    </div>
  `,
  styles: [`
    .franja {
      display: flex; align-items: center; gap: 12px;
      padding: 12px 16px; margin: 0 0 16px;
      border-radius: 14px;
      background: rgba(251, 184, 52, .10);
      border: 1px solid rgba(251, 184, 52, .28);
      color: var(--ion-text-color, #fafafa);
    }
    .franja.gratis {
      background: rgba(56, 189, 248, .10);
      border-color: rgba(56, 189, 248, .28);
    }
    ion-icon { font-size: 22px; flex: 0 0 auto; opacity: .9; }
    .texto { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1 1 auto; }
    .texto strong { font-size: 14px; }
    .texto span { font-size: 13px; opacity: .75; }
    .accion {
      flex: 0 0 auto; font-size: 13px; font-weight: 600;
      text-decoration: none; color: inherit;
      padding: 7px 14px; border-radius: 999px;
      border: 1px solid currentColor; opacity: .85;
    }
    .accion:hover { opacity: 1; }
    /* En un teléfono la fila de tres columnas deja el texto en dos palabras por línea. */
    @media (max-width: 560px) {
      .franja { flex-wrap: wrap; }
      .accion { width: 100%; text-align: center; }
    }
  `],
})
export class CuentaFranjaComponent implements OnInit {
  cuenta: Cuenta | null = null;

  constructor(private cuentaSvc: CuentaService) {}

  ngOnInit(): void {
    this.cuentaSvc.cuenta$.subscribe(c => { this.cuenta = c; });
    // Si nadie la cargó todavía (entrada directa a una ruta interna), se pide acá.
    if (!this.cuentaSvc.actual) this.cuentaSvc.cargar().subscribe();
  }

  get visible(): boolean { return this.cuentaSvc.hayQueAvisar; }

  get titulo(): string {
    if (this.cuenta?.plan === 'gratis') return 'Estás en el plan gratuito';
    const d = this.cuenta?.dias_restantes ?? 0;
    if (d <= 0) return 'Tu prueba termina hoy';
    return `Te ${d === 1 ? 'queda' : 'quedan'} ${d} ${d === 1 ? 'día' : 'días'} de prueba`;
  }

  get detalle(): string {
    const l = this.cuenta?.limites;
    if (this.cuenta?.plan === 'gratis') {
      const u = l?.usuarios ?? 2;
      const s = l?.sucursales ?? 1;
      return `Incluye ${s === 1 ? 'una sucursal' : s + ' sucursales'} y hasta ${u} usuarios. Tus datos y tus órdenes siguen sin límite.`;
    }
    return 'Después seguís trabajando igual, con el plan gratuito. No se borra nada.';
  }
}
