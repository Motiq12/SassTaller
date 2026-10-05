import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { Router } from '@angular/router';
import { Subject } from 'rxjs';
import { debounceTime, takeUntil } from 'rxjs/operators';
import { ClientesService } from '../../services/clientes.service';
import { Cliente } from '../../models/cliente.model';

@Component({ standalone: false,
  selector: 'app-clientes',
  templateUrl: './clientes.page.html',
  styleUrls: ['./clientes.page.scss'],
})
export class ClientesPage implements OnInit, OnDestroy {
  private clienteSvc = inject(ClientesService);
  private router = inject(Router);

  clientes: Cliente[] = [];
  busqueda = '';
  cargando = true;

  private destroy$ = new Subject<void>();
  private buscar$ = new Subject<string>();

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

  abrirDetalle(id: number) { this.router.navigate(['/cliente-detalle', id]); }
  nuevoCliente() { this.router.navigate(['/cliente-form']); }
  editarCliente(id: number) { this.router.navigate(['/cliente-form', id]); }

  iniciales(c: any): string {
    return ((c.nombre?.[0] || '') + (c.apellido?.[0] || '')).toUpperCase() || '?';
  }
}
