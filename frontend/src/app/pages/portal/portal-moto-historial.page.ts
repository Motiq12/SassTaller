import { Component, OnInit, OnDestroy } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { PortalService } from '../../services/portal.service';
import { proximoServicio, ProximoServicio } from '../../utils/mantenimiento';

@Component({
  standalone: false,
  selector: 'app-portal-moto-historial',
  templateUrl: './portal-moto-historial.page.html',
  styleUrls: ['./portal-moto-historial.page.scss'],
})
export class PortalMotoHistorialPage implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  moto: any = null;
  servicios: any[] = [];
  cargando = true;
  totalGastado = 0;
  proximo: ProximoServicio | null = null;   // próximo servicio recomendado (por tiempo)

  constructor(private route: ActivatedRoute, private router: Router, private portal: PortalService) {}

  ngOnInit() {
    const id = Number(this.route.snapshot.paramMap.get('id'));
    if (id) this.cargar(id);
  }

  cargar(id: number) {
    this.cargando = true;
    this.portal.getMotoHistorial(id).pipe(takeUntil(this.destroy$)).subscribe({
      next: r => {
        this.moto = r.data.moto;
        this.servicios = r.data.servicios || [];
        this.totalGastado = this.servicios.reduce((s, x) => s + Number(x.monto || 0), 0);
        this.proximo = proximoServicio(this.servicios);
        this.cargando = false;
      },
      error: () => { this.cargando = false; },
    });
  }

  // Texto del estado del próximo servicio (cabecera de la tarjeta).
  get proximoTitulo(): string {
    if (!this.proximo) return '';
    if (this.proximo.sinHistorial) return 'Servicio sugerido';
    return this.proximo.estado === 'vencido' ? 'Te toca este servicio'
      : this.proximo.estado === 'pronto' ? 'Próximo servicio'
      : 'Mantenimiento al día';
  }
  get proximoIcono(): string {
    if (!this.proximo) return 'time-outline';
    return this.proximo.estado === 'vencido' ? 'alert-circle'
      : this.proximo.estado === 'al_dia' ? 'checkmark-circle' : 'time-outline';
  }

  // Lleva a Agendar con la moto y el servicio recomendado precargados.
  agendarServicio() {
    if (!this.moto) return;
    this.router.navigate(['/portal/agendar'], {
      queryParams: { moto: this.moto.id, servicio: this.proximo?.servicio || undefined },
    });
  }
  verCita(s: any) { this.router.navigate(['/portal/cita', s.id]); }
  estrellas(n: number): string { return '★'.repeat(n) + '☆'.repeat(5 - n); }

  ngOnDestroy() { this.destroy$.next(); this.destroy$.complete(); }
}
