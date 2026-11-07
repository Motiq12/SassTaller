import { Injectable } from '@angular/core';
import { CanActivate, Router } from '@angular/router';
import { PortalService } from '../services/portal.service';

@Injectable({ providedIn: 'root' })
export class PortalGuard implements CanActivate {
  constructor(private portal: PortalService, private router: Router) {}

  canActivate(): boolean {
    if (this.portal.isLoggedIn() && !this.portal.isTokenExpired()) return true;
    this.portal.logout();
    this.router.navigate(['/portal/login']);
    return false;
  }
}
