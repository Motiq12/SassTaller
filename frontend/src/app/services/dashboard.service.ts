import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class DashboardService {
  private url = `${environment.apiUrl}/dashboard`;
  constructor(private http: HttpClient) {}

  getResumen(): Observable<{ data: any }> {
    return this.http.get<{ data: any }>(`${this.url}/resumen`);
  }

  getTecnicos(): Observable<{ data: any[] }> {
    return this.http.get<{ data: any[] }>(`${this.url}/tecnicos`);
  }

  getTiempos(): Observable<{ data: any[] }> {
    return this.http.get<{ data: any[] }>(`${this.url}/tiempos`);
  }

  getAtrasos(): Observable<{ data: any[] }> {
    return this.http.get<{ data: any[] }>(`${this.url}/atrasos`);
  }
}
