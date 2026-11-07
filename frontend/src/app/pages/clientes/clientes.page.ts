import { Component, OnInit, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { enPanel, rutaPanel } from '../../shared/ruta-panel';
import { Subject } from 'rxjs';
import { debounceTime, takeUntil } from 'rxjs/operators';
import { ClientesService } from '../../services/clientes.service';
import { Cliente } from '../../models/cliente.model';
import { abrirWhatsApp } from '../../shared/whatsapp.util';

type Filtro = 'todos' | 'portal' | 'sin_portal' | 'cortesia';

@Component({ standalone: false,
  selector: 'app-clientes',
  templateUrl: './clientes.page.html',
  styleUrls: ['./clientes.page.scss'],
})
export class ClientesPage implements OnInit, OnDestroy {
  clientes: Cliente[] = [];
  busqueda = '';
  cargando = true;

  // Filtros rápidos sobre lo que ya trajo la búsqueda (el servidor devuelve hasta 500).
  filtro: Filtro = 'todos';
  readonly filtros: { id: Filtro; label: string }[] = [
    { id: 'todos', label: 'Todos' },
    { id: 'portal', label: 'Con portal' },
    { id: 'sin_portal', label: 'Sin portal' },
    { id: 'cortesia', label: 'Con cortesía' },
  ];

  private destroy$ = new Subject<void>();
  private buscar$ = new Subject<string>();

  constructor(private clienteSvc: ClientesService, private router: Router) {}

  // Abierta dentro de un menú lateral: el panel de administración (ver
  // shared/ruta-panel.ts) o recepción, que usa esta misma pantalla en /recepcion/clientes.
  get dentroDelPanel(): boolean { return enPanel(this.router) || this.router.url.startsWith('/recepcion/'); }

  ngOnInit() {
    this.buscar$.pipe(debounceTime(400), takeUntil(this.destroy$)).subscribe(q => {
      this.busqueda = q;
      this.cargar();
    });
    this.cargar();
  }

  ionViewWillEnter() { this.cargar(); }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  cargar() {
    this.cargando = true;
    this.clienteSvc.getAll(this.busqueda || undefined).pipe(takeUntil(this.destroy$)).subscribe({
      next: res => { this.clientes = res.data; this.cargando = false; },
      error: () => { this.cargando = false; },
    });
  }

  buscar(ev: any) {
    this.buscar$.next(ev.detail.value);
  }

  abrirDetalle(id: number) { this.router.navigate([rutaPanel(this.router, '/cliente-detalle'), id]); }
  nuevoCliente() { this.router.navigate([rutaPanel(this.router, '/cliente-form')]); }
  editarCliente(id: number) { this.router.navigate([rutaPanel(this.router, '/cliente-form'), id]); }

  private pasa(c: Cliente, f: Filtro): boolean {
    if (f === 'portal') return !!c.tiene_portal;
    if (f === 'sin_portal') return !c.tiene_portal;
    if (f === 'cortesia') return !!c.cortesia_disponible;
    return true;
  }
  cuenta(f: Filtro): number { return this.clientes.filter(c => this.pasa(c, f)).length; }
  get visibles(): Cliente[] { return this.clientes.filter(c => this.pasa(c, this.filtro)); }

  get textoCuenta(): string {
    const n = this.clientes.length;
    if (this.busqueda) return `${n} resultado${n === 1 ? '' : 's'} para «${this.busqueda}»`;
    return n >= 500 ? 'Los primeros 500: buscá para encontrar uno puntual' : `${n} cliente${n === 1 ? '' : 's'}`;
  }

  whatsapp(c: Cliente, ev: Event) {
    ev.stopPropagation();
    abrirWhatsApp(c.telefono, '');
  }

  iniciales(c: any): string {
    return ((c.nombre?.[0] || '') + (c.apellido?.[0] || '')).toUpperCase() || '?';
  }
}
