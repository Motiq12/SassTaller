import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { RecepcionService } from '../../services/recepcion.service';
import { alertaIcono, alertaColor, alertaTexto, haceTexto } from '../../shared/recepcion-alertas';

// Campana del encabezado de recepción (como la del portal del cliente): muestra un
// badge con los eventos del taller "no vistos" y, al tocarla, abre un popover con la
// lista. Se coloca con slot="end" en el toolbar de cada pantalla de recepción.
// "No vistos" = eventos más nuevos que la última vez que se abrió la campana
// (marca local en este dispositivo); al abrir el popover, el badge se limpia.
@Component({
  standalone: false,
  selector: 'app-recepcion-actions',
  template: `
    <ion-buttons>
      <ion-button class="bell" id="recBell" title="Alertas" aria-label="Alertas">
        <ion-icon slot="icon-only" name="notifications-outline"></ion-icon>
        <span class="bell-badge" *ngIf="noVistas" aria-hidden="true">{{ noVistas > 9 ? '9+' : noVistas }}</span>
      </ion-button>
    </ion-buttons>

    <ion-popover trigger="recBell" triggerAction="click" [dismissOnSelect]="true"
                 style="--width: 320px; --max-height: 70vh" (ionPopoverWillPresent)="marcarVistas()">
      <ng-template>
        <ion-content class="bell-pop">
          <div class="bp-head">Alertas <span>Últimas 24 h</span></div>
          <button class="bp-row" *ngFor="let a of alertas" (click)="abrir(a)" [class.tap]="!!a.orden_id">
            <span class="bp-ico" [ngClass]="alertaColor(a)"><ion-icon [name]="alertaIcono(a)"></ion-icon></span>
            <span class="bp-body">
              <span class="bp-txt">{{ alertaTexto(a) }}</span>
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
      color: #fff; background: var(--ion-color-danger);
      border-radius: 2px; border: 1.5px solid var(--ion-toolbar-background, #fff);
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
export class RecepcionActionsComponent implements OnInit {
  alertas: any[] = [];
  noVistas = 0;
  private readonly KEY = 'rec_alertas_visto';

  alertaIcono = alertaIcono;
  alertaColor = alertaColor;
  alertaTexto = alertaTexto;
  hace = haceTexto;

  constructor(private rec: RecepcionService, private router: Router) {}

  ngOnInit() { this.cargar(); }

  cargar() {
    this.rec.getAlertas().subscribe({
      next: r => { this.alertas = r.data || []; this.recalcular(); },
      error: () => { this.alertas = []; this.noVistas = 0; },
    });
  }

  private recalcular() {
    const visto = Number(localStorage.getItem(this.KEY) || 0);
    this.noVistas = this.alertas.filter(a => new Date(a.created_at).getTime() > visto).length;
  }

  // Al abrir el popover, marca como visto el evento más nuevo → el badge se limpia.
  marcarVistas() {
    const max = this.alertas.reduce((m, a) => Math.max(m, new Date(a.created_at).getTime()), 0);
    if (max) localStorage.setItem(this.KEY, String(max));
    this.noVistas = 0;
  }

  abrir(a: any) {
    if (a?.orden_id) this.router.navigate(['/detalle-orden', a.orden_id]);
  }
}
