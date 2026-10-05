import { Injectable, inject } from '@angular/core';
import { HttpInterceptor, HttpRequest, HttpHandler, HttpEvent, HttpErrorResponse } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { PortalService } from '../services/portal.service';
import { MotiqService } from '../services/motiq.service';

@Injectable()
export class AuthInterceptor implements HttpInterceptor {
  private auth = inject(AuthService);
  private portal = inject(PortalService);
  private motiq = inject(MotiqService);
  private router = inject(Router);

  intercept(req: HttpRequest<any>, next: HttpHandler): Observable<HttpEvent<any>> {
    // Hay tres sesiones que pueden convivir en el mismo navegador y cada una tiene su
    // token: el personal del taller, el cliente del portal y el admin de la plataforma.
    // Se elige por la ruta a la que va la llamada — mandar el que no es sería un 403.
    const esPortal = req.url.includes('/api/portal');
    const esMotiq = req.url.includes('/api/motiq');
    const token = esPortal ? this.portal.getToken()
      : esMotiq ? this.motiq.getToken()
      : this.auth.getToken();

    const authReq = token
      ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } })
      : req;

    return next.handle(authReq).pipe(
      catchError((err: HttpErrorResponse) => {
        // No expulsar en el propio login (deja que el componente muestre el error).
        const esLogin = req.url.includes('/login');
        if (err.status === 401 && !esLogin) {
          if (esPortal) {
            this.portal.logout();
            this.router.navigate(['/portal/login']);
          } else if (esMotiq) {
            this.motiq.logout();
            this.router.navigate(['/motiq/login']);
          } else {
            this.auth.logout();
            this.router.navigate(['/login']);
          }
        }
        return throwError(() => err);
      })
    );
  }
}
