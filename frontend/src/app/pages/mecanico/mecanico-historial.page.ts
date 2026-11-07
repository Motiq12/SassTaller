import { Component, OnInit, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { MecanicoService } from '../../services/mecanico.service';
import { AuthService } from '../../services/auth.service';

@Component({
  standalone: false,
  selector: 'app-mecanico-historial',
  templateUrl: './mecanico-historial.page.html',
  styleUrls: ['./mecanico.page.scss', './mecanico-historial.page.scss'],
})
export class MecanicoHistorialPage implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  acum: any = null;       // acumulado (de /perfil): completadas, ingresos, calificación
  citas: any[] = [];      // citas entregadas (más recientes primero)
  cargando = true;

  constructor(
    private mecanico: MecanicoService,
    private auth: AuthService,
    private router: Router,
  ) {}

  ngOnInit() { this.cargar(); }
  ngOnDestroy() { this.destroy$.next(); this.destroy$.complete(); }
  ionViewWillEnter() { this.cargar(); }

  cargar(ev?: any) {
    this.cargando = true;
    this.mecanico.getPerfil().pipe(takeUntil(this.destroy$)).subscribe({ next: r => this.acum = r.data, error: () => {} });
    this.mecanico.getCitas({ estado: 'entregado' }).pipe(takeUntil(this.destroy$)).subscribe({
      next: r => {
        this.citas = (r.data || []).slice().sort((a, b) =>
          String(b.fecha_fin || b.fecha || '').localeCompare(String(a.fecha_fin || a.fecha || '')));
        this.cargando = false; if (ev) ev.target.complete();
      },
      error: () => { this.cargando = false; if (ev) ev.target.complete(); },
    });
  }

  formatMin(min: number | null | undefined): string {
    if (!min) return '—';
    const h = Math.floor(min / 60);
    const m = Math.round(min % 60);
    if (h > 0) return `${h}h ${m}min`;
    return `${m} min`;
  }

  estrellas(prom: number | null): string {
    if (!prom) return '—';
    const llenas = Math.round(prom);
    return '★'.repeat(llenas) + '☆'.repeat(5 - llenas);
  }

  logout() {
    this.auth.logout();
    this.router.navigate(['/portal/login'], { replaceUrl: true });
  }
}
