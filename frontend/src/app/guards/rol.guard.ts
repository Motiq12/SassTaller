import { Injectable, inject } from '@angular/core';
import { ActivatedRouteSnapshot, CanActivate, Router, UrlTree } from '@angular/router';
import { AuthService } from '../services/auth.service';

// Restringe una ruta a un conjunto explícito de roles (route.data.roles).
// Si el usuario no califica, lo manda a su panel propio en vez de mostrar una
// pantalla que su rol no puede usar (la API igualmente respondería 403).
@Injectable({ providedIn: 'root' })
export class RolGuard implements CanActivate {
  private auth = inject(AuthService);
  private router = inject(Router);

  canActivate(route: ActivatedRouteSnapshot): boolean | UrlTree {
    const permitidos: string[] = route.data?.['roles'] || [];
    const rol = this.auth.getUsuario()?.rol;
    if (rol && (!permitidos.length || permitidos.includes(rol))) return true;
    return this.router.parseUrl(this.home(rol));
  }

  private home(rol?: string): string {
    if (rol === 'tecnico') return '/mecanico';
    if (rol === 'recepcion') return '/recepcion';
    return '/tabs';
  }
}
