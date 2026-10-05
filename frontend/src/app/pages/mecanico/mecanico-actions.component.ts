import { Component, OnInit, inject } from '@angular/core';
import { Router } from '@angular/router';
import { MecanicoService } from '../../services/mecanico.service';

function haceTexto(fecha: string): string {
  if (!fecha) return '';
  const min = Math.round((Date.now() - new Date(fecha).getTime()) / 60000);
  if (min < 1) return 'Recién';
  if (min < 60) return `Hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `Hace ${h} h`;
  return `Hace ${Math.round(h / 24)} d`;
}

@Component({
  standalone: false,
  selector: 'app-mecanico-actions',
  template: `
    <ion-buttons>
      <ion-button class="bell" id="mecBell" title="Alertas" aria-label="Alertas">
        <ion-icon slot="icon-only" name="notifications-outline"></ion-icon>
        <span class="bell-badge" *ngIf="noVistas" aria-hidden="true">{{ noVistas > 9 ? '9+' : noVistas }}</span>
      </ion-button>
    </ion-buttons>

    <ion-popover trigger="mecBell" triggerAction="click" [dismissOnSelect]="true"
                 style="--width: 320px; --max-height: 70vh" (ionPopoverWillPresent)="marcarVistas()">
      <ng-template>
        <ion-content class="bell-pop">
          <div class="bp-head">Alertas <span>Últimas 24 h</span></div>
          <button class="bp-row" *ngFor="let a of alertas" (click)="abrir(a)" [class.tap]="!!a.orden_id">
            <span class="bp-ico" [ngClass]="iconoColor(a)"><ion-icon [name]="icono(a)"></ion-icon></span>
            <span class="bp-body">
              <span class="bp-txt">{{ texto(a) }}</span>
              <span class="bp-time">{{ hace(a.created_at) }}<ng-container *ngIf="a.numero_orden"> · {{ a.numero_orden }}</ng-container></span>
            </span>
          </button>
          <div class="bp-empty" *ngIf="!alertas.length">
            <ion-icon name="notifications-off-outline"></ion-icon>
            <span>Sin alertas en las últimas 24 h</span>
          </div>
        </ion-content>
      </ng-template>
    </ion-popover>
  `,
  styles: [`
    .bell { position: relative; overflow: visible; }
    .bell-badge {
      position: absolute; top: 2px; right: 0;
      min-width: 16px; height: 16px; padding: 0 4px; box-sizing: border-box;
      display: flex; align-items: center; justify-content: center;
      font-size: 10px; font-weight: 800; line-height: 1;
      color: #fff; background: var(--ion-color-danger, #e11d48);
      border-radius: 999px; border: 1.5px solid var(--ion-toolbar-background, #fff);
      pointer-events: none;
    }
    .bell-pop { --padding-top: 6px; --padding-bottom: 6px; }
    .bp-head {
      display: flex; align-items: baseline; justify-content: space-between;
      padding: 10px 14px 8px; font-size: 13px; font-weight: 800;
      color: var(--ion-text-color); border-bottom: 1px solid var(--hairline);
      span { font-size: 10.5px; font-weight: 600; color: var(--n-400); text-transform: none; }
    }
    .bp-row {
      width: 100%; display: flex; align-items: flex-start; gap: 10px; text-align: left;
      background: none; border: none; padding: 11px 14px; cursor: default;
      border-bottom: 1px solid var(--hairline);
      &:last-of-type { border-bottom: none; }
      &.tap { cursor: pointer; }
      &.tap:active { background: var(--n-100); }
    }
    .bp-ico { flex-shrink: 0; display: flex; margin-top: 1px; ion-icon { font-size: 18px; }
      &.rose { color: var(--ion-color-primary); } &.green { color: var(--emerald-700); }
      &.amber { color: var(--amber-700); } &.indigo { color: var(--indigo-600); } }
    .bp-body { flex: 1; min-width: 0; display: flex; flex-direction: column; }
    .bp-txt { font-size: 12.5px; color: var(--ion-text-color); line-height: 1.35; }
    .bp-time { font-size: 10px; color: var(--n-400); margin-top: 2px; }
    .bp-empty {
      display: flex; flex-direction: column; align-items: center; gap: 8px;
      text-align: center; padding: 26px 16px; color: var(--n-400); font-size: 12.5px;
      ion-icon { font-size: 30px; opacity: .4; }
    }
  `],
})
export class MecanicoActionsComponent implements OnInit {
  private mecanico = inject(MecanicoService);
  private router = inject(Router);

  alertas: any[] = [];
  noVistas = 0;
  private readonly KEY = 'mec_alertas_visto';
  hace = haceTexto;

  ngOnInit() { this.cargar(); }

  cargar() {
    this.mecanico.getAlertas().subscribe({
      next: r => { this.alertas = r.data || []; this.recalcular(); },
      error: () => { this.alertas = []; this.noVistas = 0; },
    });
  }

  private recalcular() {
    const visto = Number(localStorage.getItem(this.KEY) || 0);
    this.noVistas = this.alertas.filter(a => new Date(a.created_at).getTime() > visto).length;
  }

  marcarVistas() {
    const max = this.alertas.reduce((m, a) => Math.max(m, new Date(a.created_at).getTime()), 0);
    if (max) localStorage.setItem(this.KEY, String(max));
    this.noVistas = 0;
  }

  icono(a: any): string {
    if (a.tipo === 'mensaje') return 'chatbubble-ellipses-outline';
    if (a.tipo === 'cita_asignada') return 'calendar-outline';
    if (a.tipo === 'orden_estado') {
      if (a.aprobacion_cliente === 'aprobado') return 'checkmark-circle-outline';
      if (a.aprobacion_cliente === 'rechazado') return 'close-circle-outline';
      return 'construct-outline';
    }
    return 'notifications-outline';
  }

  iconoColor(a: any): string {
    if (a.tipo === 'mensaje') return 'indigo';
    if (a.tipo === 'cita_asignada') return 'green';
    if (a.tipo === 'orden_estado') {
      if (a.aprobacion_cliente === 'rechazado') return 'rose';
      return 'amber';
    }
    return 'indigo';
  }

  texto(a: any): string {
    if (a.tipo === 'mensaje') return `${a.remitente_nombre}: ${(a.texto || '').slice(0, 60)}`;
    if (a.tipo === 'cita_asignada') return `Nueva cita: ${a.tipo_servicio || ''} ${a.marca || ''} ${a.modelo || ''} el ${a.fecha} a las ${a.hora}`;
    if (a.tipo === 'orden_estado') {
      if (a.aprobacion_cliente === 'aprobado') return `Cliente aprobó presupuesto — ${a.marca} ${a.modelo}`;
      if (a.aprobacion_cliente === 'rechazado') return `Cliente rechazó presupuesto — ${a.marca} ${a.modelo}`;
      return `Orden ${a.estado}: ${a.marca} ${a.modelo}`;
    }
    return 'Notificación';
  }

  abrir(a: any) {
    if (a?.orden_id) this.router.navigate(['/detalle-orden', a.orden_id]);
    else if (a.tipo === 'mensaje') this.router.navigate(['/mecanico/contacto']);
    else if (a.tipo === 'cita_asignada') this.router.navigate(['/mecanico/agenda']);
  }
}
