import { Component, Input } from '@angular/core';
import { Router } from '@angular/router';
import { PortalService } from '../services/portal.service';
import { MarcaService } from '../services/marca.service';
import { SITIO_WEB_URL } from './volver-web.component';
import { sitioWeb } from '../sitio-web-activo';

// Menú lateral del portal del cliente en pantallas anchas (desde 992 px). En
// celular no se ve: ahí se navega con la barra de pestañas de abajo, que en
// pantallas anchas se esconde (ver "Portal en escritorio" en global.scss).
//
// Vive en app.component y no dentro de las pestañas porque el detalle de una
// cita, el historial de una moto y las notificaciones son pantallas aparte: así
// el menú se queda fijo también en ellas, sin tocar las rutas.
//
// Usa las mismas piezas del menú del panel (global.scss: .sb-logo, .nav-item y
// .sb-user dentro de .admin-dark): el cliente ve el mismo diseño que el taller.
@Component({
  standalone: false,
  selector: 'app-portal-nav',
  template: `
    <nav class="admin-dark pn" aria-label="Menú del portal">
      <a class="sb-logo pn-marca" routerLink="/portal/inicio" routerDirection="root"
         [attr.aria-label]="marca.rotuloPublico + ', inicio'">
        <!-- Antes el logo de MS Motos a fuego, y el aria-label también lo nombraba:
             el cliente de cualquier taller leía la marca de otra empresa. -->
        <div class="sb-marca">
          <app-marca-logo [tamano]="34"></app-marca-logo>
          <h1>{{ marca.rotuloPublico }}</h1>
        </div>
        <span class="sb-rotulo">Mi taller</span>
      </a>

      <div class="sb-nav pn-lista">
        <a class="nav-item sb-suelto" *ngFor="let e of enlaces" [routerLink]="e.ruta" routerDirection="root"
           [class.on]="activo === e.id" [attr.aria-current]="activo === e.id ? 'page' : null">
          <ion-icon [name]="e.icono" aria-hidden="true"></ion-icon>{{ e.texto }}
        </a>

        <div class="pn-pie">
          <a class="nav-item sb-suelto" *ngIf="sitioWebActivo" [href]="sitioWeb">
            <ion-icon name="globe-outline" aria-hidden="true"></ion-icon>Volver al sitio web
          </a>
          <a class="nav-item sb-suelto" routerLink="/portal/notificaciones" routerDirection="root"
             [class.on]="activo === 'notificaciones'" [attr.aria-current]="activo === 'notificaciones' ? 'page' : null">
            <ion-icon name="notifications-outline" aria-hidden="true"></ion-icon>Notificaciones
            <span class="nav-badge" *ngIf="(portal.noLeidas$ | async) as n" [attr.aria-label]="n + ' sin leer'">{{ n > 9 ? '9+' : n }}</span>
          </a>
        </div>
      </div>

      <div class="sb-user" *ngIf="(portal.cliente$ | async) as c">
        <a class="sb-perfil" routerLink="/portal/perfil" routerDirection="root" [class.on]="activo === 'perfil'"
           [attr.aria-current]="activo === 'perfil' ? 'page' : null" title="Mi perfil">
          <div class="sb-av"><img *ngIf="c.foto; else inicial" [src]="c.foto" alt="" /><ng-template #inicial>{{ (c.nombre || '?').charAt(0) }}</ng-template></div>
          <div class="sb-info"><strong>{{ c.nombre }} {{ c.apellido }}</strong><span>Mi perfil</span></div>
          <ion-icon name="chevron-forward" class="sb-perfil-chev" aria-hidden="true"></ion-icon>
        </a>
        <button type="button" class="sb-logout" (click)="salir()" title="Cerrar sesión" aria-label="Cerrar sesión"><ion-icon name="log-out-outline"></ion-icon></button>
      </div>
    </nav>
  `,
  styles: [`
    /* Sin display aqui: lo pone global.scss, que es quien lo esconde en celular. */
    :host { height: 100%; }
    .pn {
      display: flex; flex-direction: column; height: 100%; overflow-y: auto;
      padding-bottom: env(safe-area-inset-bottom, 0px);
      background: var(--adm-sur); border-right: 1px solid var(--adm-bd);
    }
    .pn-marca { display: block; text-decoration: none; }
    .pn-lista { flex: 1; display: flex; flex-direction: column; }
    .pn-pie { margin-top: auto; padding-top: 10px; border-top: 1px solid var(--adm-bd); }
  `],
})
export class PortalNavComponent {
  // La dirección actual, sin consulta ni ancla (la pasa app.component).
  @Input() url = '';

  sitioWeb = SITIO_WEB_URL;
  get sitioWebActivo(): boolean { return sitioWeb.activo; }

  enlaces = [
    { id: 'inicio', ruta: '/portal/inicio', icono: 'home-outline', texto: 'Inicio' },
    { id: 'agendar', ruta: '/portal/agendar', icono: 'add-circle-outline', texto: 'Agendar' },
    { id: 'mis-citas', ruta: '/portal/mis-citas', icono: 'clipboard-outline', texto: 'Mis citas' },
    { id: 'motos', ruta: '/portal/motos', icono: 'bicycle-outline', texto: 'Motos' },
    { id: 'ofertas', ruta: '/portal/ofertas', icono: 'pricetags-outline', texto: 'Ofertas' },
  ];

  constructor(public portal: PortalService, private router: Router, public marca: MarcaService) {}

  salir() {
    this.portal.logout();
    this.router.navigate(['/portal/login'], { replaceUrl: true });
  }

  // Qué entrada va marcada. Las pantallas de detalle marcan la sección de la
  // que salen: una cita, "Mis citas"; el historial de una moto, "Motos".
  get activo(): string {
    const u = this.url;
    if (u.startsWith('/portal/cita/')) return 'mis-citas';
    if (u.startsWith('/portal/moto/')) return 'motos';
    if (u.startsWith('/portal/legal')) return 'perfil';
    return u.split('/')[2] || 'inicio';
  }
}
