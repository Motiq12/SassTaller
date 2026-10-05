import { Injectable, inject } from '@angular/core';
import { HttpInterceptor, HttpRequest, HttpHandler, HttpEvent, HttpErrorResponse } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { ToastService } from '../services/toast.service';

@Injectable()
export class ErrorInterceptor implements HttpInterceptor {
  private toast = inject(ToastService);

  intercept(req: HttpRequest<any>, next: HttpHandler): Observable<HttpEvent<any>> {
    return next.handle(req).pipe(
      catchError((err: HttpErrorResponse) => {
        if (err.status === 401 || err.status === 0) {
          return throwError(() => err);
        }

        const mensaje = err.error?.error || this.mensajePorCodigo(err.status);
        this.toast.error(mensaje);

        return throwError(() => err);
      })
    );
  }

  private mensajePorCodigo(status: number): string {
    if (status === 403) return 'No tenés permisos para esta acción.';
    if (status === 404) return 'El recurso no fue encontrado.';
    if (status === 409) return 'Conflicto: el registro ya existe.';
    if (status === 429) return 'Demasiadas solicitudes. Esperá un momento.';
    if (status >= 500) return 'Error en el servidor. Intentá de nuevo.';
    return 'Ocurrió un error inesperado.';
  }
}
