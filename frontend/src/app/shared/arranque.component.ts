import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { AdminService } from '../services/admin.service';
import { ToastService } from '../services/toast.service';

interface Pasos { marca: boolean; equipo: boolean; orden: boolean; portal: boolean; }

/**
 * Los primeros pasos de un taller que acaba de registrarse.
 *
 * El problema que resuelve: alguien se da de alta y cae en un panel con todo en cero.
 * El sistema está completo y no hay nada que mirar — ni una orden, ni un cliente, ni un
 * número — así que la pantalla no dice qué hacer y la sesión termina ahí.
 *
 * Cada paso lleva DIRECTO al lugar donde se hace. Un checklist que solo enumera tareas
 * traslada el trabajo de buscarlas, que es exactamente el trabajo que sobra.
 *
 * Se calcula en el servidor a partir de los datos (ver GET /api/admin/arranque), no de
 * un progreso guardado: así no puede afirmar que algo está hecho cuando ya no lo está.
 * Desaparece sola al completarse y no vuelve.
 */
@Component({
  selector: 'app-arranque',
  standalone: false,
  template: `
    <div class="arranque" *ngIf="mostrar">
      <div class="cab">
        <div>
          <strong>Poné tu taller a andar</strong>
          <span>{{ hechos }} de 4 listos</span>
        </div>
        <ion-button fill="clear" size="small" (click)="ocultar()" aria-label="Ocultar estos pasos">
          <ion-icon slot="icon-only" name="close-outline"></ion-icon>
        </ion-button>
      </div>

      <div class="barra"><i [style.width.%]="hechos / 4 * 100"></i></div>

      <ul class="pasos">
        <li *ngFor="let p of lista" [class.hecho]="pasos && pasos[p.clave]">
          <ion-icon [name]="pasos && pasos[p.clave] ? 'checkmark-circle' : 'ellipse-outline'"></ion-icon>
          <div class="txt">
            <strong>{{ p.titulo }}</strong>
            <span>{{ p.ayuda }}</span>
          </div>
          <ion-button size="small" fill="outline" *ngIf="!(pasos && pasos[p.clave])"
                      (click)="ir(p.ruta)">{{ p.accion }}</ion-button>
        </li>
      </ul>

      <!-- El atajo para el que está evaluando: ver el sistema con datos adentro antes de
           cargar los suyos. Solo se ofrece mientras no haya ninguna orden real. -->
      <div class="ejemplo" *ngIf="!pasos?.orden || hayEjemplo">
        <span *ngIf="!hayEjemplo">¿Querés ver cómo se ve con datos cargados?</span>
        <span *ngIf="hayEjemplo">Hay datos de ejemplo cargados.</span>
        <ion-button size="small" fill="clear" [disabled]="trabajando"
                    (click)="hayEjemplo ? borrarEjemplo() : cargarEjemplo()">
          {{ hayEjemplo ? 'Borrarlos' : 'Cargar datos de ejemplo' }}
        </ion-button>
      </div>
    </div>
  `,
  styles: [`
    .arranque {
      padding: 16px; margin: 0 0 16px; border-radius: 16px;
      background: rgba(255, 255, 255, .04);
      border: 1px solid rgba(255, 255, 255, .10);
    }
    .cab { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
    .cab strong { display: block; font-size: 15px; }
    .cab span { font-size: 12.5px; opacity: .6; }
    .barra { height: 4px; border-radius: 999px; background: rgba(255,255,255,.08); margin: 10px 0 14px; overflow: hidden; }
    .barra i { display: block; height: 100%; background: var(--ion-color-primary); transition: width .3s ease; }
    .pasos { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
    .pasos li { display: flex; align-items: center; gap: 12px; }
    .pasos ion-icon { font-size: 20px; flex: 0 0 auto; opacity: .45; }
    .pasos li.hecho ion-icon { color: var(--ion-color-success, #4ade80); opacity: 1; }
    .pasos li.hecho .txt strong { text-decoration: line-through; opacity: .5; }
    .pasos li.hecho .txt span { display: none; }
    .txt { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; }
    .txt strong { font-size: 14px; font-weight: 600; }
    .txt span { font-size: 12.5px; opacity: .6; }
    .ejemplo {
      display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap;
      margin-top: 14px; padding-top: 12px; border-top: 1px solid rgba(255,255,255,.08);
      font-size: 13px; opacity: .8;
    }
  `],
})
export class ArranqueComponent implements OnInit {
  pasos: Pasos | null = null;
  completo = false;
  oculto = false;
  hayEjemplo = false;
  trabajando = false;

  // El orden importa: la marca va primera porque es lo que hace que el sistema se sienta
  // suyo, y eso cambia cómo se lee todo lo demás.
  readonly lista: { clave: keyof Pasos; titulo: string; ayuda: string; accion: string; ruta: string }[] = [
    { clave: 'marca',  titulo: 'Poné tu logo y tu color',   ayuda: 'Tus clientes ven tu marca, no la nuestra.', accion: 'Configurar', ruta: '/admin/config' },
    { clave: 'equipo', titulo: 'Sumá a tu equipo',          ayuda: 'Cada mecánico con su usuario y su agenda.', accion: 'Agregar',    ruta: '/admin/empleados' },
    { clave: 'orden',  titulo: 'Registrá tu primera orden', ayuda: 'El siguiente vehículo que entre al taller.', accion: 'Crear',     ruta: '/nueva-orden' },
    { clave: 'portal', titulo: 'Dale el portal a un cliente', ayuda: 'Que vea el avance sin llamar por teléfono.', accion: 'Ver cómo', ruta: '/admin/portal' },
  ];

  constructor(private admin: AdminService, private router: Router, private toast: ToastService) {}

  ngOnInit(): void { this.cargar(); }

  // `cargar()` es público a propósito: los pasos se completan en OTRAS páginas (config,
  // empleados, nueva orden), así que la página que contiene este componente lo vuelve a
  // pedir en su ionViewWillEnter. Ionic no dispara ese hook en los hijos, solo en la
  // página ruteada, por eso no se puede resolver acá adentro.
  cargar(): void {
    this.admin.getArranque().subscribe({
      next: r => {
        this.pasos = r.data.pasos;
        this.completo = r.data.completo;
        this.oculto = r.data.oculto;
        this.hayEjemplo = r.data.hay_ejemplo;
      },
      // Sin datos no se muestra nada. Es una ayuda, no puede ser un error en pantalla.
      error: () => { this.pasos = null; },
    });
  }

  get mostrar(): boolean { return !!this.pasos && !this.completo && !this.oculto; }

  get hechos(): number {
    return this.pasos ? Object.values(this.pasos).filter(Boolean).length : 0;
  }

  ir(ruta: string): void { this.router.navigate([ruta]); }

  ocultar(): void {
    this.oculto = true;   // se esconde ya; que el servidor lo confirme no cambia nada
    this.admin.ocultarArranque().subscribe({ error: () => {} });
  }

  cargarEjemplo(): void {
    this.trabajando = true;
    this.admin.cargarEjemplo().subscribe({
      next: r => { this.trabajando = false; this.toast.success(r.message); this.cargar(); },
      error: e => { this.trabajando = false; this.toast.error(e?.error?.error || 'No se pudieron cargar los datos de ejemplo'); },
    });
  }

  borrarEjemplo(): void {
    this.trabajando = true;
    this.admin.borrarEjemplo().subscribe({
      next: r => { this.trabajando = false; this.toast.success(r.message); this.cargar(); },
      error: e => { this.trabajando = false; this.toast.error(e?.error?.error || 'No se pudieron borrar'); },
    });
  }
}
