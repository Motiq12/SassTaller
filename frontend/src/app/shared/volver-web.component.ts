import { Component, Input } from '@angular/core';
import { environment } from '../../environments/environment';
import { sitioWeb } from '../sitio-web-activo';

// Dirección del sitio web público. Sale de environment (sitioWebUrl): cuando el
// sitio tenga su dominio propio, se cambia ahí y nada más.
export const SITIO_WEB_URL = environment.sitioWebUrl;

// "Volver al sitio web". Quien llega al sistema desde el sitio (el botón
// "Agenda tu cita" abre el portal en la misma pestaña) necesita cómo regresar.
// Abre en la misma pestaña, igual que el camino de ida.
//
//   estilo="boton"   en los perfiles, arriba de "Cerrar sesión"
//   estilo="enlace"  al pie de entrar, registrarse y recuperar la contraseña
//
// En el menú del portal y en el del panel el enlace va escrito ahí mismo, con
// el estilo de cada menú, usando SITIO_WEB_URL.
@Component({
  standalone: false,
  selector: 'app-volver-web',
  template: `
    <a *ngIf="activo" class="vw" [class.vw--enlace]="estilo === 'enlace'" [href]="url">
      <ion-icon name="globe-outline" aria-hidden="true"></ion-icon>Volver al sitio web
    </a>
  `,
  styles: [`
    :host { display: block; }
    .vw {
      display: flex; align-items: center; justify-content: center; gap: 8px;
      width: 100%; min-height: 46px; margin: 12px 0; padding: 0 16px; box-sizing: border-box;
      border: 1.5px solid var(--hairline); border-radius: 2px;
      color: var(--ion-text-color); text-decoration: none;
      font-family: var(--font-display); font-size: 14px; font-weight: 700;
      text-transform: uppercase; letter-spacing: 0.04em;
      transition: border-color .2s, color .2s;
    }
    .vw ion-icon { font-size: 18px; }
    .vw:hover { border-color: var(--ion-color-primary); color: var(--text-accent); }

    /* Sobre la foto de la pantalla de entrada: un enlace discreto, como los
       otros dos que hay ahí ("Crear una cuenta", "¿Olvidaste tu contraseña?"). */
    .vw--enlace {
      position: relative; z-index: 1;
      width: auto; min-height: 44px; margin: 14px auto 0; padding: 0; border: none;
      color: #94a3b8;
      font-family: inherit; font-size: 13px; font-weight: 600;
      text-transform: none; letter-spacing: 0;
    }
    .vw--enlace ion-icon { font-size: 16px; }
    .vw--enlace:hover { color: #f1f5f9; }
  `],
})
export class VolverWebComponent {
  @Input() estilo: 'boton' | 'enlace' = 'boton';
  url = SITIO_WEB_URL;
  // Con el sitio web en pausa no hay a dónde volver: el enlace no sale.
  get activo(): boolean { return sitioWeb.activo; }
}
