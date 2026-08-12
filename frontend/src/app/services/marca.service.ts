import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, of } from 'rxjs';
import { catchError, map, shareReplay, tap } from 'rxjs/operators';
import { environment } from '../../environments/environment';
import { TallerService } from './taller.service';
import { PRODUCTO } from '../shared/producto';

export interface Marca {
  nombre_taller: string;
  telefono: string | null;
  email: string | null;
  direccion: string | null;
  logo: string | null;            // data URL, o null si no cargaron ninguno
  color_primario: string | null;  // hex #rrggbb del taller, o null = color del sistema
  garantia_dias: number;
  metodos_pago: { valor: string; etiqueta: string }[];
}

// Identidad y valores por defecto del taller, para documentos y formularios.
// Se cachea: los usa la factura, el PDF y el cierre de orden, y cambia muy de vez en
// cuando. Si la petición falla, se responde con los valores de fábrica en vez de
// romper la pantalla — una factura sin logo se imprime igual.
//
// El nombre es neutro a propósito. Antes decía "MS Motos": la marca del taller
// original quedaba como respaldo de TODOS los talleres del SaaS, así que un taller
// de autos que no hubiera cargado su nombre imprimía facturas con el nombre de otro
// taller, competencia suya incluso.
const RESPALDO: Marca = {
  nombre_taller: 'Mi taller',
  telefono: null, email: null, direccion: null, logo: null, color_primario: null,
  garantia_dias: 30,
  metodos_pago: [
    { valor: 'efectivo', etiqueta: 'Efectivo' },
    { valor: 'sinpe', etiqueta: 'SINPE Móvil' },
    { valor: 'tarjeta', etiqueta: 'Tarjeta' },
    { valor: 'transferencia', etiqueta: 'Transferencia' },
  ],
};

@Injectable({ providedIn: 'root' })
export class MarcaService {
  private url = `${environment.apiUrl}/marca`;
  private cache$: Observable<Marca> | null = null;

  // Marca vigente para pintar la interfaz (encabezados, logo). Es un BehaviorSubject
  // y no solo el observable cacheado porque las pantallas necesitan leerla de forma
  // síncrona al renderizar, sin suscribirse.
  private actualSubject = new BehaviorSubject<Marca>(RESPALDO);
  marca$ = this.actualSubject.asObservable();

  constructor(private http: HttpClient, private taller: TallerService) {}

  get actual(): Marca { return this.actualSubject.value; }

  get(): Observable<Marca> {
    if (!this.cache$) {
      this.cache$ = this.http.get<{ data: Marca }>(this.url).pipe(
        map(r => ({ ...RESPALDO, ...r.data })),
        catchError(() => of(RESPALDO)),
        tap(m => this.aplicar(m)),
        shareReplay(1),
      );
    }
    return this.cache$;
  }

  /**
   * Marca del taller SIN sesión, para el login, el registro y la recuperación de
   * contraseña: esas pantallas se pintan antes de que exista un token, así que no
   * pueden usar la ruta autenticada. Sin esto tendrían que mostrar una marca fija.
   */
  cargarPublica(): Observable<Marca> {
    const slug = this.taller.actual();
    if (!slug) { this.aplicar(RESPALDO); return of(RESPALDO); }
    return this.http.get<{ data: Partial<Marca> }>(`${this.url}/publica`, { params: { taller: slug } }).pipe(
      map(r => ({ ...RESPALDO, ...r.data })),
      catchError(() => of(RESPALDO)),
      tap(m => this.aplicar(m)),
    );
  }

  // Tras guardar la configuración, para que la próxima lectura traiga lo nuevo.
  invalidar() { this.cache$ = null; }

  /** Fija la marca vigente y pinta su color en la interfaz. */
  aplicar(m: Marca): void {
    this.actualSubject.next({ ...RESPALDO, ...m });
    this.pintarColor(m.color_primario);
  }

  limpiar(): void {
    this.cache$ = null;
    this.actualSubject.next(RESPALDO);
    this.pintarColor(null);
  }

  /**
   * Rótulo para pantallas públicas (login, recuperar). Si el taller se resolvió por
   * subdominio se muestra SU nombre — el cliente entra al portal de su taller, no a
   * un producto. Si no se resolvió, quien llegó lo hizo a la puerta de Motiq.
   */
  get rotuloPublico(): string {
    return this.taller.actual() ? this.actual.nombre_taller : PRODUCTO.nombre;
  }

  /**
   * Iniciales del taller, para cuando no cargó logo. Se prefiere esto a un logo
   * genérico de relleno: una imagen ajena se lee como un error, y las iniciales se
   * leen como una decisión.
   */
  get iniciales(): string {
    // Se derivan del MISMO rótulo que se muestra al lado. Sacándolas de
    // nombre_taller, la pantalla de Motiq mostraba 'MT' (de 'Mi taller') junto al
    // título 'Motiq': dos identidades distintas a cinco píxeles una de otra.
    return this.rotuloPublico
      .split(/\s+/).filter(Boolean).slice(0, 2)
      .map(p => p[0]?.toUpperCase() || '')
      .join('') || 'T';
  }

  // Logo para documentos: el configurado, o null. NO se cae a un archivo de la app:
  // el que había era el de otro taller, y estamparlo en la factura de un tercero
  // sería peor que no poner ninguno.
  logoParaDocumento(m: Marca | null): string | null {
    return m?.logo || null;
  }

  /**
   * Vuelca el color del taller en las variables CSS de Ionic. Se escriben también los
   * tonos derivados: Ionic usa `shade` al presionar un botón y `tint` en los fondos
   * suaves, así que con solo el principal el botón quedaría del color nuevo pero se
   * pondría del color viejo al tocarlo.
   */
  private pintarColor(hex: string | null): void {
    const raiz = document.documentElement;
    const vars = ['--ion-color-primary', '--ion-color-primary-rgb', '--ion-color-primary-shade',
                  '--ion-color-primary-tint', '--ion-color-primary-contrast', '--ion-color-primary-contrast-rgb'];
    if (!hex || !/^#[0-9a-fA-F]{6}$/.test(hex)) {
      vars.forEach(v => raiz.style.removeProperty(v));   // vuelve al color del tema
      return;
    }
    const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
    const mezclar = (f: number) => {
      const m = (c: number) => Math.round(f < 0 ? c * (1 + f) : c + (255 - c) * f);
      return `#${[m(r), m(g), m(b)].map(c => c.toString(16).padStart(2, '0')).join('')}`;
    };
    // Luminancia percibida: decide si el texto sobre el color va en blanco o negro.
    // Un amarillo de marca con letras blancas encima es ilegible.
    const claro = (0.299 * r + 0.587 * g + 0.114 * b) > 150;

    raiz.style.setProperty('--ion-color-primary', hex);
    raiz.style.setProperty('--ion-color-primary-rgb', `${r}, ${g}, ${b}`);
    raiz.style.setProperty('--ion-color-primary-shade', mezclar(-0.15));
    raiz.style.setProperty('--ion-color-primary-tint', mezclar(0.15));
    raiz.style.setProperty('--ion-color-primary-contrast', claro ? '#000000' : '#ffffff');
    raiz.style.setProperty('--ion-color-primary-contrast-rgb', claro ? '0, 0, 0' : '255, 255, 255');
  }
}
