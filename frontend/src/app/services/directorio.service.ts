import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, shareReplay } from 'rxjs';
import { environment } from '../../environments/environment';

export interface SedeDirectorio {
  nombre: string;
  direccion: string | null;
  telefono: string | null;
  provincia: string;
  canton: string;
}

export interface TallerDirectorio {
  slug: string;
  nombre: string;
  color: string | null;
  tiene_logo: boolean;
  tipos: string[];
  sucursales: SedeDirectorio[];
}

export type Ubicaciones = Record<string, string[]>;

/** Buscador público de talleres, y el catálogo de provincias y cantones. */
@Injectable({ providedIn: 'root' })
export class DirectorioService {
  private http = inject(HttpClient);
  private url = `${environment.apiUrl}/directorio`;
  private ubicaciones$?: Observable<{ data: Ubicaciones }>;

  ubicaciones(): Observable<{ data: Ubicaciones }> {
    if (!this.ubicaciones$) {
      this.ubicaciones$ = this.http.get<{ data: Ubicaciones }>(`${this.url}/ubicaciones`).pipe(shareReplay(1));
    }
    return this.ubicaciones$;
  }

  buscar(filtros: { provincia?: string; canton?: string; q?: string }): Observable<{ data: TallerDirectorio[] }> {
    const params: Record<string, string> = {};
    if (filtros.provincia) params['provincia'] = filtros.provincia;
    if (filtros.canton) params['canton'] = filtros.canton;
    if (filtros.q?.trim()) params['q'] = filtros.q.trim();
    return this.http.get<{ data: TallerDirectorio[] }>(`${this.url}/talleres`, { params });
  }

  logoDe(slug: string): string {
    return `${environment.apiUrl}/marca/logo?taller=${encodeURIComponent(slug)}`;
  }
}
