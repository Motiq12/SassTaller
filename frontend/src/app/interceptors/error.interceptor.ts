import { Injectable } from '@angular/core';
import { HttpInterceptor, HttpRequest, HttpHandler, HttpEvent, HttpErrorResponse } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { ToastService } from '../services/toast.service';
import { marcarCampo, mensajeDeError, registrarAvisoServidor } from '../shared/errores';

// El único lugar que avisa un error del servidor (ver shared/errores.ts): un mensaje
// corto que dice qué pasó y, si el servidor dice en qué campo, salta a ese campo.
@Injectable()
export class ErrorInterceptor implements HttpInterceptor {
  // Sin conexión, cada pantalla dispara varias peticiones a la vez: un solo aviso.
  private ultimoSinConexion = 0;

  constructor(private toast: ToastService) {}

  intercept(req: HttpRequest<any>, next: HttpHandler): Observable<HttpEvent<any>> {
    return next.handle(req).pipe(
      catchError((err: HttpErrorResponse) => {
        // La sesión vencida la resuelve AuthInterceptor (vuelve a iniciar sesión).
        if (err.status === 401) return throwError(() => err);
        // No es un error: el backend pide confirmar algo (p. ej. pasar una orden a
        // reparación con repuestos sin llegar) y la pantalla muestra su propio cuadro.
        if (err.status === 409 && (Array.isArray(err.error?.talleres) || err.error?.codigo === 'requiere_confirmacion' || err.error?.requiere_confirmacion)) {
          return throwError(() => err);
        }
        if (err.status === 0) {
          if (Date.now() - this.ultimoSinConexion < 10000) return throwError(() => err);
          this.ultimoSinConexion = Date.now();
        }

        const mensaje = mensajeDeError(err);
        registrarAvisoServidor();
        this.toast.errorServidor(mensaje);
        if (typeof err.error?.campo === 'string') marcarCampo(err.error.campo, mensaje);

        return throwError(() => err);
      })
    );
  }
}
