import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

/**
 * El aviso vigente de Motiq hacia el personal del taller (franja arriba de la
 * pantalla) — no confundir con MensajeriaService, que es la mensajería de un
 * taller hacia su propia gente.
 */
export interface AvisoActivo {
  id: number;
  mensaje: string;
  tipo: 'info' | 'mantenimiento' | 'urgente';
  created_at: string;
}

@Injectable({ providedIn: 'root' })
export class AvisoSistemaService {
  private http = inject(HttpClient);

  private apiUrl = environment.apiUrl;

  activo(): Observable<{ data: AvisoActivo | null }> {
    return this.http.get<{ data: AvisoActivo | null }>(`${this.apiUrl}/avisos/activo`);
  }
}
