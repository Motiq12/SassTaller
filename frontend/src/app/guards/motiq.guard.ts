import { Injectable } from '@angular/core';
import { CanActivate, Router } from '@angular/router';
import { MotiqService } from '../services/motiq.service';

// Igual que AuthGuard y PortalGuard, pero para la sesión de la plataforma: son tres
// sesiones distintas y cada una vigila la suya. Estar logueado como admin de un
// taller no abre este panel.
@Injectable({ providedIn: 'root' })
export class MotiqGuard implements CanActivate {
  constructor(private motiq: MotiqService, private router: Router) {}

  canActivate(): boolean {
    if (this.motiq.isLoggedIn()) return true;
    this.motiq.logout();
    this.router.navigate(['/motiq/login']);
    return false;
  }
}
