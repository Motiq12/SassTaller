import { Component, OnInit, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { enPanel, rutaPanel } from '../../shared/ruta-panel';
import { Subject } from 'rxjs';
import { debounceTime, distinctUntilChanged, takeUntil } from 'rxjs/operators';
import { OrdenesService } from '../../services/ordenes.service';
import { AuthService } from '../../services/auth.service';
import { Orden, EstadoOrden } from '../../models/orden.model';

@Component({ standalone: false,
  selector: 'app-ordenes',
  templateUrl: './ordenes.page.html',
  styleUrls: ['./ordenes.page.scss'],
})
export class OrdenesPage implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  ordenes: Orden[] = [];
  cargando = true;
  filtroEstado = '';
  // Buscador: lo filtra el backend en toda la base (la lista trae hasta 500 órdenes).
  busqueda = '';
  private busqueda$ = new Subject<string>();
  // Cada carga lleva un número: si llega la respuesta de una búsqueda vieja después
  // de una nueva, se descarta.
  private pedido = 0;

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

  constructor(private ordenSvc: OrdenesService, public auth: AuthService, private router: Router) {}

  get esAdmin(): boolean { return this.auth.tieneRol('admin'); }
  // Abierta desde el panel de administración (ver shared/ruta-panel.ts).
  get dentroDelPanel(): boolean { return enPanel(this.router); }

  ngOnInit() {
    this.busqueda$.pipe(debounceTime(300), distinctUntilChanged(), takeUntil(this.destroy$))
      .subscribe(() => this.cargar());
    this.cargar();
  }

  buscar(texto: string) {
    this.busqueda = texto;
    this.busqueda$.next(texto.trim());
  }

  limpiarBusqueda() { this.buscar(''); }

  // Sin resultados con un estado elegido: buscar lo mismo en todos los estados.
  buscarEnTodas() { this.filtrar(''); }

  ngOnDestroy() { this.destroy$.next(); this.destroy$.complete(); }

  ionViewWillEnter() {
    this.cargar();
  }

  cargar() {
    this.cargando = true;
    const n = ++this.pedido;
    const params: any = {};
    if (this.filtroEstado) params.estado = this.filtroEstado;
    if (this.busqueda.trim()) params.q = this.busqueda.trim();
    this.ordenSvc.getAll(params).pipe(takeUntil(this.destroy$)).subscribe({
      next: res => { if (n !== this.pedido) return; this.ordenes = res.data; this.cargando = false; },
      error: () => { if (n === this.pedido) this.cargando = false; },
    });
  }

  filtrar(estado: string) {
    this.filtroEstado = estado;
    this.cargar();
  }

  abrirDetalle(id: number) {
    this.router.navigate([rutaPanel(this.router, '/detalle-orden'), id]);
  }

  nuevaOrden() {
    this.router.navigate([rutaPanel(this.router, '/nueva-orden')]);
  }
}
