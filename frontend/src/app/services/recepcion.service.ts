import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface ResumenRecepcion {
  citas_hoy: number;
  ordenes_activas: number;
  cotizaciones_pendientes: number;
  mecanicos_ocupados: number;
  mecanicos_totales: number;
}

@Injectable({ providedIn: 'root' })
export class RecepcionService {
  private http = inject(HttpClient);

  private url = `${environment.apiUrl}/recepcion`;

  // Inicio
  getResumen(): Observable<{ data: ResumenRecepcion }> {
    return this.http.get<{ data: ResumenRecepcion }>(`${this.url}/resumen`);
  }
  getCitasHoy(): Observable<{ data: any[] }> {
    return this.http.get<{ data: any[] }>(`${this.url}/citas-hoy`);
  }
  // Agenda: citas entre dos fechas (YYYY-MM-DD) para el calendario mensual.
  getAgenda(desde: string, hasta: string): Observable<{ data: any[] }> {
    return this.http.get<{ data: any[] }>(`${this.url}/agenda`, { params: { desde, hasta } as any });
  }
  getAlertas(): Observable<{ data: any[] }> {
    return this.http.get<{ data: any[] }>(`${this.url}/alertas`);
  }

  // Órdenes + evidencias
  getOrdenes(estado?: 'activas' | 'completadas'): Observable<{ data: any[] }> {
    const params = estado === 'completadas' ? ({ estado: 'completadas' } as any) : undefined;
    return this.http.get<{ data: any[] }>(`${this.url}/ordenes`, { params });
  }
  // Órdenes listas para entregar (para el cierre desde el mostrador).
  getListasEntrega(): Observable<{ data: any[] }> {
    return this.http.get<{ data: any[] }>(`${this.url}/ordenes`, { params: { estado: 'lista_entrega' } as any });
  }
  // Entregar (cerrar) una orden lista: registra pago + garantía y la marca entregada.
  entregarOrden(id: number, data: { metodo_pago: string; garantia_dias: number; observaciones_finales?: string }): Observable<{ message: string; cortesia_ganada: boolean }> {
    return this.http.post<{ message: string; cortesia_ganada: boolean }>(`${this.url}/ordenes/${id}/entregar`, data);
  }
  getFotosOrden(id: number): Observable<{ data: any[] }> {
    return this.http.get<{ data: any[] }>(`${this.url}/ordenes/${id}/fotos`);
  }
  subirFoto(id: number, foto: { url: string; tipo: string; descripcion?: string }): Observable<{ data: any }> {
    return this.http.post<{ data: any }>(`${this.url}/ordenes/${id}/fotos`, foto);
  }

  // Cotizaciones
  getCotizaciones(estado?: 'pendiente' | 'enviada'): Observable<{ data: any[] }> {
    const params = estado ? ({ estado } as any) : undefined;
    return this.http.get<{ data: any[] }>(`${this.url}/cotizaciones`, { params });
  }
  getRepuestos(id: number): Observable<{ data: any[] }> {
    return this.http.get<{ data: any[] }>(`${this.url}/cotizaciones/${id}/repuestos`);
  }
  addRepuesto(id: number, data: any): Observable<{ data: any }> {
    return this.http.post<{ data: any }>(`${this.url}/cotizaciones/${id}/repuestos`, data);
  }
  updateRepuesto(ordenId: number, repuestoId: number, data: any): Observable<any> {
    return this.http.put(`${this.url}/cotizaciones/${ordenId}/repuestos/${repuestoId}`, data);
  }
  deleteRepuesto(ordenId: number, repuestoId: number): Observable<any> {
    return this.http.delete(`${this.url}/cotizaciones/${ordenId}/repuestos/${repuestoId}`);
  }
  updateCostos(id: number, data: { costo_mano_obra: number; descuento: number }): Observable<any> {
    return this.http.put(`${this.url}/cotizaciones/${id}/costos`, data);
  }
  // Arma la cotización completa (técnico + piezas + costos) en una sola llamada transaccional.
  armarCotizacion(ordenId: number, data: {
    tecnico_id?: number | null;
    piezas: { nombre: string; cantidad?: number; costo_unitario: number }[];
    costo_mano_obra: number;
    descuento: number;
  }): Observable<{ data: any }> {
    return this.http.post<{ data: any }>(`${this.url}/cotizaciones/${ordenId}/armar`, data);
  }
  enviarCotizacion(id: number): Observable<any> {
    return this.http.post(`${this.url}/cotizaciones/${id}/enviar`, {});
  }
  aprobarCotizacion(id: number): Observable<any> {
    return this.http.post(`${this.url}/cotizaciones/${id}/aprobar`, {});
  }
  asignarTecnico(ordenId: number, tecnico_id: number | null): Observable<any> {
    return this.http.patch(`${this.url}/ordenes/${ordenId}/tecnico`, { tecnico_id });
  }
  getOrdenesCliente(clienteId: number): Observable<{ data: any[] }> {
    return this.http.get<{ data: any[] }>(`${this.url}/clientes/${clienteId}/ordenes`);
  }
  // Sin sucursal → todos (p. ej. mensajería interna). Con sucursal → los de esa sede + "ambas".
  getTecnicos(sucursalId?: number | null): Observable<{ data: any[] }> {
    const params: any = {};
    if (sucursalId) params.sucursal_id = sucursalId;
    return this.http.get<{ data: any[] }>(`${this.url}/tecnicos`, { params });
  }

  // ── Agendar cita manual ──
  getServicios(): Observable<{ data: string[] }> {
    return this.http.get<{ data: string[] }>(`${this.url}/servicios`);
  }
  getDisponibilidad(fecha: string, sucursalId?: number | null): Observable<{ data: { horas: string[]; max: number; ocupacion: Record<string, number> } }> {
    const params: any = { fecha };
    if (sucursalId) params.sucursal_id = sucursalId;
    return this.http.get<{ data: any }>(`${this.url}/disponibilidad`, { params });
  }
  getMotos(clienteId: number): Observable<{ data: any[] }> {
    return this.http.get<{ data: any[] }>(`${environment.apiUrl}/vehiculos`, { params: { cliente_id: clienteId } as any });
  }
  crearCita(data: { cliente_id: number; moto_id: number | null; fecha: string; hora: string; motivo: string; tipo_servicio: string | null; tecnico_id: number | null; sucursal_id?: number | null }): Observable<{ data: any }> {
    return this.http.post<{ data: any }>(`${environment.apiUrl}/citas`, data);
  }

  // ── Cliente sin cita (walk-in): sucursales activas + alta de orden directa ──
  getSucursales(): Observable<{ data: any[] }> {
    return this.http.get<{ data: any[] }>(`${this.url}/sucursales`);
  }
  crearOrden(data: { cliente_id: number; moto_id: number; problema_reportado: string; sucursal_id?: number | null; kilometraje_ingreso?: number | null; prioridad?: string }): Observable<{ data: any }> {
    return this.http.post<{ data: any }>(`${environment.apiUrl}/ordenes`, data);
  }

  // ── Perfil propio (cuenta del recepcionista) ──
  getMiPerfil(): Observable<{ data: any }> {
    return this.http.get<{ data: any }>(`${this.url}/perfil`);
  }
  updateMiPerfil(data: { nombre: string; email: string; telefono: string }): Observable<{ data: any; message: string }> {
    return this.http.put<{ data: any; message: string }>(`${this.url}/perfil`, data);
  }
  updateMiPassword(data: { actual: string; nueva: string }): Observable<{ message: string }> {
    return this.http.put<{ message: string }>(`${this.url}/perfil/password`, data);
  }
  // Foto de perfil del recepcionista (data URL base64) o null para quitarla.
  updateMiFoto(foto: string | null): Observable<{ data: { foto: string | null }; message: string }> {
    return this.http.put<{ data: { foto: string | null }; message: string }>(`${this.url}/perfil/foto`, { foto });
  }

  // Puente cita ↔ orden: crea (o recupera) la orden de trabajo de una cita.
  crearOrdenDesdeCita(citaId: number): Observable<{ data: { orden_id: number; numero_orden: string } }> {
    return this.http.post<{ data: any }>(`${this.url}/citas/${citaId}/crear-orden`, {});
  }

  // Check-in de mostrador: marca / deshace la llegada del cliente.
  marcarLlegada(citaId: number): Observable<{ data: { hora_llegada: string } }> {
    return this.http.patch<{ data: any }>(`${this.url}/citas/${citaId}/llegada`, {});
  }
  deshacerLlegada(citaId: number): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(`${this.url}/citas/${citaId}/llegada`);
  }

  // Clientes
  getClientes(q?: string): Observable<{ data: any[] }> {
    const params = q ? ({ q } as any) : undefined;
    return this.http.get<{ data: any[] }>(`${this.url}/clientes`, { params });
  }

  // Mensajes
  getAvances(): Observable<{ data: any[] }> {
    return this.http.get<{ data: any[] }>(`${this.url}/avances`);
  }
  getNotificaciones(): Observable<{ data: any[] }> {
    return this.http.get<{ data: any[] }>(`${this.url}/notificaciones`);
  }
  notificar(data: { cliente_id: number; cita_id?: number; titulo: string; mensaje: string }): Observable<any> {
    return this.http.post(`${this.url}/notificar`, data);
  }

  // Mensajería interna con los mecánicos
  getMensajesInternos(): Observable<{ data: any[] }> {
    return this.http.get<{ data: any[] }>(`${this.url}/mensajes-internos`);
  }
  getMensajesNoLeidos(): Observable<{ data: { count: number } }> {
    return this.http.get<{ data: { count: number } }>(`${this.url}/mensajes-internos/no-leidos`);
  }
  responderInterno(destino_id: number, mensaje: string, foto?: string | null, orden_id?: number | null): Observable<{ data: any }> {
    return this.http.post<{ data: any }>(`${this.url}/mensajes-internos`, { destino_id, mensaje, foto: foto || null, orden_id: orden_id || null });
  }
  broadcastMecanicos(mensaje: string, foto?: string | null): Observable<{ data: any }> {
    return this.http.post<{ data: any }>(`${this.url}/mensajes-internos/broadcast`, { mensaje, foto: foto || null });
  }
}
