import { Component, Input, OnDestroy, OnInit } from '@angular/core';
import { ToastController } from '@ionic/angular';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { MiPerfilService } from '../../services/mi-perfil.service';
import { AdminService } from '../../services/admin.service';
import { PreferenciasPersonal } from '../../models/usuario.model';

type Rol = 'admin' | 'recepcion' | 'tecnico';

// Pantallas con las que se puede arrancar, por rol (el servidor solo acepta las del
// panel propio: utils/preferencias.js).
export const INICIOS: Record<Rol, { ruta: string; nombre: string }[]> = {
  admin: [
    { ruta: '/admin/resumen', nombre: 'Resumen ejecutivo' },
    { ruta: '/admin/citas', nombre: 'Gestión de citas' },
    { ruta: '/admin/calendario', nombre: 'Calendario' },
    { ruta: '/admin/clientes', nombre: 'Clientes' },
    { ruta: '/admin/recibir', nombre: 'Nueva cita u orden' },
    { ruta: '/admin/mensajes', nombre: 'Mensajes' },
  ],
  recepcion: [
    { ruta: '/recepcion/inicio', nombre: 'Inicio' },
    { ruta: '/recepcion/agenda', nombre: 'Agenda' },
    { ruta: '/recepcion/recibir', nombre: 'Recibir vehículo' },
    { ruta: '/recepcion/ordenes', nombre: 'Órdenes' },
    { ruta: '/recepcion/clientes', nombre: 'Clientes' },
    { ruta: '/recepcion/mensajes', nombre: 'Mensajes' },
  ],
  tecnico: [
    { ruta: '/mecanico/inicio', nombre: 'Inicio' },
    { ruta: '/mecanico/agenda', nombre: 'Agenda' },
    { ruta: '/mecanico/tareas', nombre: 'Tareas' },
    { ruta: '/mecanico/historial', nombre: 'Historial' },
  ],
};

// Los avisos de la campana que cada quien puede apagar (los mismos tipos del servidor).
const NOMBRE_AVISO: Record<string, string> = {
  foto: 'Fotos que sube el mecánico',
  lista: 'Órdenes listas para entregar',
  aprobacion: 'El cliente aprobó o rechazó un presupuesto',
  cita_nueva: 'Citas nuevas',
  cita_cancelada: 'Citas canceladas',
  repuesto: 'Repuestos que pide el mecánico',
  sin_entregar: 'Vehículos listos que nadie ha retirado',
  mensaje: 'Mensajes del equipo',
  cita_asignada: 'Citas que te asignan',
  orden_estado: 'Cambios en tus órdenes',
};

// Gustos propios: con qué pantalla arranca, qué sede ve primero y qué avisos recibe.
// Se guardan solos al cambiar.
@Component({
  standalone: false,
  selector: 'app-mis-preferencias',
  template: `
    <div class="px">
      <div class="px-titulo">
        <ion-icon name="options-outline"></ion-icon>
        <div><strong>Al entrar</strong><span>Se guarda solo, para tu cuenta en cualquier equipo.</span></div>
      </div>

      <p class="px-vacio" *ngIf="cargando">Cargando…</p>
      <ng-container *ngIf="!cargando && prefs">
        <label class="px-campo">
          <span>Pantalla de inicio</span>
          <select [ngModel]="prefs.inicio || ''" (ngModelChange)="cambiar({ inicio: $event || null })" name="inicio" [disabled]="guardando">
            <option value="">La de siempre ({{ inicios[0].nombre }})</option>
            <option *ngFor="let i of inicios.slice(1)" [value]="i.ruta">{{ i.nombre }}</option>
          </select>
        </label>

        <label class="px-campo" *ngIf="rol === 'admin' && sedes.length > 1">
          <span>Sede en Gestión de citas</span>
          <select [ngModel]="prefs.sede_id || ''" (ngModelChange)="cambiar({ sede_id: $event ? +$event : null })" name="sede" [disabled]="guardando">
            <option value="">Todas las sedes</option>
            <option *ngFor="let s of sedes" [value]="s.id">{{ s.nombre }}</option>
          </select>
          <small>La lista arranca filtrada por esa sede; ahí mismo podés cambiarla.</small>
        </label>

        <ng-container *ngIf="avisos.length">
          <div class="px-campo"><span>Avisos de la campana</span></div>
          <label class="px-check" *ngFor="let a of avisos">
            <input type="checkbox" [checked]="!prefs.avisos_off.includes(a)" (change)="alternarAviso(a)" [disabled]="guardando">
            {{ nombreAviso(a) }}
          </label>
        </ng-container>
      </ng-container>
    </div>
  `,
  styleUrls: ['./perfil-extra.scss'],
})
export class MisPreferenciasComponent implements OnInit, OnDestroy {
  @Input() rol: Rol = 'admin';
  private destroy$ = new Subject<void>();
  prefs: PreferenciasPersonal | null = null;
  avisos: string[] = [];
  sedes: { id: number; nombre: string }[] = [];
  cargando = true;
  guardando = false;

  constructor(private perfil: MiPerfilService, private admin: AdminService, private toast: ToastController) {}

  get inicios() { return INICIOS[this.rol] || INICIOS.admin; }
  nombreAviso(a: string) { return NOMBRE_AVISO[a] || a; }

  ngOnInit() {
    this.perfil.get().pipe(takeUntil(this.destroy$)).subscribe({
      next: r => { this.prefs = r.data.preferencias; this.avisos = r.data.avisos || []; this.cargando = false; },
      error: () => { this.cargando = false; },
    });
    if (this.rol === 'admin') {
      this.admin.getSucursales().pipe(takeUntil(this.destroy$)).subscribe({
        next: r => this.sedes = (r.data || []).filter((s: any) => Number(s.activa) === 1),
        error: () => {},
      });
    }
  }
  ngOnDestroy() { this.destroy$.next(); this.destroy$.complete(); }

  alternarAviso(a: string) {
    if (!this.prefs) return;
    const off = this.prefs.avisos_off.includes(a) ? this.prefs.avisos_off.filter(x => x !== a) : [...this.prefs.avisos_off, a];
    this.cambiar({ avisos_off: off });
  }

  cambiar(parcial: Partial<PreferenciasPersonal>) {
    if (!this.prefs) return;
    const antes = this.prefs;
    this.prefs = { ...this.prefs, ...parcial };
    this.guardando = true;
    this.perfil.guardarPreferencias(this.prefs).pipe(takeUntil(this.destroy$)).subscribe({
      next: r => { this.guardando = false; this.prefs = r.data; this.aviso('Guardado'); },
      error: e => { this.guardando = false; this.prefs = antes; this.aviso(e.error?.error || 'No se pudo guardar', 'danger'); },
    });
  }

  private async aviso(message: string, color = 'success') {
    const t = await this.toast.create({ message, duration: 1200, color });
    await t.present();
  }
}
