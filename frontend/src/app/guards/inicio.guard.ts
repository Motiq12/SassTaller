import { Injectable, inject } from '@angular/core';
import { CanActivate, Router, UrlTree } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { PortalService } from '../services/portal.service';

/**
 * Decide qué es la raíz del sitio según quién entre.
 *
 * Sin sesión, `/` es la landing de Motiq: es una dirección pública y quien llega
 * puede no saber todavía qué es esto. Antes redirigía a /tabs, que rebotaba al login
 * — o sea que la puerta de entrada del producto era un formulario de contraseña.
 *
 * Con sesión, no: al que ya es cliente se lo manda a su panel. Hacerle leer el
 * folleto de venta cada vez que abre la app sería absurdo.
 */
@Injectable({ providedIn: 'root' })
export class InicioGuard implements CanActivate {
  private auth = inject(AuthService);
  private portal = inject(PortalService);
  private router = inject(Router);

  canActivate(): boolean | UrlTree {
    if (this.auth.isLoggedIn() && !this.auth.isTokenExpired()) return this.router.parseUrl('/tabs');
    if (this.portal.isLoggedIn() && !this.portal.isTokenExpired()) return this.router.parseUrl('/portal');
    return true;
  }
}
