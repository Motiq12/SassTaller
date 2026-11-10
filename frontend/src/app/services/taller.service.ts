import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Capacitor } from '@capacitor/core';
import { Observable, shareReplay } from 'rxjs';
import { environment } from '../../environments/environment';

const TALLER_KEY = 'tallerms_taller';

// Subdominios que no identifican a un taller (infraestructura).
const NO_SON_TALLER = new Set(['www', 'api', 'app', 'localhost']);
// Dominios del hosting: su primera parte es un identificador de Railway, no un taller.
const DOMINIOS_DE_PLATAFORMA = ['.railway.app'];

export interface DisponibilidadSlug {
  slug: string;
  disponible: boolean;
  motivo: string | null;
}

// Campo propio de un tipo de vehículo (cilindrada de una moto, puertas de un auto).
// La definición viene del servidor: si el frontend tuviera su propia copia, agregar
// un tipo obligaría a tocar los dos lados y el formulario podría pedir un dato que
// el servidor descarta sin avisar.
export interface CampoTipo {
  clave: string;
  etiqueta: string;
  tipo: 'numero' | 'opcion' | 'texto';
  opciones?: string[];
  min?: number;
  max?: number;
}

/** Topes de un plan; `null` = sin límite. */
export interface LimitesPlan {
  usuarios: number | null;
  sucursales: number | null;
  marca_propia: boolean;
  reportes_dias: number | null;
  precio_mensual: number | null;
}
export interface PlanesPublicos {
  dias_prueba: number;
  trial: LimitesPlan;
  gratis: LimitesPlan;
  pro: LimitesPlan;
}

export interface TipoVehiculo {
  clave: string;
  etiqueta: string;
  plural: string;
  unidadUso: string;
  campos: CampoTipo[];
}

/**
 * Resuelve a QUÉ TALLER pertenece esta sesión.
 *
 * Con multi-tenant el correo dejó de identificar a una persona sola: el mismo
 * correo puede existir en dos talleres. El backend necesita saber cuál, y hay
 * dos formas de averiguarlo:
 *
 *  1. El subdominio (msmotors.tuapp.com) — es la vía normal en web.
 *  2. Un valor guardado, para cuando no hay subdominio: la app nativa, o el
 *     desarrollo en localhost.
 *
 * Si no se puede resolver, se devuelve null y el backend decide: para el login
 * de personal eso todavía funciona (resuelve por contraseña y, si el correo está
 * en varios talleres, pide elegir); para el portal público es obligatorio.
 */
@Injectable({ providedIn: 'root' })
export class TallerService {
  private http = inject(HttpClient);

  private apiUrl = environment.apiUrl;
  private guardado: string | null = null;

  constructor() {
    try { this.guardado = localStorage.getItem(TALLER_KEY); } catch { this.guardado = null; }
    this.tomarDeLaUrl();
  }

  /**
   * `?taller=slug` en la dirección: es lo que hace que un link compartido funcione.
   *
   * Sin esto, el link que el taller le manda a su cliente por WhatsApp no resuelve a
   * ningún taller: hoy todavía no hay un subdominio por cliente (todos viven en el
   * mismo dominio) y el visitante nuevo no tiene nada guardado, así que el portal se
   * abriría sin saber de quién es. Se guarda al entrar porque el parámetro desaparece
   * en cuanto la aplicación navega a otra ruta.
   *
   * Pisa lo guardado a propósito: si alguien ya visitó otro taller en ese navegador, el
   * link que acaba de abrir es una intención más nueva y más explícita que esa memoria.
   */
  private tomarDeLaUrl(): void {
    try {
      const slug = new URLSearchParams(window.location.search).get('taller');
      // El mismo formato que valida el servidor al registrar (ver utils/onboarding).
      if (slug && /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(slug)) this.fijar(slug);
    } catch { /* sin window (SSR/pruebas) o URL rara: se sigue con lo que haya */ }
  }

  // Slug del subdominio, o null si no hay uno utilizable.
  //
  // Un subdominio de taller tiene al menos TRES partes (msmotors.motiq12.com). Antes
  // bastaba con un punto, así que el dominio del producto, motiq12.com, se leía como
  // el taller "motiq12": la landing pedía la marca de un taller inexistente y a cada
  // visitante le saltaba "Taller no encontrado o inactivo". La misma regla vive en el
  // backend (middleware/tenant-publico.js), con tests: si cambia acá, cambia allá.
  private delSubdominio(): string | null {
    if (Capacitor.isNativePlatform()) return null;   // la app nativa no tiene host propio
    const host = (window.location.hostname || '').toLowerCase();
    if (!host || /^[\d.]+$/.test(host) || host.includes(':')) return null;   // IPv4 / IPv6
    if (DOMINIOS_DE_PLATAFORMA.some((d) => host.endsWith(d))) return null;
    const partes = host.split('.');
    if (partes.length < 3) return null;              // localhost, motiq12.com
    return NO_SON_TALLER.has(partes[0]) ? null : partes[0];
  }

  /** El taller actual: primero el subdominio, si no el guardado. null si no hay. */
  actual(): string | null {
    return this.delSubdominio() || this.guardado;
  }

  /** El taller del subdominio, si se entró por uno. Ahí la sesión se acota a ese taller. */
  deSubdominio(): string | null {
    return this.delSubdominio();
  }

  /** Fija el taller elegido (login sin subdominio, o al crear uno nuevo). */
  fijar(slug: string): void {
    this.guardado = slug;
    try { localStorage.setItem(TALLER_KEY, slug); } catch { /* modo privado: queda solo en memoria */ }
  }

  limpiar(): void {
    this.guardado = null;
    try { localStorage.removeItem(TALLER_KEY); } catch { /* nada que limpiar */ }
  }

  /**
   * Agrega `taller` a un cuerpo de petición, solo si se pudo resolver. No se manda
   * la clave en null a propósito: el backend distingue "no vino" (resolvé como
   * puedas) de un valor vacío, que trataría como taller inexistente.
   */
  conTaller<T extends object>(cuerpo: T): T & { taller?: string } {
    const slug = this.actual();
    return slug ? { ...cuerpo, taller: slug } : cuerpo;
  }

  /** ¿Está libre este identificador? Para validar en vivo el registro de talleres. */
  disponible(slug: string): Observable<{ data: DisponibilidadSlug }> {
    return this.http.get<{ data: DisponibilidadSlug }>(
      `${this.apiUrl}/onboarding/disponible`, { params: { slug } }
    );
  }

  /**
   * Tipos de vehículo que ofrece el sistema, con sus campos propios. Se cachea:
   * es un catálogo fijo que no cambia entre pantallas, y lo consultan tanto el
   * alta del taller como el formulario de vehículo.
   */
  /**
   * Los planes como rigen hoy (topes y precio), los mismos que aplica el servidor en
   * utils/limites.js. Los usa la landing para no prometer otra cosa que el sistema.
   */
  planes(): Observable<{ data: PlanesPublicos }> {
    if (!this.planesCache) {
      this.planesCache = this.http
        .get<{ data: PlanesPublicos }>(`${this.apiUrl}/onboarding/planes`)
        .pipe(shareReplay(1));
    }
    return this.planesCache;
  }
  private planesCache: Observable<{ data: PlanesPublicos }> | null = null;

  tipos(): Observable<{ data: TipoVehiculo[] }> {
    if (!this.tiposCache) {
      this.tiposCache = this.http
        .get<{ data: TipoVehiculo[] }>(`${this.apiUrl}/onboarding/tipos`)
        .pipe(shareReplay(1));
    }
    return this.tiposCache;
  }
  private tiposCache?: Observable<{ data: TipoVehiculo[] }>;

  /** Alta de un taller nuevo. Devuelve sesión de admin lista para usar. */
  registrarTaller(datos: {
    nombre: string;
    slug?: string;
    tipos: string[];
    provincia?: string;
    canton?: string;
    visible_buscador?: boolean;
    logo?: string | null;
    color_primario?: string | null;
    razon_social?: string;
    cedula_juridica?: string;
    admin: { nombre: string; email: string; password: string; telefono?: string };
    contacto?: { telefono?: string; direccion?: string };
    sucursal?: { nombre?: string };
  }): Observable<{ data: { token: string; usuario: any; taller: { id: number; nombre: string; slug: string; tipos: string[] } } }> {
    return this.http.post<{ data: { token: string; usuario: any; taller: { id: number; nombre: string; slug: string; tipos: string[] } } }>(
      `${this.apiUrl}/onboarding`, datos
    );
  }
}
