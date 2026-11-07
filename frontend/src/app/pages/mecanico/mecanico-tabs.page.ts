import { Component, OnDestroy, OnInit } from '@angular/core';
import { Subject, interval } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { AuthService } from '../../services/auth.service';
import { MensajeriaService } from '../../services/mensajeria.service';

@Component({
  standalone: false,
  selector: 'app-mecanico-tabs',
  templateUrl: './mecanico-tabs.page.html',
})
export class MecanicoTabsPage implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  noLeidos = 0;

  constructor(private msj: MensajeriaService, private auth: AuthService) {}

  get nombre(): string {
    return this.auth.getUsuario()?.nombre || 'Mecánico';
  }

  get iniciales(): string {
    const u = this.auth.getUsuario();
    return (u?.nombre || 'M').charAt(0).toUpperCase();
  }

  ngOnInit() {
    // Las casillas de su rol, al día (si administración se las cambió, sin volver a entrar).
    this.auth.refrescarUsuario().pipe(takeUntil(this.destroy$)).subscribe({ error: () => {} });
    this.consultarNoLeidos();
    interval(30000).pipe(takeUntil(this.destroy$)).subscribe(() => this.consultarNoLeidos());
  }

  ngOnDestroy() { this.destroy$.next(); this.destroy$.complete(); }

  logout() {
    this.auth.logout();
    window.location.href = '/login';
  }

  private consultarNoLeidos() {
    // Con la sesión cerrada o vencida no se pregunta: cada vez sería un rechazo.
    if (!this.auth.isLoggedIn() || this.auth.isTokenExpired()) return;
    this.msj.getNoLeidos().pipe(takeUntil(this.destroy$)).subscribe({
      next: r => this.noLeidos = r.data.count,
    });
  }
}
