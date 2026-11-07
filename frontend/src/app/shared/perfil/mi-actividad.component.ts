import { Component, Input, OnDestroy, OnInit } from '@angular/core';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { ItemActividad, MiPerfilService } from '../../services/mi-perfil.service';
import { haceCuanto } from './tiempo';

const ICONO: Record<string, string> = {
  cuenta: 'person-circle-outline',
  cita: 'calendar-outline',
  orden: 'clipboard-outline',
  avance: 'construct-outline',
  garantia: 'shield-checkmark-outline',
  bloqueo: 'ban-outline',
  feriado: 'flag-outline',
  sitio: 'globe-outline',
  respaldo: 'cloud-upload-outline',
  eliminada: 'trash-outline',
};

// Lo último que hizo la persona (backend: utils/actividad.js).
@Component({
  standalone: false,
  selector: 'app-mi-actividad',
  template: `
    <div class="px">
      <div class="px-titulo">
        <ion-icon name="time-outline"></ion-icon>
        <div><strong>Mi actividad</strong><span>Lo último que hiciste en el sistema.</span></div>
      </div>

      <p class="px-vacio" *ngIf="cargando">Cargando…</p>
      <p class="px-vacio" *ngIf="error">{{ error }}</p>
      <ul class="px-lista" *ngIf="!cargando && !error">
        <li class="px-fila" *ngFor="let a of visibles">
          <ion-icon [name]="icono(a)"></ion-icon>
          <div class="px-fila-txt">
            <strong>
              <a *ngIf="a.orden_id && baseOrden; else sinEnlace" [routerLink]="[baseOrden, a.orden_id]">{{ a.texto }}</a>
              <ng-template #sinEnlace>{{ a.texto }}</ng-template>
            </strong>
            <span *ngIf="a.detalle">{{ a.detalle }}</span>
          </div>
          <span class="px-hora">{{ hace(a.fecha) }}</span>
        </li>
        <li class="px-vacio" *ngIf="!items.length">Todavía no hay nada anotado.</li>
      </ul>

      <div class="px-acciones" *ngIf="items.length > cuantos">
        <button type="button" class="px-btn" (click)="cuantos = items.length">Ver todo ({{ items.length }})</button>
      </div>
    </div>
  `,
  styleUrls: ['./perfil-extra.scss'],
})
export class MiActividadComponent implements OnInit, OnDestroy {
  // A dónde lleva una orden: el panel usa /admin/detalle-orden; los demás, /detalle-orden.
  @Input() baseOrden = '/detalle-orden';
  private destroy$ = new Subject<void>();
  items: ItemActividad[] = [];
  cuantos = 8;
  cargando = true;
  error = '';

  constructor(private perfil: MiPerfilService) {}

  ngOnInit() {
    this.perfil.actividad().pipe(takeUntil(this.destroy$)).subscribe({
      next: r => { this.items = r.data; this.cargando = false; },
      error: () => { this.cargando = false; this.error = 'No se pudo cargar la actividad.'; },
    });
  }
  ngOnDestroy() { this.destroy$.next(); this.destroy$.complete(); }

  get visibles(): ItemActividad[] { return this.items.slice(0, this.cuantos); }
  icono(a: ItemActividad): string { return ICONO[a.tipo] || 'ellipse-outline'; }
  hace(iso: string) { return haceCuanto(iso); }
}
