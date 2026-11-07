import { Component, OnInit } from '@angular/core';
import { PortalService } from '../../services/portal.service';

// Acceso a "Mi Perfil" y "Notificaciones" desde el encabezado de cada pantalla del portal.
// Se coloca con slot="end" en el toolbar (fuera de la barra de pestañas).
// La campana muestra un badge con el número de notificaciones no leídas.
@Component({
  standalone: false,
  selector: 'app-portal-actions',
  template: `
    <ion-buttons>
      <ion-button class="bell" [routerLink]="['/portal/notificaciones']" title="Notificaciones" aria-label="Notificaciones">
        <ion-icon slot="icon-only" name="notifications-outline"></ion-icon>
        <span class="bell-badge" *ngIf="(portal.noLeidas$ | async) as n" [hidden]="!n" aria-hidden="true">{{ n > 9 ? '9+' : n }}</span>
      </ion-button>
      <ion-button [routerLink]="['/portal/perfil']" title="Mi perfil" aria-label="Mi perfil">
        <img *ngIf="(portal.cliente$ | async)?.foto as foto; else icono" class="hdr-avatar" [src]="foto" alt="Mi perfil">
        <ng-template #icono><ion-icon slot="icon-only" name="person-circle-outline"></ion-icon></ng-template>
      </ion-button>
    </ion-buttons>
  `,
  styles: [`
    .hdr-avatar { width: 30px; height: 30px; border-radius: 50%; object-fit: cover;
      border: 1.5px solid rgba(255, 255, 255, 0.3); }
    .bell { position: relative; overflow: visible; }
    .bell-badge {
      position: absolute; top: 2px; right: 0;
      min-width: 16px; height: 16px; padding: 0 4px; box-sizing: border-box;
      display: flex; align-items: center; justify-content: center;
      font-size: 10px; font-weight: 800; line-height: 1;
      color: #fff; background: var(--ion-color-danger, #e2231a);
      border-radius: 2px; border: 1.5px solid var(--ion-toolbar-background, #fff);
      pointer-events: none;
    }
  `],
})
export class PortalActionsComponent implements OnInit {
  constructor(public portal: PortalService) {}

  // Cada vez que una pantalla con esta barra se monta, refresca el contador.
  ngOnInit() { this.portal.refrescarContador(); }
}
