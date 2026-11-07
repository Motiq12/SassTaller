import { Component, OnInit, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { Subject, interval } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { AuthService } from '../../services/auth.service';
import { MensajeriaService } from '../../services/mensajeria.service';

@Component({
  standalone: false,
  selector: 'app-recepcion-tabs',
  templateUrl: './recepcion-tabs.page.html',
})
export class RecepcionTabsPage implements OnInit, OnDestroy {
  noLeidos = 0;
  private destroy$ = new Subject<void>();

  constructor(private auth: AuthService, private router: Router, private msj: MensajeriaService) {}

  ngOnInit() {
    // Las casillas de su rol, al día (si administración se las cambió, sin volver a entrar).
    this.auth.refrescarUsuario().pipe(takeUntil(this.destroy$)).subscribe({ error: () => {} });
    this.consultarNoLeidos();
    interval(20000).pipe(takeUntil(this.destroy$)).subscribe(() => this.consultarNoLeidos());
  }

  private consultarNoLeidos() {
    // Con la sesión cerrada o vencida no se pregunta: cada vez sería un rechazo.
    if (!this.auth.isLoggedIn() || this.auth.isTokenExpired()) return;
    this.msj.getNoLeidos().pipe(takeUntil(this.destroy$)).subscribe({
      next: r => this.noLeidos = r.data.count,
    });
  }

  get nombre(): string { return this.auth.getUsuario()?.nombre || 'Recepción'; }
  get foto(): string | null { return this.auth.getUsuario()?.foto || null; }
  get rolLabel(): string { return 'Recepción'; }
  get iniciales(): string {
    const p = this.nombre.trim().split(/\s+/);
    return ((p[0]?.[0] || '') + (p[1]?.[0] || '')).toUpperCase() || 'R';
  }

  logout() {
    this.auth.logout();
    this.router.navigate(['/portal/login'], { replaceUrl: true });
  }

  ngOnDestroy() { this.destroy$.next(); this.destroy$.complete(); }
}
