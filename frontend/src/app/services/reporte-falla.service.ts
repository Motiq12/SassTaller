import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

/**
 * "Algo no funciona" — del personal de un taller hacia Motiq. Al revés de
 * AvisoSistemaService (Motiq hacia el personal).
 */
@Injectable({ providedIn: 'root' })
export class ReporteFallaService {
  private http = inject(HttpClient);

  private apiUrl = environment.apiUrl;

  enviar(descripcion: string, pantalla: string): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(`${this.apiUrl}/reportes`, { descripcion, pantalla });
  }
}
