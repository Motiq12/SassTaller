import { Injectable, inject } from '@angular/core';
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
  // Datos legales de la factura. Los trajo MS Motos; acá valen igual, con la
  // diferencia de que ahora son POR TALLER y no del único taller que había.
  razon_social: string;           // vacíos si el taller no los cargó
  cedula_juridica: string;
  nota_factura: string;
  plantillas?: { whatsapp: Record<string, string> };  // mensajes reescritos (whatsapp.util.ts)
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
  razon_social: '', cedula_juridica: '', nota_factura: '',
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
  private http = inject(HttpClient);
  private taller = inject(TallerService);

  private url = `${environment.apiUrl}/marca`;
  private cache$: Observable<Marca> | null = null;

  // Marca vigente para pintar la interfaz (encabezados, logo). Es un BehaviorSubject
  // y no solo el observable cacheado porque las pantallas necesitan leerla de forma
  // síncrona al renderizar, sin suscribirse.
  private actualSubject = new BehaviorSubject<Marca>(RESPALDO);
  marca$ = this.actualSubject.asObservable();

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
                  '--ion-color-primary-tint', '--ion-color-primary-contrast', '--ion-color-primary-contrast-rgb',
                  '--marca-tx-claro', '--marca-tx-oscuro'];
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

    // La marca usada como TEXTO (placas, montos, la fecha de hoy, los chips): casi
    // ningún color de marca se lee directo sobre el fondo de la app, así que hay
    // que corregirlo hasta pasar AA. Cuánto corregir depende del color — un
    // amarillo necesita oscurecerse un 43% y un violeta nada —, y por eso esto no
    // se puede hacer en el CSS con un `color-mix` a porcentaje fijo.
    //
    // Son dos variables, una por tema, porque esto se escribe como estilo EN LÍNEA
    // sobre :root: un solo valor pisaría el bloque de tema oscuro de variables.scss
    // y el CSS no podría elegir. Los respaldos de cada una están en variables.scss.
    raiz.style.setProperty('--marca-tx-claro', this.legibleSobreClaro([r, g, b]));
    raiz.style.setProperty('--marca-tx-oscuro', this.legibleSobreOscuro([r, g, b]));
  }

  // —— Contraste (WCAG 2.1) ——

  private static readonly BLANCO: Canal = [255, 255, 255];
  private static readonly NEGRO: Canal = [0, 0, 0];
  /** El panel oscuro: --adm-sur del bloque de tema oscuro de variables.scss. */
  private static readonly PANEL_OSCURO: Canal = [20, 23, 28];
  /** AA pide 4.5:1; se apunta un poco más arriba para no quedar al filo del redondeo. */
  private static readonly MINIMO = 4.6;

  private luminancia([r, g, b]: Canal): number {
    const lin = (c: number) => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  }

  private contraste(a: Canal, b: Canal): number {
    const [la, lb] = [this.luminancia(a), this.luminancia(b)];
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  }

  private interpolar(a: Canal, b: Canal, f: number): Canal {
    return [0, 1, 2].map(i => a[i] + (b[i] - a[i]) * f) as Canal;
  }

  private aHex(c: Canal): string {
    const n = (v: number) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0');
    return `#${n(c[0])}${n(c[1])}${n(c[2])}`;
  }

  /** Oscurece la marca hasta que se lea sobre su propio tinte claro (fondo de chip). */
  private legibleSobreClaro(marca: Canal): string {
    const fondo = this.interpolar(MarcaService.BLANCO, marca, 0.09);   // el tinte de --adm-cr-bg
    for (let f = 0; f <= 1.0001; f += 0.01) {
      const c = this.interpolar(marca, MarcaService.NEGRO, f);
      if (this.contraste(c, fondo) >= MarcaService.MINIMO) return this.aHex(c);
    }
    return '#000000';
  }

  /**
   * Aclara la marca hasta que se lea sobre el panel oscuro, SIN perder el tono:
   * primero sube los tres canales a la vez hasta que el mayor toca 255, que aclara
   * manteniendo el color. Mezclar con blanco de entrada también aclara, pero desatura
   * — un navy terminaba gris azulado y la marca se perdía. Solo si escalar no alcanza
   * (una marca negra o casi gris, donde no hay tono que conservar) se va a blanco.
   */
  private legibleSobreOscuro(marca: Canal): string {
    const panel = MarcaService.PANEL_OSCURO;
    const mayor = Math.max(...marca) || 1;
    const vivo = marca.map(c => c * 255 / mayor) as Canal;
    for (let f = 0; f <= 1.0001; f += 0.01) {
      const c = this.interpolar(marca, vivo, f);
      if (this.contraste(c, panel) >= MarcaService.MINIMO) return this.aHex(c);
    }
    for (let f = 0; f <= 1.0001; f += 0.01) {
      const c = this.interpolar(vivo, MarcaService.BLANCO, f);
      if (this.contraste(c, panel) >= MarcaService.MINIMO) return this.aHex(c);
    }
    return '#ffffff';
  }
}

/** Un color como canales RGB de 0 a 255. */
type Canal = [number, number, number];
