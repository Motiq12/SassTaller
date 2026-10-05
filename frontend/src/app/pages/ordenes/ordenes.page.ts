import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { Router } from '@angular/router';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { OrdenesService } from '../../services/ordenes.service';
import { AuthService } from '../../services/auth.service';
import { Orden, EstadoOrden } from '../../models/orden.model';

@Component({ standalone: false,
  selector: 'app-ordenes',
  templateUrl: './ordenes.page.html',
  styleUrls: ['./ordenes.page.scss'],
})
export class OrdenesPage implements OnInit, OnDestroy {
  private ordenSvc = inject(OrdenesService);
  auth = inject(AuthService);
  private router = inject(Router);

  private destroy$ = new Subject<void>();
  ordenes: Orden[] = [];
  cargando = true;
  filtroEstado = '';

  readonly estados: { valor: EstadoOrden | ''; label: string }[] = [
    { valor: '', label: 'Todas' },
    { valor: 'recepcion', label: 'Recepción' },
    { valor: 'diagnostico', label: 'Diagnóstico' },
    { valor: 'esperando_aprobacion', label: 'Aprobación' },
    { valor: 'esperando_repuestos', label: 'Repuestos' },
    { valor: 'en_reparacion', label: 'Reparación' },
    { valor: 'lista_entrega', label: 'Lista' },
    { valor: 'entregada', label: 'Entregada' },
    { valor: 'cancelada', label: 'Cancelada' },
  ];

  get esAdmin(): boolean { return this.auth.tieneRol('admin'); }

  ngOnInit() {
    this.cargar();
  }

  ngOnDestroy() { this.destroy$.next(); this.destroy$.complete(); }

  ionViewWillEnter() {
    this.cargar();
  }

  cargar() {
    this.cargando = true;
    const params: any = {};
    if (this.filtroEstado) params.estado = this.filtroEstado;
    this.ordenSvc.getAll(params).pipe(takeUntil(this.destroy$)).subscribe({
      next: res => { this.ordenes = res.data; this.cargando = false; },
      error: () => { this.cargando = false; },
    });
  }

  filtrar(estado: string) {
    this.filtroEstado = estado;
    this.cargar();
  }

  abrirDetalle(id: number) {
    this.router.navigate(['/detalle-orden', id]);
  }

  nuevaOrden() {
    this.router.navigate(['/nueva-orden']);
  }
}
