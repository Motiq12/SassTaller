import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, tap } from 'rxjs';
import { Capacitor } from '@capacitor/core';
import { environment } from '../../environments/environment';

// Administración del sitio web (msmotors-web) desde el panel. Ver
// backend/src/routes/web.routes.js: lo que se edita aquí no llega al público
// hasta que alguien con permiso toca "Publicar".

// Las fotos subidas desde el panel se guardan como "/api/sitio/fotos/<clave>.webp"
// (relativas, así sirven igual en el sitio y en el sistema). Para mostrarlas en el
// panel hay que ponerles delante el servidor de la API: en la web es el mismo
// origen; en la app nativa y en desarrollo, otro.
export function urlFoto(ruta: string | null | undefined): string {
  if (!ruta) return '';
  if (!ruta.startsWith('/api/')) return ruta;
  if (/^https?:/.test(environment.apiUrl)) return environment.apiUrl.replace(/\/api\/?$/, '') + ruta;
  return (Capacitor.isNativePlatform() ? (environment as any).nativeApiUrl || '' : '') + ruta;
}

export interface MotoWeb {
  id?: number;
  slug?: string;
  nombre: string;
  tipo: string;
  estado: 'nueva' | 'usada';
  precio: number | null;
  moneda: 'CRC' | 'USD';
  precio_texto?: string;
  resumen: string;
  descripcion: string;
  foto: string;
  fotos: string[];        // la primera es la principal
  foto_alt: string;
  specs: { clave: string; valor: string }[];
  stock: Record<string, number>;   // { [sucursal_id]: unidades }
  ingreso: string | null;
  visible: number | boolean;
  destacada?: boolean;     // sale en la tira "Nuevo ingreso" del inicio (modo manual)
  orden?: number;
  updated_at?: string;
}

export interface PromoWeb {
  activa: boolean;
  id?: string;
  titulo: string;
  destacado: string;
  comoParticipar: string;
  letraChica: string;
  imagen: string;
  imagenAlt: string;
  // Muestra solo la imagen, sin los textos (la que el taller diseña con todo puesto).
  soloImagen?: boolean;
  desde: string;
  hasta: string;
  verCada: 'dia' | 'sesion' | 'siempre';
  cta: { texto: string; href: string } | null;
}

export interface ResumenWeb {
  permisos: Record<string, boolean>;
  tipos: { id: string; nombre: string }[];
  sucursales: { id: number; nombre: string }[];
  pendientes: string[];
  ultima_publicacion: { fecha: string; por: string | null } | null;
  programada: { fecha: string; por?: { id: number; nombre: string } } | null;
  consultas_nuevas: number;
  seguimientos_hoy: number;
  resenas_pendientes: number;
  hosting_conectado: boolean;
  // Por qué no se puede publicar ahora (catálogo vacío o todo oculto), o null.
  motivo_no_publicar: string | null;
}

export interface DiaHorario { dia: number; activo: number | boolean; abre: string; cierra: string; }

export interface SedeNegocio {
  id: number;
  nombre: string;
  telefono: string;
  whatsapp: string;
  direccion: string;
  horarios: DiaHorario[];
  diferencias_horario?: string[];
  // Si ya se guardó un horario propio para la sede (si no, se propone el de citas).
  horario_propio?: boolean;
  // La foto de la sede en «Conoce nuestras sedes». Vacía = la que trae el sitio.
  foto: string;
  foto_alt: string;
}

// Lo que el sitio muestra hoy de cada sede, por id de sucursal.
export interface SedeDelSitio { telefono: string; whatsapp: string; direccion: string; horarios: DiaHorario[]; foto: string; foto_alt: string; }

export interface NegocioWeb {
  email: string;
  /** El único WhatsApp del sitio (todos los botones van ahí). */
  whatsapp: string;
  /** false mientras se propone el de la primera sede y no se guardó uno propio. */
  whatsapp_guardado?: boolean;
  marcas: string[];
  redes: { instagram: string; tiktok: string; facebook: string };
  sedes: SedeNegocio[];
  horario_citas?: DiaHorario[];
  guardado?: boolean;
  // Lo que el sitio muestra hoy, para traerlo al panel en vez de escribirlo.
  // `de_ejemplo`: los campos que en el sitio son de relleno (teléfonos, etc.).
  del_sitio?: {
    email: string;
    whatsapp: string;
    redes: { instagram: string; tiktok: string; facebook: string };
    sedes: Record<string, SedeDelSitio>;
    de_ejemplo: string[];
  };
}

export interface InicioWeb {
  catalogo: {
    total: number;
    visibles: number;
    calidad: Record<'sin_foto' | 'una_foto' | 'sin_precio' | 'sin_descripcion' | 'sin_datos_tecnicos', { id: number; nombre: string }[]>;
  };
  negocio_faltan: string[];
  consultas: {
    nuevas: number; hoy: number; mias: number; mes: number; cotizaciones_mes: number;
    mas_consultadas: { moto: string; n: number }[];
  } | null;
  pendientes: number;
  ultima_publicacion: { fecha: string; por: string | null } | null;
  programada: { fecha: string } | null;
  hosting_conectado: boolean;
}

export interface RespuestaRapida { titulo: string; texto: string; }

// Categoría del catálogo (Scooter, Deportiva…). `motos` dice cuántas la usan.
export interface TipoWeb { id?: string; nombre: string; motos?: number; }

// Una foto de la galería del sitio.
export interface FotoGaleria { url: string; alt: string; etiqueta: string; }
// Una oferta de la página Repuestos: la imagen que el taller hace para redes.
export interface Oferta { url: string; nombre: string; precio: string; hasta: string; }

// Preguntas frecuentes: grupos con preguntas. La respuesta se edita como un
// texto; los párrafos se separan con una línea en blanco.
export interface PreguntaFaq { p: string; r: string; }
export interface GrupoFaq { grupo: string; preguntas: PreguntaFaq[]; }

// La página «Nosotros». La historia se edita como un texto corrido y se guarda
// partida en párrafos, igual que las respuestas de las preguntas frecuentes.
export interface CifraNosotros { valor: string; etiqueta: string; }
export interface NosotrosWeb {
  titulo: string;
  historia: string[];
  cifras: CifraNosotros[];
  foto: { url: string; alt: string } | null;
  configurada: boolean;
  max_parrafos: number;
  max_cifras: number;
  // Lo que el sitio muestra hoy, para traerlo al panel en vez de escribirlo.
  // `ejemplo: false` = cifra confirmada por el taller (no se avisa como relleno).
  del_sitio: { titulo: string; historia: string[]; cifras: (CifraNosotros & { ejemplo?: boolean })[] };
}

export interface FinanciamientoWeb {
  activo: boolean;
  entidad: string;
  tasaAnual: number | null;
  primaMinima: number | null;
  plazos: number[];
  plazoInicial: number | null;
  aplicaA: 'todas' | 'nuevas';
  requisitos: { asalariado: string[]; independiente: string[] };
  nota: string;
}

export interface GrupoServicio { id?: string; nombre: string; descripcion: string; }
export interface TextoServicio { visible: boolean; grupo: string; resumen: string; incluye: string[]; cuando: string; }
export interface ServiciosWeb {
  servicios: { id: number; nombre: string }[];
  grupos: GrupoServicio[];
  textos: Record<string, TextoServicio>;
  configurado: boolean;
  max_grupos: number;
}

// Vista previa de un archivo del catálogo antes de cargarlo.
export interface FilaImportada {
  linea: number;
  nombre: string;
  error?: string;
  aviso?: string;
  resumen: { tipo: string; precio: number | null; unidades: number } | null;
}


// La tira de motos del inicio del sitio.
export interface NuevoIngresoWeb {
  activo: boolean;
  rotulo: string;
  titulo: string;
  modo: 'automatico' | 'manual';
  dias: number;
  maximo: number;
}

// El formulario de cotización: qué le pide el sitio a quien escribe.
export type EstadoCampo = 'obligatorio' | 'opcional' | 'oculto';
export interface FormularioWeb {
  titulo: string;
  intro: string;
  boton: string;
  campos: Record<string, EstadoCampo>;
  campos_disponibles?: { id: string; nombre: string; ayuda: string }[];
}

export interface ConsultaWeb {
  id: number;
  tipo: 'cotizacion' | 'contacto' | 'repuesto';
  nombre: string;
  telefono: string | null;
  email: string | null;
  moto: string | null;
  sucursal: string | null;
  mensaje: string | null;
  estado: 'nueva' | 'atendida' | 'descartada';
  notas: string | null;
  atendida_por: string | null;
  atendida_at: string | null;
  asignada_a: number | null;
  asignada_nombre: string | null;
  seguimiento: string | null;     // "AAAA-MM-DD"
  cliente_id: number | null;
  cedula: string | null;
  created_at: string;
}

export interface ResenaWeb {
  id: number;
  nombre: string;
  calificacion: number;           // 1 a 5
  comentario: string;
  estado: 'pendiente' | 'aprobada' | 'oculta';
  revisada_por: string | null;
  revisada_at: string | null;
  created_at: string;
  /** Para verificar que es cliente; no se publica. null en las de antes de pedirlo. */
  telefono: string | null;
  /** El cliente del sistema con ese teléfono (verificada), o null. */
  cliente_id: number | null;
  cliente_nombre?: string | null;
  cliente_apellido?: string | null;
  cliente_ordenes?: number;
}

export interface PublicacionWeb {
  id: number;
  nota: string | null;
  publicado_por_nombre: string | null;
  created_at: string;
  restaurable: boolean;
}

export interface EntradaHistorialWeb {
  id: number;
  usuario_nombre: string | null;
  accion: string;
  entidad: string;
  descripcion: string;
  created_at: string;
}

@Injectable({ providedIn: 'root' })
export class SitioWebService {
  private url = `${environment.apiUrl}/web`;

  // Cuántos cambios esperan publicarse, cuántas consultas del sitio están sin
  // atender y cuántas reseñas faltan por revisar: los muestra el menú lateral
  // como globos.
  private pendientesSubject = new BehaviorSubject<number>(0);
  pendientes$ = this.pendientesSubject.asObservable();
  private consultasSubject = new BehaviorSubject<number>(0);
  consultas$ = this.consultasSubject.asObservable();
  private resenasSubject = new BehaviorSubject<number>(0);
  resenas$ = this.resenasSubject.asObservable();

  constructor(private http: HttpClient) {}

  getResumen(): Observable<{ data: ResumenWeb }> {
    return this.http.get<{ data: ResumenWeb }>(`${this.url}/resumen`).pipe(
      tap(r => {
        this.pendientesSubject.next(r.data.pendientes.length);
        this.consultasSubject.next(r.data.consultas_nuevas || 0);
        this.resenasSubject.next(r.data.resenas_pendientes || 0);
      }),
    );
  }

  // Tras guardar algo, los globos del menú se refrescan solos.
  refrescarPendientes() {
    this.getResumen().subscribe({ error: () => {} });
  }

  // ── Catálogo ──

  getMotos(): Observable<{ data: MotoWeb[] }> {
    return this.http.get<{ data: MotoWeb[] }>(`${this.url}/motos`);
  }

  crearMoto(moto: MotoWeb): Observable<{ data: MotoWeb; message: string }> {
    return this.http.post<{ data: MotoWeb; message: string }>(`${this.url}/motos`, moto);
  }

  actualizarMoto(id: number, moto: MotoWeb): Observable<{ data: MotoWeb; message: string }> {
    return this.http.put<{ data: MotoWeb; message: string }>(`${this.url}/motos/${id}`, moto);
  }

  duplicarMoto(id: number): Observable<{ data: MotoWeb; message: string }> {
    return this.http.post<{ data: MotoWeb; message: string }>(`${this.url}/motos/${id}/duplicar`, {});
  }

  eliminarMoto(id: number): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(`${this.url}/motos/${id}`);
  }

  ordenarMotos(ids: number[]): Observable<{ message: string }> {
    return this.http.put<{ message: string }>(`${this.url}/motos-orden`, { ids });
  }

  subirFoto(dataUrl: string, ancho: number, alto: number): Observable<{ data: { url: string; bytes: number } }> {
    return this.http.post<{ data: { url: string; bytes: number } }>(`${this.url}/fotos`, { foto: dataUrl, ancho, alto });
  }

  // ── Promoción ──

  // `del_sitio`: la promoción de ejemplo con que se armó el sitio (apagada).
  // Las promociones del inicio, en orden de prioridad: el sitio muestra una a la
  // vez. `del_sitio`: la de ejemplo con que se armó el sitio (siempre apagada).
  getPromos(): Observable<{ data: { promos: PromoWeb[]; max: number }; del_sitio?: PromoWeb }> {
    return this.http.get<{ data: { promos: PromoWeb[]; max: number }; del_sitio?: PromoWeb }>(`${this.url}/promos`);
  }

  // Se guarda la lista entera, en el orden en que va.
  guardarPromos(promos: PromoWeb[]): Observable<{ data: { promos: PromoWeb[] }; message: string }> {
    return this.http.put<{ data: { promos: PromoWeb[] }; message: string }>(`${this.url}/promos`, { promos });
  }

  // ── Reseñas del sitio ──
  // No pasan por "Publicar": el sitio las pide en vivo, así que aprobar u
  // ocultar una se ve en ese momento.

  getResenas(estado?: string): Observable<{ data: ResenaWeb[] }> {
    return this.http.get<{ data: ResenaWeb[] }>(`${this.url}/resenas`, { params: estado ? { estado } : {} });
  }

  actualizarResena(id: number, estado: ResenaWeb['estado']): Observable<{ data: ResenaWeb }> {
    return this.http.patch<{ data: ResenaWeb }>(`${this.url}/resenas/${id}`, { estado });
  }

  eliminarResena(id: number): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(`${this.url}/resenas/${id}`);
  }

  // ── Consultas del sitio ──

  // q: buscador (nombre, teléfono, correo, cédula, moto, sede, mensaje o notas).
  getConsultas(estado?: string, q?: string): Observable<{ data: ConsultaWeb[] }> {
    const params: Record<string, string> = {};
    if (estado) params['estado'] = estado;
    if (q) params['q'] = q;
    return this.http.get<{ data: ConsultaWeb[] }>(`${this.url}/consultas`, { params });
  }

  actualizarConsulta(id: number, cambios: { estado?: string; notas?: string; asignada_a?: number | null; seguimiento?: string | null }): Observable<{ data: ConsultaWeb }> {
    return this.http.patch<{ data: ConsultaWeb }>(`${this.url}/consultas/${id}`, cambios);
  }

  getEquipo(): Observable<{ data: { id: number; nombre: string }[] }> {
    return this.http.get<{ data: { id: number; nombre: string }[] }>(`${this.url}/equipo`);
  }

  crearCliente(id: number, datos: { nombre: string; apellido: string; telefono: string; email: string; cedula: string }): Observable<{ data: { cliente_id: number; vinculado: boolean }; message: string }> {
    return this.http.post<{ data: { cliente_id: number; vinculado: boolean }; message: string }>(`${this.url}/consultas/${id}/cliente`, datos);
  }

  getRespuestas(): Observable<{ data: RespuestaRapida[] }> {
    return this.http.get<{ data: RespuestaRapida[] }>(`${this.url}/respuestas`);
  }

  guardarRespuestas(respuestas: RespuestaRapida[]): Observable<{ data: RespuestaRapida[]; message: string }> {
    return this.http.put<{ data: RespuestaRapida[]; message: string }>(`${this.url}/respuestas`, { respuestas });
  }

  // ── Galería del sitio ──

  getGaleria(): Observable<{ data: { fotos: FotoGaleria[]; maximo: number; configurada: boolean } }> {
    return this.http.get<{ data: { fotos: FotoGaleria[]; maximo: number; configurada: boolean } }>(`${this.url}/galeria`);
  }

  guardarGaleria(fotos: FotoGaleria[]): Observable<{ message: string }> {
    return this.http.put<{ message: string }>(`${this.url}/galeria`, { fotos });
  }

  traerGaleriaDelSitio(): Observable<{ data: { fotos: FotoGaleria[] }; message: string }> {
    return this.http.post<{ data: { fotos: FotoGaleria[] }; message: string }>(`${this.url}/galeria/traer-del-sitio`, {});
  }

  // ── Ofertas (página Repuestos) ──

  getOfertas(): Observable<{ data: { ofertas: Oferta[]; maximo: number; hoy: string } }> {
    return this.http.get<{ data: { ofertas: Oferta[]; maximo: number; hoy: string } }>(`${this.url}/ofertas`);
  }

  guardarOfertas(ofertas: Oferta[]): Observable<{ message: string }> {
    return this.http.put<{ message: string }>(`${this.url}/ofertas`, { ofertas });
  }

  // ── Preguntas frecuentes, financiamiento y servicios ──

  getFaq(): Observable<{ data: { grupos: GrupoFaq[]; configurada: boolean; max_grupos: number; max_preguntas: number } }> {
    return this.http.get<{ data: { grupos: GrupoFaq[]; configurada: boolean; max_grupos: number; max_preguntas: number } }>(`${this.url}/faq`);
  }

  guardarFaq(grupos: GrupoFaq[]): Observable<{ message: string }> {
    return this.http.put<{ message: string }>(`${this.url}/faq`, { grupos });
  }

  getNosotros(): Observable<{ data: NosotrosWeb }> {
    return this.http.get<{ data: NosotrosWeb }>(`${this.url}/nosotros`);
  }

  // La historia se manda como el texto tal cual se escribió; el sistema la parte
  // en párrafos y devuelve ya partida.
  guardarNosotros(n: { titulo: string; historia: string; cifras: CifraNosotros[]; foto: { url: string; alt: string } | null }): Observable<{ message: string }> {
    return this.http.put<{ message: string }>(`${this.url}/nosotros`, n);
  }

  getFinanciamiento(): Observable<{ data: FinanciamientoWeb }> {
    return this.http.get<{ data: FinanciamientoWeb }>(`${this.url}/financiamiento`);
  }

  guardarFinanciamiento(f: FinanciamientoWeb): Observable<{ data: FinanciamientoWeb; message: string }> {
    return this.http.put<{ data: FinanciamientoWeb; message: string }>(`${this.url}/financiamiento`, f);
  }

  getServicios(): Observable<{ data: ServiciosWeb }> {
    return this.http.get<{ data: ServiciosWeb }>(`${this.url}/servicios`);
  }

  guardarServicios(grupos: GrupoServicio[], textos: Record<string, TextoServicio>): Observable<{ message: string }> {
    return this.http.put<{ message: string }>(`${this.url}/servicios`, { grupos, textos });
  }

  // ── Importar el catálogo ──

  revisarImportacion(csv: string): Observable<{ data: { total: number; validas: number; sedes_reconocidas: number; filas: FilaImportada[] } }> {
    return this.http.post<{ data: { total: number; validas: number; sedes_reconocidas: number; filas: FilaImportada[] } }>(`${this.url}/motos/importar`, { csv });
  }

  importar(csv: string): Observable<{ data: { creadas: number; descartadas: number }; message: string }> {
    return this.http.post<{ data: { creadas: number; descartadas: number }; message: string }>(`${this.url}/motos/importar`, { csv, confirmar: true });
  }

  // Traen al panel lo que el sitio muestra hoy (el contenido de ejemplo con que
  // se armó), para verlo y corregirlo aquí en vez de empezar de cero.
  traerMotosDelSitio(): Observable<{ data: { creadas: number; descartadas: { nombre: string; motivo: string }[] }; message: string }> {
    return this.http.post<{ data: { creadas: number; descartadas: { nombre: string; motivo: string }[] }; message: string }>(`${this.url}/motos/traer-del-sitio`, {});
  }

  // La plantilla se baja con la sesión puesta, así que se pide como texto.
  getPlantilla(): Observable<string> {
    return this.http.get(`${this.url}/motos/plantilla`, { responseType: 'text' });
  }

  // ── Categorías del catálogo ──

  getTipos(): Observable<{ data: { tipos: TipoWeb[]; maximo: number } }> {
    return this.http.get<{ data: { tipos: TipoWeb[]; maximo: number } }>(`${this.url}/tipos`);
  }

  guardarTipos(tipos: TipoWeb[]): Observable<{ data: TipoWeb[]; message: string }> {
    return this.http.put<{ data: TipoWeb[]; message: string }>(`${this.url}/tipos`, { tipos });
  }

  // ── Tira "Nuevo ingreso" y formulario de cotización ──

  getInicioSitio(): Observable<{ data: { nuevoIngreso: NuevoIngresoWeb; destacadas: { id: number; nombre: string }[] } }> {
    return this.http.get<{ data: { nuevoIngreso: NuevoIngresoWeb; destacadas: { id: number; nombre: string }[] } }>(`${this.url}/inicio-sitio`);
  }

  guardarInicioSitio(nuevoIngreso: NuevoIngresoWeb): Observable<{ message: string }> {
    return this.http.put<{ message: string }>(`${this.url}/inicio-sitio`, { nuevoIngreso });
  }

  getFormulario(): Observable<{ data: FormularioWeb }> {
    return this.http.get<{ data: FormularioWeb }>(`${this.url}/formulario`);
  }

  guardarFormulario(f: FormularioWeb): Observable<{ data: FormularioWeb; message: string }> {
    return this.http.put<{ data: FormularioWeb; message: string }>(`${this.url}/formulario`, f);
  }

  // ── Datos del negocio e inicio ──

  getNegocio(): Observable<{ data: NegocioWeb }> {
    return this.http.get<{ data: NegocioWeb }>(`${this.url}/negocio`);
  }

  guardarNegocio(datos: { email: string; whatsapp: string; redes: NegocioWeb['redes']; marcas: string[]; sedes: Record<string, Omit<SedeNegocio, 'id' | 'nombre'>> }): Observable<{ message: string }> {
    return this.http.put<{ message: string }>(`${this.url}/negocio`, datos);
  }

  // Solo la foto de una sede, sin tocar el resto de los datos del negocio (la
  // usa la pantalla Nosotros, donde también se muestran esas fotos).
  guardarFotoSede(sucursalId: number, foto: string, fotoAlt: string): Observable<{ message: string }> {
    return this.http.put<{ message: string }>(`${this.url}/negocio/sedes/${sucursalId}/foto`, { foto, foto_alt: fotoAlt });
  }

  getInicio(): Observable<{ data: InicioWeb }> {
    return this.http.get<{ data: InicioWeb }>(`${this.url}/inicio`);
  }

  // ── Publicar ──

  publicar(): Observable<{ data: { cambios: string[]; despliegue: { ok: boolean; configurado: boolean } }; message: string }> {
    return this.http.post<{ data: { cambios: string[]; despliegue: { ok: boolean; configurado: boolean } }; message: string }>(`${this.url}/publicar`, {});
  }

  getPublicaciones(): Observable<{ data: PublicacionWeb[] }> {
    return this.http.get<{ data: PublicacionWeb[] }>(`${this.url}/publicaciones`);
  }

  restaurar(id: number): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(`${this.url}/publicaciones/${id}/restaurar`, {});
  }

  programar(fechaIso: string): Observable<{ message: string }> {
    return this.http.put<{ message: string }>(`${this.url}/programacion`, { fecha: fechaIso });
  }

  cancelarProgramacion(): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(`${this.url}/programacion`);
  }

  getHistorial(limite = 50): Observable<{ data: EntradaHistorialWeb[] }> {
    return this.http.get<{ data: EntradaHistorialWeb[] }>(`${this.url}/historial`, { params: { limite } });
  }
}
