import { Component, NgZone, OnInit } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { filter, take } from 'rxjs/operators';
import { AccesibilidadService } from './services/accesibilidad.service';
import { PortalService } from './services/portal.service';
import { AuthService } from './services/auth.service';
import { iniciarWebVitals } from './shared/web-vitals.util';

declare global {
  interface Window { __hideBootSplash?: () => void; }
}

@Component({
  selector: 'app-root',
  templateUrl: 'app.component.html',
  styleUrls: ['app.component.scss'],
  standalone: false,
})
export class AppComponent implements OnInit {
  // Estado de conexión para el banner global "sin conexión".
  enLinea = typeof navigator !== 'undefined' ? navigator.onLine : true;

  // Dirección actual y si toca mostrar el menú lateral del portal del cliente:
  // en sus pantallas con sesión, no en las de entrar, registrarse o recuperar.
  url = '';
  navPortal = false;

  // Inyectar AccesibilidadService aplica la preferencia de tamaño de texto al arrancar.
  constructor(private zone: NgZone, private _a11y: AccesibilidadService, private router: Router, private portal: PortalService, private auth: AuthService) {
    window.addEventListener('online', () => this.zone.run(() => (this.enLinea = true)));
    window.addEventListener('offline', () => this.zone.run(() => (this.enLinea = false)));
  }

  ngOnInit() {
    // Una sesión del personal guardada de antes trae sus casillas (Equipo → Roles) tal
    // como estaban: se releen al abrir, por si administración se las cambió.
    if (this.auth.isLoggedIn() && !this.auth.isTokenExpired()) {
      this.auth.refrescarUsuario().subscribe({ error: () => {} });
    }

    this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe((e) => {
        this.url = e.urlAfterRedirects.split(/[?#]/)[0];
        this.navPortal = this.url.startsWith('/portal')
          && !/^\/portal\/(login|registro|recuperar)/.test(this.url)
          && this.portal.isLoggedIn();
      });

    // Oculta la pantalla de arranque (index.html) recién cuando termina la
    // primera navegación real (ya pasó por guards/redirects) — evita un
    // parpadeo en blanco a mitad de una redirección inicial.
    this.router.events
      .pipe(filter((e) => e instanceof NavigationEnd), take(1))
      .subscribe(() => window.__hideBootSplash?.());

    // Core Web Vitals de usuarios reales. Es la única vía para conocer el INP:
    // Lighthouse no interactúa con la página, así que en laboratorio no existe.
    iniciarWebVitals();
  }
}
