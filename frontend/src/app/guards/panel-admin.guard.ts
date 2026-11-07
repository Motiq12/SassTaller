import { Injectable } from '@angular/core';
import { ActivatedRouteSnapshot, CanActivate, CanActivateChild, Router, RouterStateSnapshot, UrlTree } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { Usuario } from '../models/usuario.model';
import { sitioWeb } from '../sitio-web-activo';

// ¿Puede entrar a la sección "Sitio web" del panel? El admin siempre; el resto,
// si el admin le marcó al menos un permiso. Es solo para la navegación: la API
// revisa los permisos de nuevo en cada petición.
export function veSitioWeb(u: Usuario | null): boolean {
  // Con el sitio web en pausa no lo ve nadie, ni el admin (ver sitio-web-activo.ts).
  if (!sitioWeb.activo) return false;
  if (!u) return false;
  if (u.rol === 'admin') return true;
  return Object.values(u.permisos_web || {}).some(Boolean);
}

// Guardia del panel de administración (/admin).
//
// El panel entero es del admin, salvo la sección "Sitio web" (/admin/web/...),
// que también la usan el rol `contenido` y cualquier empleado al que el admin
// le dio permisos sobre la web. Quien entra solo por la web ve el mismo panel,
// pero con únicamente esa sección.
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
    // Sitio web apagado: el admin que escriba la dirección vuelve a su resumen.
    if (u?.rol === 'admin') return sitioWeb.activo || !ruta.startsWith('/admin/web') ? true : this.router.parseUrl('/admin');
    if (veSitioWeb(u) && (ruta === '/admin/web' || ruta.startsWith('/admin/web/'))) return true;
    // Entró a /admin (o a otra sección) sin ser admin: si tiene la web, a la web.
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
