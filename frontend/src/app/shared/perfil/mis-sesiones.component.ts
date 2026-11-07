import { Component, OnDestroy, OnInit } from '@angular/core';
import { ToastController } from '@ionic/angular';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { MiPerfilService, SesionAbierta } from '../../services/mi-perfil.service';
import { haceCuanto } from './tiempo';

// Dónde tiene la persona la sesión abierta, para cerrar una que no reconoce.
@Component({
  standalone: false,
  selector: 'app-mis-sesiones',
  template: `
    <div class="px">
      <div class="px-titulo">
        <ion-icon name="laptop-outline"></ion-icon>
        <div><strong>Dónde estás conectado</strong><span>Si no reconocés un equipo, cerrá esa sesión y cambiá tu contraseña.</span></div>
      </div>

      <p class="px-vacio" *ngIf="cargando">Cargando…</p>
      <p class="px-vacio" *ngIf="error">{{ error }}</p>
      <ul class="px-lista" *ngIf="!cargando && !error">
        <li class="px-fila" *ngFor="let s of sesiones">
          <ion-icon [name]="icono(s)"></ion-icon>
          <div class="px-fila-txt">
            <strong>{{ s.dispositivo }} <span class="px-chip" *ngIf="s.actual">Este equipo</span></strong>
            <span>{{ s.actual ? 'Activa ahora' : 'Última vez: ' + hace(s.ultima_vez) }} · Entró {{ hace(s.creada).toLowerCase() }}<ng-container *ngIf="s.ip"> · {{ s.ip }}</ng-container></span>
          </div>
          <button type="button" class="px-btn mini" *ngIf="!s.actual" (click)="cerrar(s)" [disabled]="procesando">Cerrar</button>
        </li>
        <li class="px-vacio" *ngIf="!sesiones.length">No hay sesiones abiertas en la lista.</li>
      </ul>
      <p class="px-nota" *ngIf="!cargando && !error && !conSid">
        Entraste en este equipo antes de que existiera esta lista, así que no aparece acá. La próxima vez que entrés, sí.
      </p>

      <div class="px-acciones" *ngIf="otras > 0">
        <button type="button" class="px-btn" (click)="cerrarOtras()" [disabled]="procesando">
          <ion-icon name="log-out-outline"></ion-icon> Cerrar las demás ({{ otras }})
        </button>
      </div>
    </div>
  `,
  styleUrls: ['./perfil-extra.scss'],
})
export class MisSesionesComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  sesiones: SesionAbierta[] = [];
  conSid = true;
  cargando = true;
  procesando = false;
  error = '';

  constructor(private perfil: MiPerfilService, private toast: ToastController) {}

  ngOnInit() { this.cargar(); }
  ngOnDestroy() { this.destroy$.next(); this.destroy$.complete(); }

  get otras(): number { return this.sesiones.filter(s => !s.actual).length; }

  hace(iso: string) { return haceCuanto(iso); }

  icono(s: SesionAbierta): string {
    return /Android|iPhone|App/.test(s.dispositivo) ? 'phone-portrait-outline' : 'desktop-outline';
  }

  cargar() {
    this.perfil.sesiones().pipe(takeUntil(this.destroy$)).subscribe({
      next: r => { this.sesiones = r.data.sesiones; this.conSid = r.data.con_sid; this.cargando = false; this.error = ''; },
      error: () => { this.cargando = false; this.error = 'No se pudieron cargar las sesiones.'; },
    });
  }

  cerrar(s: SesionAbierta) {
    this.procesando = true;
    this.perfil.cerrarSesion(s.id).pipe(takeUntil(this.destroy$)).subscribe({
      next: r => { this.procesando = false; this.sesiones = this.sesiones.filter(x => x.id !== s.id); this.aviso(r.message); },
      error: e => { this.procesando = false; this.aviso(e.error?.error || 'No se pudo cerrar', 'danger'); this.cargar(); },
    });
  }

  cerrarOtras() {
    this.procesando = true;
    this.perfil.cerrarOtras().pipe(takeUntil(this.destroy$)).subscribe({
      next: r => { this.procesando = false; this.sesiones = this.sesiones.filter(x => x.actual); this.aviso(r.message); },
      error: e => { this.procesando = false; this.aviso(e.error?.error || 'No se pudieron cerrar', 'danger'); },
    });
  }

  private async aviso(message: string, color = 'success') {
    const t = await this.toast.create({ message, duration: 1800, color });
    await t.present();
  }
}
