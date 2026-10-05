import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { Router } from '@angular/router';
import { Subject } from 'rxjs';
import { debounceTime, distinctUntilChanged, takeUntil } from 'rxjs/operators';
import { RecepcionService } from '../../services/recepcion.service';
import { abrirWhatsApp } from '../../shared/utils/whatsapp.util';

@Component({
  standalone: false,
  selector: 'app-recepcion-clientes',
  templateUrl: './recepcion-clientes.page.html',
  styleUrls: ['./recepcion-clientes.page.scss'],
})
export class RecepcionClientesPage implements OnInit, OnDestroy {
  private rec = inject(RecepcionService);
  private router = inject(Router);

  private destroy$ = new Subject<void>();
  clientes: any[] = [];
  cargando = true;
  private busqueda$ = new Subject<string>();

  ngOnInit() {
    this.busqueda$.pipe(debounceTime(400), distinctUntilChanged(), takeUntil(this.destroy$)).subscribe(q => this.cargar(q));
    this.cargar();
  }
  ionViewWillEnter() { this.cargar(); }
  ngOnDestroy() { this.destroy$.next(); this.destroy$.complete(); this.busqueda$.complete(); }

  cargar(q?: string, ev?: any) {
    this.cargando = true;
    this.rec.getClientes(q).pipe(takeUntil(this.destroy$)).subscribe({
      next: r => { this.clientes = r.data; this.cargando = false; if (ev) ev.target.complete(); },
      error: () => { this.cargando = false; if (ev) ev.target.complete(); },
    });
  }

  buscar(ev: any) { this.busqueda$.next((ev.detail.value || '').trim()); }

  iniciales(nombre?: string, apellido?: string): string {
    return `${(nombre || '?').charAt(0)}${(apellido || '').charAt(0)}`.toUpperCase();
  }

  llamar(c: any, ev: Event) { ev.stopPropagation(); window.open(`tel:${c.telefono}`, '_self'); }
  whatsapp(c: any, ev: Event) { ev.stopPropagation(); abrirWhatsApp(c.telefono, ''); }

  abrirCliente(c: any) { this.router.navigate(['/cliente-detalle', c.id]); }
}
