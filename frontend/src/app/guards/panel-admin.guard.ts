import { Injectable } from '@angular/core';
import { ActivatedRouteSnapshot, CanActivate, CanActivateChild, Router, RouterStateSnapshot, UrlTree } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { Usuario } from '../models/usuario.model';
import { sitioWeb } from '../sitio-web-activo';

// ¿Puede entrar a la sección "Sitio web" del panel? El admin siempre; el resto,
// si el admin le marcó al menos un permiso. Es solo para la navegación: la API
// revisa los permisos de nuevo en cada petición.
//
// El sitio web público de este SaaS no existe (no se trajo desde MS Motos) y su
// sección del panel se quitó (F-02): la bandera queda apagada de forma definitiva
// (ver sitio-web-activo.ts) y la función devuelve falso siempre. Se conserva como
// interruptor único: si el sitio vuelve, vuelve el menú y la guardia con él.
export function veSitioWeb(u: Usuario | null): boolean {
  if (!sitioWeb.activo) return false;
  if (!u) return false;
  if (u.rol === 'admin') return true;
  return Object.values(u.permisos_web || {}).some(Boolean);
}

// Guardia del panel de administración (/admin). El panel entero es del admin.
@Injectable({ providedIn: 'root' })
export class PanelAdminGuard implements CanActivate, CanActivateChild {
  constructor(private auth: AuthService, private router: Router) {}

  canActivate(_route: ActivatedRouteSnapshot, state: RouterStateSnapshot): boolean | UrlTree {
    return this.decidir(state.url);
  }

  canActivateChild(_route: ActivatedRouteSnapshot, state: RouterStateSnapshot): boolean | UrlTree {
    return this.decidir(state.url);
  }

  private decidir(url: string): boolean | UrlTree {
    const u = this.auth.getUsuario();
    const ruta = url.split('?')[0];
    // El admin pasa a todo el panel; si la dirección era de la sección web que se
    // quitó (/admin/web/...), su resumen (ya no hay pantallas del sitio a donde ir).
    if (u?.rol === 'admin') return sitioWeb.activo || !ruta.startsWith('/admin/web') ? true : this.router.parseUrl('/admin');
    // Con el sitio activo, quien administra solo la web vería únicamente esa sección.
    if (veSitioWeb(u) && (ruta === '/admin/web' || ruta.startsWith('/admin/web/'))) return true;
    if (veSitioWeb(u)) return this.router.parseUrl('/admin/web');
    return this.router.parseUrl(this.home(u?.rol));
  }

  private home(rol?: string): string {
    if (rol === 'admin') return '/admin';
    if (rol === 'tecnico') return '/mecanico';
    if (rol === 'recepcion') return '/recepcion';
    return '/login';
  }
}
