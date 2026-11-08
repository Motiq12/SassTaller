import { Component, OnInit, OnDestroy } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { enPanel, rutaPanel } from '../../shared/ruta-panel';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { VehiculosService } from '../../services/vehiculos.service';
import { AuthService } from '../../services/auth.service';
import { Moto } from '../../models/moto.model';
import { Orden } from '../../models/orden.model';

// Ficha de una moto: sus datos, su dueño y el historial de servicios como línea de
// tiempo. Se abre desde la ficha del cliente y desde una orden.
@Component({ standalone: false,
  selector: 'app-moto-historial',
  templateUrl: './moto-historial.page.html',
  styleUrls: ['./moto-historial.page.scss'],
})
export class MotoHistorialPage implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  moto: Moto | null = null;
  historial: Orden[] = [];
  cargando = true;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private motoSvc: VehiculosService,
    private auth: AuthService,
  ) {}

  ngOnInit() {
    const id = +(this.route.snapshot.paramMap.get('id') || 0);
    this.motoSvc.getById(id).pipe(takeUntil(this.destroy$)).subscribe({
      next: res => { this.moto = res.data; this.cargando = false; },
      error: () => { this.cargando = false; },
    });
    this.motoSvc.getHistorial(id).pipe(takeUntil(this.destroy$)).subscribe(res => this.historial = res.data);
  }

  ngOnDestroy() { this.destroy$.next(); this.destroy$.complete(); }

  // Abierta desde el panel de administración (ver shared/ruta-panel.ts).
  get dentroDelPanel(): boolean { return enPanel(this.router); }
  get volverA(): string { return this.moto ? `${rutaPanel(this.router, '/cliente-detalle')}/${this.moto.cliente_id}` : '/'; }

  // Los montos solo para quien ve precios: administración y recepción (el mecánico
  // no ve precios, ver backend/src/utils/permisos.js).
  get verMontos(): boolean { return this.auth.tieneRol('admin', 'recepcion'); }
  get puedeEditar(): boolean { return this.auth.tieneRol('admin', 'recepcion') && this.auth.puede('clientes.editar'); }
  // "Nueva orden" con la moto ya elegida es de administración (la pantalla nueva-orden
  // es solo suya; recepción abre órdenes desde "Ingresar ahora").
  get puedeAbrirOrden(): boolean { return this.auth.tieneRol('admin'); }

  cerrada(o: Orden): boolean { return ['entregada', 'cancelada'].includes(o.estado as string); }
  get enCurso(): number { return this.historial.filter(o => !this.cerrada(o)).length; }
  // El total llega como texto ("0.00"): se pasa a número para no mostrar ₡0.
  totalDe(o: any): number {
    const t = Number(o.total);
    return Number.isFinite(t) ? t : (Number(o.costo_mano_obra) || 0) + (Number(o.costo_repuestos) || 0) - (Number(o.descuento) || 0);
  }
  get totalCobrado(): number { return this.historial.filter(o => o.estado === 'entregada').reduce((n, o) => n + this.totalDe(o), 0); }
  get ultimaVisita(): string {
    const f = this.historial[0]?.fecha_ingreso;
    return f ? new Date(f).toLocaleDateString('es-CR', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
  }

  abrirOrden(id: number) { this.router.navigate([rutaPanel(this.router, '/detalle-orden'), id]); }
  abrirCliente() { if (this.moto) this.router.navigate([rutaPanel(this.router, '/cliente-detalle'), this.moto.cliente_id]); }
  editar() { if (this.moto) this.router.navigate([rutaPanel(this.router, '/moto-form'), this.moto.id]); }
  nuevaOrden() {
    if (this.moto) this.router.navigate([rutaPanel(this.router, '/nueva-orden')], { queryParams: { cliente_id: this.moto.cliente_id, vehiculo_id: this.moto.id } });
  }
}
