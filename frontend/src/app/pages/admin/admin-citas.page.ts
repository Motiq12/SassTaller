import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { Router } from '@angular/router';
import { AlertController } from '@ionic/angular';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { AdminService } from '../../services/admin.service';
import { OrdenesService } from '../../services/ordenes.service';
import { ESTADO_CITA_LABEL } from '../../shared/utils/servicios.util';
import { ESTADO_CONFIG, EstadoOrden } from '../../models/orden.model';
import { descargarCSV, fechaCorta } from '../../shared/utils/csv.util';

@Component({
  standalone: false,
  selector: 'app-admin-citas',
  templateUrl: './admin-citas.page.html',
  styleUrls: ['./admin-citas.page.scss'],
})
export class AdminCitasPage implements OnInit, OnDestroy {
  private admin = inject(AdminService);
  private ordenSvc = inject(OrdenesService);
  private router = inject(Router);
  private alert = inject(AlertController);

  private destroy$ = new Subject<void>();
  vista: 'ordenes' | 'citas' = 'ordenes';
  citas: any[] = [];
  ordenes: any[] = [];
  sucursales: any[] = [];
  cargando = true;
  estado = '';
  estadoOrden = '';
  q = '';
  fecha = '';
  sucursalId: number | '' = '';

  readonly estadoLabel = ESTADO_CITA_LABEL;
  readonly filtrosCitas = [
    { v: '', l: 'Todas' }, { v: 'agendado', l: 'Agendadas' }, { v: 'en_revision', l: 'En revisión' },
    { v: 'en_mantenimiento', l: 'En mantenimiento' }, { v: 'listo', l: 'Listas' },
    { v: 'entregado', l: 'Entregadas' }, { v: 'cancelado', l: 'Canceladas' },
  ];
  readonly filtrosOrdenes = [
    { v: '', l: 'Todas' }, { v: 'recepcion', l: 'Recepción' }, { v: 'diagnostico', l: 'Diagnóstico' },
    { v: 'esperando_aprobacion', l: 'Aprobación' }, { v: 'esperando_repuestos', l: 'Repuestos' },
    { v: 'en_reparacion', l: 'Reparación' }, { v: 'lista_entrega', l: 'Lista' },
    { v: 'entregada', l: 'Entregada' }, { v: 'cancelada', l: 'Cancelada' },
  ];
  readonly estadoBadge: Record<string, string> = {
    agendado: 'bg-in', en_revision: 'bg-am', en_mantenimiento: 'bg-cr',
    listo: 'bg-em', entregado: 'bg-n', cancelado: 'bg-rd',
  };
  readonly ordenBadge: Record<string, string> = {
    recepcion: 'bg-cr', diagnostico: 'bg-am', esperando_aprobacion: 'bg-in',
    esperando_repuestos: 'bg-n', en_reparacion: 'bg-cr', lista_entrega: 'bg-em',
    entregada: 'bg-n', cancelada: 'bg-rd',
  };

  ordenLabel(e: string): string { return ESTADO_CONFIG[e as EstadoOrden]?.label ?? e; }

  ngOnInit() { this.cargar(); this.cargarSucursales(); }
  ionViewWillEnter() { this.cargar(); }

  cargar(ev?: any) {
    this.cargando = true;
    if (this.vista === 'citas') {
      this.admin.getCitas({ estado: this.estado, q: this.q.trim(), fecha: this.fecha, sucursal_id: this.sucursalId || undefined }).pipe(takeUntil(this.destroy$)).subscribe({
        next: r => { this.citas = r.data; this.cargando = false; if (ev) ev.target.complete(); },
        error: () => { this.cargando = false; if (ev) ev.target.complete(); },
      });
    } else {
      this.ordenSvc.getAll({ estado: this.estadoOrden || undefined } as any).pipe(takeUntil(this.destroy$)).subscribe({
        next: r => {
          let data = r.data || [];
          if (this.q.trim()) {
            const lq = this.q.trim().toLowerCase();
            data = data.filter(o => `${o.cliente_nombre} ${o.cliente_apellido} ${o.placa} ${o.numero_orden}`.toLowerCase().includes(lq));
          }
          this.ordenes = data;
          this.cargando = false;
          if (ev) ev.target.complete();
        },
        error: () => { this.cargando = false; if (ev) ev.target.complete(); },
      });
    }
  }

  cargarSucursales() {
    this.admin.getSucursales().pipe(takeUntil(this.destroy$)).subscribe({ next: r => this.sucursales = r.data || [] });
  }

  setVista(v: 'ordenes' | 'citas') { this.vista = v; this.cargar(); }
  setFiltro(v: string) { this.estado = v; this.cargar(); }
  setFiltroOrden(v: string) { this.estadoOrden = v; this.cargar(); }
  ngOnDestroy() { this.destroy$.next(); this.destroy$.complete(); }

  abrir(c: any) { if (c.orden_id) this.router.navigate(['/detalle-orden', c.orden_id]); }
  abrirOrden(o: any) { this.router.navigate(['/detalle-orden', o.id]); }

  async verDetalleCita(c: any) {
    const vehiculo = [c.marca, c.modelo].filter(Boolean).join(' ') || 'Vehiculo';
    const fecha = c.fecha ? new Date(c.fecha).toLocaleDateString('es-CR') : '—';
    const lineas = [
      `${vehiculo}${c.placa ? ' · ' + c.placa : ''}`,
      `Cliente: ${c.cliente_nombre || ''} ${c.cliente_apellido || ''}`,
      `Servicio: ${c.tipo_servicio || c.motivo || '—'}`,
      `Fecha: ${fecha} · ${c.hora?.slice(0, 5) || ''}`,
      `Mecánico: ${c.tecnico_nombre || 'Sin asignar'}`,
      `Estado: ${this.estadoLabel[c.estado] || c.estado}`,
    ];
    const al = await this.alert.create({
      cssClass: 'alert-light',
      header: `Cita #${c.id}`,
      message: lineas.join('\n'),
      buttons: ['Cerrar'],
    });
    await al.present();
  }

  exportar() {
    descargarCSV(`citas_${new Date().toISOString().slice(0, 10)}`, [
      { key: 'id', label: '#' }, { key: 'vehiculo', label: 'Vehiculo' }, { key: 'placa', label: 'Placa' },
      { key: 'cliente', label: 'Cliente' }, { key: 'servicio', label: 'Servicio' },
      { key: 'fecha', label: 'Fecha' }, { key: 'hora', label: 'Hora' },
      { key: 'tecnico', label: 'Mecánico' }, { key: 'sucursal', label: 'Sucursal' }, { key: 'estado', label: 'Estado' },
    ], this.citas.map(c => ({
      id: c.id, vehiculo: `${c.marca || ''} ${c.modelo || ''}`.trim(), placa: c.placa || '',
      cliente: `${c.cliente_nombre || ''} ${c.cliente_apellido || ''}`.trim(),
      servicio: c.tipo_servicio || c.motivo || '', fecha: fechaCorta(c.fecha),
      hora: (c.hora || '').slice(0, 5), tecnico: c.tecnico_nombre || '',
      sucursal: c.sucursal_nombre || '', estado: this.estadoLabel[c.estado] || c.estado,
    })));
  }
}
