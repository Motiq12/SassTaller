import { Injectable } from '@angular/core';
import { ActivatedRouteSnapshot, CanActivate, Router, RouterStateSnapshot, UrlTree } from '@angular/router';
import { AuthService } from '../services/auth.service';

// Cada rol entra directo a su panel propio: técnico → /mecanico, recepción →
// /recepcion, admin → /admin (su dashboard). El /tabs operativo (órdenes,
// clientes, agenda) sigue accesible, pero ya no es el home del admin.
@Injectable({ providedIn: 'root' })
export class RolHomeGuard implements CanActivate {
  constructor(private auth: AuthService, private router: Router) {}

  canActivate(_route: ActivatedRouteSnapshot, state: RouterStateSnapshot): boolean | UrlTree {
    const rol = this.auth.getUsuario()?.rol;
    // La pantalla de inicio que eligió en Mi perfil, si es de su propio panel.
    const inicio = (prefijo: string) => {
      const p = this.auth.getUsuario()?.preferencias?.inicio;
      return p && p.startsWith(prefijo) ? p : null;
    };
    if (rol === 'tecnico') return this.router.parseUrl(inicio('/mecanico/') || '/mecanico');
    if (rol === 'recepcion') return this.router.parseUrl(inicio('/recepcion/') || '/recepcion');
    // Quien solo administra el sitio web no tiene nada que hacer en /tabs: con la
    // web apagada no tiene sección propia, así que cae en /admin (PanelAdminGuard
    // lo manda a donde corresponda).
    if (rol === 'contenido') return this.router.parseUrl('/admin');
    if (rol === 'admin') {
      const enIndice = state.url === '/tabs' || state.url === '/tabs/dashboard';
      return enIndice ? this.router.parseUrl(inicio('/admin/') || '/admin') : true;
    }
    return true;
  }
}
