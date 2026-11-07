import { Component, EventEmitter, Input, Output } from '@angular/core';

// Hasta cuántos servicios se marcan en una cita. El mismo tope que el servidor
// (MAX_SERVICIOS_CITA en backend/src/utils/servicios-cita.js).
export const MAX_SERVICIOS_CITA = 5;

// Los servicios de una cita como casillas: el cliente marca uno o varios
// ("Cambio de aceite" y "Revisión de frenos"). Lo usan el portal, Nueva cita u orden
// y Editar cita, siempre dentro de .admin-dark (toma sus colores).
//
//   <app-elegir-servicios [servicios]="servicios" [(seleccion)]="form.servicios">
//
// Si la cita ya tenía un servicio que hoy no se ofrece (se desactivó), sale igual
// marcado: así editar la cita no se lo borra sin que nadie lo note.
@Component({
  standalone: false,
  selector: 'app-elegir-servicios',
  template: `
    <div class="es-grid" role="group" [attr.aria-label]="etiqueta">
      <label class="es-item" *ngFor="let s of opciones" [class.on]="marcado(s)" [class.bloq]="!marcado(s) && lleno">
        <input type="checkbox" [checked]="marcado(s)" [disabled]="!marcado(s) && lleno" (change)="alternar(s)">
        <span class="es-caja" aria-hidden="true"><ion-icon name="checkmark"></ion-icon></span>
        <span class="es-txt">{{ s }}</span>
      </label>
    </div>
    <p class="es-pie" aria-live="polite">
      <ng-container *ngIf="!seleccion.length">Puedes elegir varios.</ng-container>
      <ng-container *ngIf="seleccion.length === 1">Elegiste 1 servicio.</ng-container>
      <ng-container *ngIf="seleccion.length > 1">Elegiste {{ seleccion.length }} servicios.</ng-container>
      <ng-container *ngIf="lleno"> Es el máximo por cita.</ng-container>
    </p>
  `,
  styles: [`
    :host { display: block; }
    .es-grid { display: grid; grid-template-columns: 1fr; gap: 8px; }
    @media (min-width: 560px) { .es-grid { grid-template-columns: 1fr 1fr; } }
    /* :host delante para ganarle a los estilos de los formularios (.fg label pone
       mayúsculas, letra chica y display block a toda etiqueta que tenga adentro). */
    :host .es-item {
      position: relative; display: flex; align-items: center; gap: 10px; margin: 0;
      text-transform: none; letter-spacing: normal; font-weight: 400;
      min-height: 46px; padding: 10px 12px; box-sizing: border-box; cursor: pointer;
      border: 1px solid var(--bd); border-radius: 2px; background: var(--sur2); color: var(--tx);
      font-size: 14px; line-height: 1.3; transition: border-color .15s, background .15s;
    }
    :host .es-item:hover { border-color: var(--tx3); }
    :host .es-item.on { border-color: var(--cr); }
    :host .es-item.bloq { opacity: .5; cursor: not-allowed; }
    .es-item input { position: absolute; opacity: 0; width: 1px; height: 1px; margin: 0; }
    .es-item:focus-within { outline: 2px solid var(--cr); outline-offset: 2px; }
    .es-caja {
      flex: none; display: grid; place-items: center; width: 20px; height: 20px;
      border: 1.5px solid var(--tx3); border-radius: 2px; color: #fff;
    }
    .es-caja ion-icon { font-size: 15px; visibility: hidden; }
    .es-item.on .es-caja { background: var(--cr); border-color: var(--cr); }
    .es-item.on .es-caja ion-icon { visibility: visible; }
    .es-pie { margin: 6px 0 0; font-size: 12px; color: var(--tx2); }
  `],
})
export class ElegirServiciosComponent {
  @Input() servicios: string[] = [];
  @Input() seleccion: string[] = [];
  @Input() etiqueta = 'Servicios';
  @Input() max = MAX_SERVICIOS_CITA;
  @Output() seleccionChange = new EventEmitter<string[]>();

  // Los del catálogo, más los que la cita ya tenía y hoy no se ofrecen.
  get opciones(): string[] {
    const extra = (this.seleccion || []).filter(s => !this.servicios.includes(s));
    return [...this.servicios, ...extra];
  }
  get lleno(): boolean { return (this.seleccion || []).length >= this.max; }
  marcado(s: string): boolean { return (this.seleccion || []).includes(s); }

  // Se conserva el orden del catálogo: el primero es el que se toma como principal.
  alternar(s: string) {
    const actual = new Set(this.seleccion || []);
    if (actual.has(s)) actual.delete(s);
    else if (!this.lleno) actual.add(s);
    this.seleccion = this.opciones.filter(o => actual.has(o));
    this.seleccionChange.emit(this.seleccion);
  }
}

// Los servicios de una cita como lista. El servidor manda `servicios` como texto
// ("Cambio de aceite + Frenos"); las citas viejas solo traen `tipo_servicio`.
export function serviciosDeCita(c: { servicios?: string | null; tipo_servicio?: string | null } | null | undefined): string[] {
  if (c?.servicios) return c.servicios.split(' + ').map(s => s.trim()).filter(Boolean);
  return c?.tipo_servicio ? [c.tipo_servicio] : [];
}
