import { Component, ElementRef, EventEmitter, Input, NgZone, OnDestroy, OnInit, Output, ViewChild } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { PortalService } from '../../services/portal.service';

// El botón "Continuar con Google" de entrar y crear cuenta. Es el botón oficial de
// Google (Google Identity Services): Google pide que se use el suyo, con su logo.
//
// No sale si el sistema no tiene GOOGLE_CLIENT_ID (GET /api/portal/google/config),
// ni dentro de la app de Android: ahí el inicio de Google necesita un plugin nativo,
// y el botón web no funciona dentro de la app.
declare const google: any;

const SCRIPT_GIS = 'https://accounts.google.com/gsi/client';
let cargaGis: Promise<void> | null = null;

function cargarGis(): Promise<void> {
  if ((window as any).google?.accounts?.id) return Promise.resolve();
  if (!cargaGis) {
    cargaGis = new Promise<void>((resolve, reject) => {
      const s = document.createElement('script');
      s.src = SCRIPT_GIS;
      s.async = true;
      s.defer = true;
      s.onload = () => resolve();
      s.onerror = () => { cargaGis = null; reject(new Error('No cargó el script de Google')); };
      document.head.appendChild(s);
    });
  }
  return cargaGis;
}

@Component({
  standalone: false,
  selector: 'app-google-boton',
  template: `
    <div class="gb" *ngIf="visible">
      <div class="gb-sep" *ngIf="separador"><span>o</span></div>
      <div #caja class="gb-caja" [class.listo]="listo"></div>
    </div>
  `,
  styles: [`
    .gb-sep {
      display: flex; align-items: center; gap: 12px; margin: 20px 0 16px;
      font-size: 11px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; color: #8591a3;
    }
    .gb-sep::before, .gb-sep::after { content: ''; flex: 1; height: 1px; background: #262b34; }
    /* Mientras carga el botón de Google, el lugar queda reservado: sin salto. */
    .gb-caja { display: flex; justify-content: center; min-height: 44px; margin-bottom: 10px; }
    .gb-caja:not(.listo) { border: 1px solid #262b34; border-radius: 2px; }
  `],
})
export class GoogleBotonComponent implements OnInit, OnDestroy {
  // 'continue_with' (Continuar con Google) o 'signup_with' (Registrarse con Google).
  @Input() texto: 'continue_with' | 'signup_with' | 'signin_with' = 'continue_with';
  // Una raya con "o" arriba del botón.
  @Input() separador = false;
  // El token de Google, para mandarlo al servidor.
  @Output() credencial = new EventEmitter<string>();

  @ViewChild('caja') set caja(el: ElementRef<HTMLElement> | undefined) {
    if (el && this.clientId && !this.dibujado) this.dibujar(el.nativeElement);
  }

  visible = false;
  listo = false;
  private clientId: string | null = null;
  private dibujado = false;
  private destroy$ = new Subject<void>();

  constructor(private portal: PortalService, private zone: NgZone) {}

  ngOnInit() {
    if (Capacitor.isNativePlatform()) return;
    this.portal.googleClientId().pipe(takeUntil(this.destroy$)).subscribe(id => {
      this.clientId = id;
      this.visible = !!id;
    });
  }

  ngOnDestroy() { this.destroy$.next(); this.destroy$.complete(); }

  private async dibujar(el: HTMLElement) {
    this.dibujado = true;
    try {
      await cargarGis();
      google.accounts.id.initialize({
        client_id: this.clientId,
        // El callback llega fuera de Angular: se vuelve a la zona para que la pantalla se entere.
        callback: (r: { credential?: string }) => this.zone.run(() => { if (r.credential) this.credencial.emit(r.credential); }),
        ux_mode: 'popup',
        auto_select: false,
        cancel_on_tap_outside: true,
      });
      google.accounts.id.renderButton(el, {
        type: 'standard',
        theme: 'filled_black',
        size: 'large',
        shape: 'rectangular',
        text: this.texto,
        logo_alignment: 'center',
        locale: 'es',
        // Google admite hasta 400 px de ancho.
        width: Math.min(400, Math.max(240, Math.round(el.getBoundingClientRect().width || 320))),
      });
      this.listo = true;
    } catch {
      // Sin el script de Google (sin internet, bloqueado): el botón no sale.
      this.visible = false;
    }
  }
}
