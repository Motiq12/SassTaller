import { Component, OnInit, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { ToastController } from '@ionic/angular';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { RecepcionService } from '../../services/recepcion.service';
import { comprimirImagen } from '../../shared/utils/image.util';
import { abrirWhatsApp } from '../../shared/utils/whatsapp.util';

@Component({
  standalone: false,
  selector: 'app-recepcion-ordenes',
  templateUrl: './recepcion-ordenes.page.html',
  styleUrls: ['./recepcion-ordenes.page.scss'],
})
export class RecepcionOrdenesPage implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  vista: 'activas' | 'completadas' = 'activas';
  ordenes: any[] = [];
  cargando = true;
  subiendo = new Set<number>();

  // Filtros (client-side sobre la lista ya cargada): texto + etapa + sucursal + prioridad + sin asignar.
  busqueda = '';
  estadoFiltro = '';
  sucursalFiltro: number | '' = '';
  prioridadFiltro = '';
  sinAsignar = false;
  // Orden de la lista resultante.
  orden: 'recientes' | 'antiguas' | 'prioridad' = 'recientes';

  // Prioridades (se filtran solo las no-normales presentes).
  readonly prioridadOrden = ['urgente', 'emergencia', 'garantia'];
  readonly prioridadLabel: Record<string, string> = { urgente: 'Urgente', emergencia: 'Emergencia', garantia: 'Garantía' };
  // Peso para ordenar por prioridad (mayor = más arriba).
  readonly prioridadRank: Record<string, number> = { emergencia: 3, urgente: 2, garantia: 1, normal: 0 };

  // Etapas posibles por vista (para los chips de filtro).
  readonly chipsActivas = ['recepcion', 'diagnostico', 'esperando_aprobacion', 'esperando_repuestos', 'en_reparacion', 'lista_entrega'];
  readonly chipsCompletadas = ['entregada', 'cancelada'];

  // Fotos cargadas por orden (prefetch de las que tienen evidencia).
  fotos: Record<number, any[]> = {};
  // Nota corta opcional que la recepción agrega al mensaje del cliente.
  notas: Record<number, string> = {};

  // Flujo de estados de la OT para la barra de progreso.
  readonly flujo = ['recepcion', 'diagnostico', 'esperando_aprobacion', 'esperando_repuestos', 'en_reparacion', 'lista_entrega', 'entregada'];
  readonly estadoLabel: Record<string, string> = {
    recepcion: 'Recepción',
    diagnostico: 'Diagnóstico',
    esperando_aprobacion: 'Aprobación',
    esperando_repuestos: 'Repuestos',
    en_reparacion: 'En proceso',
    lista_entrega: 'Lista',
    entregada: 'Entregada',
    cancelada: 'Cancelada',
  };
  readonly estadoPill: Record<string, string> = {
    recepcion: 'gris',
    diagnostico: 'indigo',
    esperando_aprobacion: 'amber',
    esperando_repuestos: 'amber',
    en_reparacion: 'indigo',
    lista_entrega: 'green',
    entregada: 'gris',
    cancelada: 'gris',
  };

  constructor(private rec: RecepcionService, private router: Router, private toast: ToastController) {}

  ngOnInit() { this.cargar(); }

  // Abre el detalle completo de la orden (diagnóstico, costos, estados, tiempos).
  abrirDetalle(o: any) { this.router.navigate(['/detalle-orden', o.id]); }
  ionViewWillEnter() { this.cargar(); }

  // Al cambiar de vista cambian las etapas: se descartan los filtros.
  cambiarVista() { this.estadoFiltro = ''; this.sucursalFiltro = ''; this.prioridadFiltro = ''; this.sinAsignar = false; this.cargar(); }

  // Aplica todos los filtros activos SALVO el indicado en `omit`. Así cada grupo de
  // chips cuenta de forma coherente con el resto de filtros (los números no mienten).
  private base(omit: 'estado' | 'sucursal' | 'prioridad' | 'sinAsignar' | null): any[] {
    const q = this.busqueda.trim().toLowerCase();
    return this.ordenes.filter(o => {
      if (omit !== 'estado' && this.estadoFiltro && o.estado !== this.estadoFiltro) return false;
      if (omit !== 'sucursal' && this.sucursalFiltro && o.sucursal_id !== this.sucursalFiltro) return false;
      if (omit !== 'prioridad' && this.prioridadFiltro && o.prioridad !== this.prioridadFiltro) return false;
      if (omit !== 'sinAsignar' && this.sinAsignar && o.tecnico_nombre) return false;
      if (q) {
        const txt = `${o.numero_orden} ${o.cliente_nombre} ${o.cliente_apellido} ${o.placa || ''} ${o.marca || ''} ${o.modelo || ''}`.toLowerCase();
        if (!txt.includes(q)) return false;
      }
      return true;
    });
  }

  // Sucursales presentes en la lista cargada (chip estable; solo si hay más de una),
  // con conteo reactivo a los demás filtros.
  get sucursalesPresentes(): { id: number; nombre: string; n: number }[] {
    const fuente = this.base('sucursal');
    const map = new Map<number, string>();
    for (const o of this.ordenes) {
      if (o.sucursal_id && o.sucursal_nombre && !map.has(o.sucursal_id)) map.set(o.sucursal_id, o.sucursal_nombre);
    }
    return [...map]
      .map(([id, nombre]) => ({ id, nombre, n: fuente.filter(o => o.sucursal_id === id).length }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre));
  }
  // Prioridades no-normales presentes, con su conteo reactivo (para los chips).
  get prioridadesPresentes(): { valor: string; label: string; n: number }[] {
    const fuente = this.base('prioridad');
    return this.prioridadOrden
      .map(p => ({ valor: p, label: this.prioridadLabel[p], n: fuente.filter(o => o.prioridad === p).length }))
      .filter(p => p.n > 0);
  }
  setSucursalFiltro(id: number) { this.sucursalFiltro = this.sucursalFiltro === id ? '' : id; }
  setPrioridadFiltro(p: string) { this.prioridadFiltro = this.prioridadFiltro === p ? '' : p; }
  setSinAsignar() { this.sinAsignar = !this.sinAsignar; }

  // —— Filtros ——
  // Chips de etapa presentes (solo las que tienen órdenes bajo los demás filtros), con conteo reactivo.
  get chipsConteo(): { estado: string; label: string; n: number }[] {
    const fuente = this.vista === 'activas' ? this.chipsActivas : this.chipsCompletadas;
    const base = this.base('estado');
    return fuente
      .map(e => ({ estado: e, label: this.estadoLabel[e] || e, n: base.filter(o => o.estado === e).length }))
      .filter(c => c.n > 0);
  }
  // Total bajo los filtros no-etapa (lo que muestra el chip "Todas").
  get totalSinEtapa(): number { return this.base('estado').length; }
  // ¿Hay alguna orden sin mecánico en lo cargado? (para mostrar el chip "Sin asignar").
  get haySinAsignar(): boolean { return this.ordenes.some(o => !o.tecnico_nombre); }
  // Órdenes sin mecánico bajo los demás filtros (conteo del chip "Sin asignar").
  get sinAsignarConteo(): number { return this.base('sinAsignar').filter(o => !o.tecnico_nombre).length; }

  setEstadoFiltro(e: string) { this.estadoFiltro = this.estadoFiltro === e ? '' : e; }

  // ¿Hay algún filtro activo? (para mostrar "Limpiar").
  get hayFiltros(): boolean {
    return !!(this.busqueda.trim() || this.estadoFiltro || this.sucursalFiltro || this.prioridadFiltro || this.sinAsignar);
  }
  limpiar() {
    this.busqueda = ''; this.estadoFiltro = ''; this.sucursalFiltro = ''; this.prioridadFiltro = ''; this.sinAsignar = false;
  }

  // Lista final: filtros aplicados + orden elegido.
  get ordenesVista(): any[] {
    const arr = this.base(null);
    if (this.orden === 'antiguas') {
      arr.sort((a, b) => +new Date(a.fecha_ingreso) - +new Date(b.fecha_ingreso));
    } else if (this.orden === 'prioridad') {
      arr.sort((a, b) => (this.prioridadRank[b.prioridad] || 0) - (this.prioridadRank[a.prioridad] || 0)
        || +new Date(b.fecha_ingreso) - +new Date(a.fecha_ingreso));
    } else {
      arr.sort((a, b) => +new Date(b.fecha_ingreso) - +new Date(a.fecha_ingreso));
    }
    return arr;
  }

  cargar(ev?: any) {
    this.cargando = true;
    this.rec.getOrdenes(this.vista).pipe(takeUntil(this.destroy$)).subscribe({
      next: r => {
        this.ordenes = r.data;
        this.fotos = {};
        this.cargando = false;
        if (ev) ev.target.complete();
        // Prefetch de evidencias para mostrar los thumbnails directamente.
        r.data.filter(o => o.total_fotos > 0).forEach(o => {
          this.rec.getFotosOrden(o.id).pipe(takeUntil(this.destroy$)).subscribe({ next: f => this.fotos[o.id] = f.data });
        });
      },
      error: () => { this.cargando = false; if (ev) ev.target.complete(); },
    });
  }

  progresoPct(estado: string): number {
    if (estado === 'cancelada') return 0;
    const i = this.flujo.indexOf(estado);
    if (i < 0) return 0;
    return Math.round((i / (this.flujo.length - 1)) * 100);
  }

  // Selecciona un archivo, lo comprime y lo sube como evidencia.
  subirFoto(o: any) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      this.subiendo.add(o.id);
      try {
        const url = await comprimirImagen(file, { maxLado: 1024, calidad: 0.7 });
        this.rec.subirFoto(o.id, { url, tipo: 'avance' }).pipe(takeUntil(this.destroy$)).subscribe({
          next: r => {
            this.fotos[o.id] = [...(this.fotos[o.id] || []), r.data];
            o.total_fotos = (o.total_fotos || 0) + 1;
            this.subiendo.delete(o.id);
            this.aviso('Foto subida', 'success');
          },
          error: () => { this.subiendo.delete(o.id); this.aviso('No se pudo subir', 'danger'); },
        });
      } catch {
        this.subiendo.delete(o.id);
        this.aviso('No se pudo procesar la imagen', 'danger');
      }
    };
    input.click();
  }

  enviarAlCliente(o: any) {
    const link = `${window.location.origin}/portal`;
    const nota = (this.notas[o.id] || '').trim();
    const base = `Hola ${o.cliente_nombre}, novedad de tu ${o.marca} ${o.modelo} (orden ${o.numero_orden}).`;
    const cuerpo = nota ? ` ${nota}` : ' Te enviamos evidencias del avance.';
    const msg = `${base}${cuerpo} Revisalas en el portal: ${link}`;
    abrirWhatsApp(o.cliente_telefono, msg);
  }

  ngOnDestroy() { this.destroy$.next(); this.destroy$.complete(); }

  private async aviso(message: string, color: string) {
    const t = await this.toast.create({ message, duration: 1600, color });
    await t.present();
  }
}
