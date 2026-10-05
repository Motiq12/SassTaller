import { Component, OnInit, inject } from '@angular/core';
import { AuthService } from '../services/auth.service';
import { CuentaService } from '../services/cuenta.service';
import { ToastService } from '../services/toast.service';

/**
 * "Confirmá tu correo", sin bloquear nada.
 *
 * El correo del dueño es la única vía para recuperar la contraseña y para que Motiq
 * avise del fin de la prueba, y hasta ahora se aceptaba sin comprobarlo: un dedazo al
 * registrarse dejaba la cuenta incomunicada y nadie se enteraba hasta el día que hacía
 * falta.
 *
 * Deliberadamente NO es una pantalla intermedia. Mandar a alguien a revisar su bandeja
 * antes de dejarlo ver el producto que acaba de registrar es la fricción que este
 * trabajo vino a sacar. Es un aviso, se puede ignorar, y el sistema funciona igual.
 */
@Component({
  selector: 'app-correo-aviso',
  standalone: false,
  template: `
    <div class="aviso" *ngIf="mostrar">
      <ion-icon name="mail-outline"></ion-icon>

      <div class="cuerpo">
        <strong>Confirmá tu correo</strong>
        <span *ngIf="!pidiendoCodigo">Es con el que vas a recuperar tu contraseña si la perdés.</span>

        <div class="canje" *ngIf="pidiendoCodigo">
          <ion-input class="campo" type="text" inputmode="numeric" maxlength="6"
                     placeholder="6 dígitos" [(ngModel)]="codigo"
                     (keyup.enter)="confirmar()" aria-label="Código de verificación"></ion-input>
          <ion-button size="small" [disabled]="codigo.length < 6 || trabajando" (click)="confirmar()">
            Confirmar
          </ion-button>
          <ion-button size="small" fill="clear" [disabled]="trabajando" (click)="enviar()">
            Reenviar
          </ion-button>
        </div>
      </div>

      <ion-button size="small" fill="outline" *ngIf="!pidiendoCodigo"
                  [disabled]="trabajando" (click)="enviar()">
        Mandame el código
      </ion-button>
    </div>
  `,
  styles: [`
    .aviso {
      display: flex; align-items: center; gap: 12px;
      padding: 12px 16px; margin: 0 0 16px; border-radius: 14px;
      background: rgba(129, 140, 248, .10);
      border: 1px solid rgba(129, 140, 248, .28);
    }
    ion-icon { font-size: 22px; flex: 0 0 auto; opacity: .9; }
    .cuerpo { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
    .cuerpo strong { font-size: 14px; }
    .cuerpo > span { font-size: 13px; opacity: .75; }
    .canje { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 6px; }
    .campo {
      max-width: 130px; --padding-start: 10px; --padding-end: 10px;
      border: 1px solid rgba(255,255,255,.15); border-radius: 10px;
      letter-spacing: .25em; font-size: 15px;
    }
    @media (max-width: 560px) {
      .aviso { flex-wrap: wrap; }
    }
  `],
})
export class CorreoAvisoComponent implements OnInit {
  private auth = inject(AuthService);
  private cuenta = inject(CuentaService);
  private toast = inject(ToastService);

  verificado: boolean | null = null;
  pidiendoCodigo = false;
  codigo = '';
  trabajando = false;

  ngOnInit(): void {
    this.cuenta.correoVerificado$.subscribe(v => { this.verificado = v; });
    if (this.cuenta.actual === null) this.cuenta.cargar().subscribe();
  }

  // Mientras no se sepa (null) no se muestra nada: un aviso que aparece y desaparece
  // al segundo de cargar la pantalla es peor que no ponerlo.
  get mostrar(): boolean { return this.verificado === false; }

  enviar(): void {
    this.trabajando = true;
    this.auth.enviarCodigoCorreo().subscribe({
      next: r => { this.trabajando = false; this.pidiendoCodigo = true; this.toast.success(r.message); },
      error: e => { this.trabajando = false; this.toast.error(e?.error?.error || 'No se pudo enviar el código'); },
    });
  }

  confirmar(): void {
    this.trabajando = true;
    this.auth.confirmarCorreo(this.codigo.trim()).subscribe({
      next: r => {
        this.trabajando = false;
        this.cuenta.marcarCorreoVerificado();   // el aviso se va solo, sin recargar
        this.toast.success(r.message);
      },
      error: e => {
        this.trabajando = false;
        this.codigo = '';
        this.toast.error(e?.error?.error || 'No se pudo confirmar');
      },
    });
  }
}
