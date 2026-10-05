import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { PortalService } from '../../services/portal.service';

@Component({
  standalone: false,
  selector: 'app-portal-ofertas',
  templateUrl: './portal-ofertas.page.html',
  styleUrls: ['./portal-ofertas.page.scss'],
})
export class PortalOfertasPage implements OnInit, OnDestroy {
  private portal = inject(PortalService);

  private destroy$ = new Subject<void>();
  promos: any[] = [];
  fidelidad: { visitas: number; cortesia_disponible: boolean; meta: number; faltan: number } | null = null;
  recompensas: { id: number; fecha: string; descripcion: string; numero_orden: string | null }[] = [];
  histAbierto = false;
  cargando = true;
  detalle: any = null;
  imagenes: Record<number, string> = {};
  private readonly iconos = ['disc-outline', 'link-outline', 'construct-outline', 'battery-charging-outline', 'ellipse-outline', 'settings-outline'];

  // Bloques de progreso: meta-1 sellos + el último (cortesía/regalo).
  get bloques(): boolean[] {
    if (!this.fidelidad) return [];
    const meta = this.fidelidad.meta || 7;
    const ciclo = this.fidelidad.visitas % meta;
    return Array.from({ length: meta }, (_, i) => i < ciclo);
  }

  // Emoji decorativo para el placeholder cuando la oferta no trae imagen.
  phIcono(i: number): string { return this.iconos[i % this.iconos.length]; }

  ngOnInit() { this.cargar(); }
  ionViewWillEnter() { this.cargar(); }

  cargar() {
    this.cargando = true;
    this.portal.getPromos().pipe(takeUntil(this.destroy$)).subscribe({
      next: r => {
        this.promos = r.data;
        this.cargando = false;
        r.data.filter((p: any) => p.tiene_imagen).slice(0, 3).forEach((p: any) => this.cargarImagen(p));
      },
      error: () => { this.cargando = false; },
    });
    this.portal.getFidelidad().pipe(takeUntil(this.destroy$)).subscribe({
      next: r => { this.fidelidad = r.data; },
      error: () => { this.fidelidad = null; },
    });
    this.portal.getRecompensas().pipe(takeUntil(this.destroy$)).subscribe({
      next: r => { this.recompensas = r.data; },
      error: () => { this.recompensas = []; },
    });
  }

  ngOnDestroy() { this.destroy$.next(); this.destroy$.complete(); }

  toggleHistorial() { this.histAbierto = !this.histAbierto; }

  cargarImagen(p: any) {
    if (this.imagenes[p.id] || !p.tiene_imagen) return;
    this.portal.getPromoImagen(p.id).pipe(takeUntil(this.destroy$)).subscribe({
      next: r => this.imagenes[p.id] = r.data,
    });
  }

  abrirDetalle(p: any) {
    this.detalle = p;
    this.cargarImagen(p);
  }
  cerrarDetalle() { this.detalle = null; }
}
