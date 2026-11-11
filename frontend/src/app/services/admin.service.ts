import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

// Lo que devuelve GET /api/admin/correo (services/mailer.js → estadoCorreo).
export interface EstadoCorreo {
  configurado: boolean;
  remitente: string;
  direccion: string;
  dominio: string | null;
  de_prueba: boolean;
  con_mail_from: boolean;
  verificacion: 'verificado' | 'pendiente' | 'fallido' | 'no_agregado' | 'sin_permiso' | 'error' | null;
}

// Lo que devuelve GET /api/admin/respaldos (services/respaldo.js → resumirRespaldos).
export interface EstadoRespaldos {
  estado: 'sin_configurar' | 'fallo' | 'atrasado' | 'al_dia' | 'sin_datos';
  ultimo_ok: string | null;
  configuracion: { activo: boolean; faltan: string[]; conservar: number; cifrado: boolean };
  registro: { id: number; origen: 'automatico' | 'panel'; ok: number; clave: string | null; bytes: number | null;
    tablas: number | null; filas: number | null; segundos: number | null; cifrado: number | null; error: string | null;
    created_at: string; usuario_nombre: string | null }[];
  guardados: { nombre: string; fecha: string; bytes: number; cifrado: boolean }[] | null;
  error_almacen: string | null;
}

@Injectable({ providedIn: 'root' })
export class AdminService {
  private url = `${environment.apiUrl}/admin`;
  private citasUrl = `${environment.apiUrl}/citas`;
  constructor(private http: HttpClient) {}

  // Resumen ejecutivo (KPIs + top servicios + estado de citas + ingresos por servicio).
  getResumen(): Observable<{ data: any }> {
    return this.http.get<{ data: any }>(`${this.url}/resumen`);
  }

  // Gestión de citas: reusa /api/citas con filtros (estado, búsqueda, fecha, sucursal).
  // sin_orden: solo las citas vigentes que todavía no tienen orden de trabajo.
  getCitas(filtros: { estado?: string; q?: string; fecha?: string; sucursal_id?: number | string; sin_orden?: boolean } = {}): Observable<{ data: any[] }> {
    const params: any = {};
    if (filtros.estado) params.estado = filtros.estado;
    if (filtros.sin_orden) params.sin_orden = '1';
    if (filtros.q) params.q = filtros.q;
    if (filtros.fecha) params.fecha = filtros.fecha;
    if (filtros.sucursal_id) params.sucursal_id = filtros.sucursal_id;
    return this.http.get<{ data: any[] }>(this.citasUrl, { params });
  }

  // Opiniones reales del cliente (feed de reseñas: estrellas + comentario).
  // Filtros opcionales: estrellas (1-5), empleado (tecnico_id), limit.
  getOpiniones(filtros: { estrellas?: number | null; empleado?: number | null; limit?: number } = {}):
    Observable<{ data: { opiniones: any[]; tecnicos: { id: number; nombre: string }[]; resumen: { total: number; promedio: number; bajas: number } } }> {
    const params: any = {};
    if (filtros.estrellas) params.estrellas = filtros.estrellas;
    if (filtros.empleado) params.empleado = filtros.empleado;
    if (filtros.limit) params.limit = filtros.limit;
    return this.http.get<{ data: any }>(`${this.url}/opiniones`, { params });
  }

  // Reportes analíticos por período (KPIs, serie, ingresos por servicio, rendimiento).
  getReportes(filtros: { periodo?: string; empleado?: number | null } = {}): Observable<{ data: any }> {
    const params: any = {};
    if (filtros.periodo) params.periodo = filtros.periodo;
    if (filtros.empleado) params.empleado = filtros.empleado;
    return this.http.get<{ data: any }>(`${this.url}/reportes`, { params });
  }

  // Catálogo de servicios (lo que el taller ofrece agendar).
  getServicios(): Observable<{ data: { id: number; nombre: string; activo: number; orden: number }[] }> {
    return this.http.get<{ data: any[] }>(`${this.url}/servicios`);
  }
  crearServicio(nombre: string): Observable<{ data: any }> {
    return this.http.post<{ data: any }>(`${this.url}/servicios`, { nombre });
  }
  editarServicio(id: number, nombre: string): Observable<{ data: any }> {
    return this.http.put<{ data: any }>(`${this.url}/servicios/${id}`, { nombre });
  }
  toggleServicio(id: number, activo: boolean): Observable<{ data: any }> {
    return this.http.patch<{ data: any }>(`${this.url}/servicios/${id}/activo`, { activo });
  }
  borrarServicio(id: number): Observable<any> {
    return this.http.delete(`${this.url}/servicios/${id}`);
  }

  // Asignar tareas a los mecánicos.
  getTareas(empleado?: number | null): Observable<{ data: any[] }> {
    const params: any = {};
    if (empleado) params.empleado = empleado;
    return this.http.get<{ data: any[] }>(`${this.url}/tareas`, { params });
  }
  crearTarea(t: { tecnico_id: number; titulo: string; detalle?: string; prioridad?: string; vence?: string | null }): Observable<{ data: any }> {
    return this.http.post<{ data: any }>(`${this.url}/tareas`, t);
  }
  editarTarea(id: number, t: { tecnico_id: number; titulo: string; detalle?: string; prioridad?: string; vence?: string | null }): Observable<{ data: any }> {
    return this.http.put<{ data: any }>(`${this.url}/tareas/${id}`, t);
  }
  borrarTarea(id: number): Observable<any> {
    return this.http.delete(`${this.url}/tareas/${id}`);
  }

  // Calendario: citas del mes agrupadas por día y mecánico.
  getCalendario(anio: number, mes: number): Observable<{ data: { anio: number; mes: number; celdas: any[]; tecnicos: any[] } }> {
    return this.http.get<{ data: any }>(`${this.url}/calendario`, { params: { anio, mes } as any });
  }

  // Roles del personal con sus casillas (Equipo → Roles).
  getRoles(): Observable<{ data: { roles: any[]; catalogo: any[]; bases: Record<string, string>; bases_propias?: Record<string, { ajustables: string[]; fijas: string[] }> } }> {
    return this.http.get<{ data: any }>(`${this.url}/roles`);
  }
  crearRol(r: { nombre: string; base: string; descripcion?: string; permisos: string[] }): Observable<{ data: any; message: string }> {
    return this.http.post<{ data: any; message: string }>(`${this.url}/roles`, r);
  }
  guardarRol(id: number, r: { nombre?: string; descripcion?: string; permisos: string[] }): Observable<{ data: any; message: string }> {
    return this.http.put<{ data: any; message: string }>(`${this.url}/roles/${id}`, r);
  }
  restablecerRol(id: number): Observable<{ data: any; message: string }> {
    return this.http.post<{ data: any; message: string }>(`${this.url}/roles/${id}/restablecer`, {});
  }
  eliminarRol(id: number): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(`${this.url}/roles/${id}`);
  }

  // Bloquear horario (horas o días en que no se agenda).
  getBloqueos(): Observable<{ data: any[] }> {
    return this.http.get<{ data: any[] }>(`${this.url}/bloqueos`);
  }
  crearBloqueo(b: any): Observable<{ data: any; message: string }> {
    return this.http.post<{ data: any; message: string }>(`${this.url}/bloqueos`, b);
  }
  quitarBloqueo(id: number): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(`${this.url}/bloqueos/${id}`);
  }

  // Feriados que se repiten todos los años (los bloquea la agenda).
  getFeriados(): Observable<{ data: { feriados: any[]; sugeridos: { mes: number; dia: number; nombre: string; proxima: string }[] } }> {
    return this.http.get<{ data: any }>(`${this.url}/feriados`);
  }
  crearFeriados(lista: { mes: number; dia: number; nombre: string; sucursal_id?: number | null }[]): Observable<{ data: { agregados: number }; message: string }> {
    return this.http.post<{ data: { agregados: number }; message: string }>(`${this.url}/feriados`, { lista });
  }
  quitarFeriado(id: number): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(`${this.url}/feriados/${id}`);
  }

  // Configuración del taller.
  getConfig(): Observable<{ data: any }> {
    return this.http.get<{ data: any }>(`${this.url}/configuracion`);
  }
  updateConfig(payload: any): Observable<{ data: any; message: string; aviso?: string | null }> {
    return this.http.put<{ data: any; message: string; aviso?: string | null }>(`${this.url}/configuracion`, payload);
  }
  // Correo de envío: remitente y dominio en Resend, y un correo de prueba a uno mismo.
  getCorreo(): Observable<{ data: EstadoCorreo }> {
    return this.http.get<{ data: EstadoCorreo }>(`${this.url}/correo`);
  }
  probarCorreo(): Observable<{ data: { enviado: boolean; email: string }; message: string }> {
    return this.http.post<{ data: { enviado: boolean; email: string }; message: string }>(`${this.url}/correo/prueba`, {});
  }
  // Seguridad del personal: dos pasos, último ingreso y cerrar sesiones.
  getSeguridad(): Observable<{ data: { personal: any[]; politica: { minimo: number; variedad: boolean } } }> {
    return this.http.get<{ data: any }>(`${this.url}/seguridad`);
  }
  cerrarSesiones(cual: { usuario_id: number } | { todos: true }): Observable<{ data: { cerradas: number }; message: string }> {
    return this.http.post<{ data: { cerradas: number }; message: string }>(`${this.url}/seguridad/cerrar`, cual);
  }

  // Respaldos de la base: estado y respaldar ahora.
  getRespaldos(): Observable<{ data: EstadoRespaldos }> {
    return this.http.get<{ data: EstadoRespaldos }>(`${this.url}/respaldos`);
  }
  respaldarAhora(): Observable<{ data: any; message: string }> {
    return this.http.post<{ data: any; message: string }>(`${this.url}/respaldos`, {});
  }
  updateCuenta(payload: { nombre: string; email: string }): Observable<{ data: any; message: string }> {
    return this.http.put<{ data: any; message: string }>(`${this.url}/cuenta`, payload);
  }
  updatePassword(payload: { actual: string; nueva: string }): Observable<{ message: string }> {
    return this.http.put<{ message: string }>(`${this.url}/cuenta/password`, payload);
  }
  updateFoto(foto: string | null): Observable<{ data: { foto: string | null }; message: string }> {
    return this.http.put<{ data: { foto: string | null }; message: string }>(`${this.url}/cuenta/foto`, { foto });
  }

  // Aparecer o no en el buscador público de talleres.
  setBuscador(visible: boolean): Observable<{ data: { visible: boolean }; message: string }> {
    return this.http.patch<{ data: { visible: boolean }; message: string }>(`${this.url}/buscador`, { visible });
  }

  // Sucursales (locales del taller).
  getSucursales(): Observable<{ data: any[] }> {
    return this.http.get<{ data: any[] }>(`${this.url}/sucursales`);
  }
  createSucursal(payload: { nombre: string; direccion?: string; telefono?: string; provincia?: string; canton?: string }): Observable<{ data: any; message: string }> {
    return this.http.post<{ data: any; message: string }>(`${this.url}/sucursales`, payload);
  }
  updateSucursal(id: number, payload: { nombre: string; direccion?: string; telefono?: string; provincia?: string; canton?: string }): Observable<{ data: any; message: string }> {
    return this.http.put<{ data: any; message: string }>(`${this.url}/sucursales/${id}`, payload);
  }
  toggleSucursal(id: number, activa: boolean): Observable<{ message: string }> {
    return this.http.patch<{ message: string }>(`${this.url}/sucursales/${id}/activa`, { activa });
  }

  // Primeros pasos de un taller nuevo (ver shared/arranque.component.ts).
  getArranque(): Observable<{ data: { pasos: any; completo: boolean; oculto: boolean; hay_ejemplo: boolean } }> {
    return this.http.get<{ data: any }>(`${this.url}/arranque`);
  }

  ocultarArranque(): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(`${this.url}/arranque/ocultar`, {});
  }

  cargarEjemplo(): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(`${this.url}/ejemplo`, {});
  }

  borrarEjemplo(): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(`${this.url}/ejemplo`);
  }
}
