import { Component, ElementRef, OnDestroy, ViewChild, inject } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { MarcaService } from '../../services/marca.service';
import { LoadingController, ToastController } from '@ionic/angular';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { emailValido } from '../../utils/validar';
import { captchaActivo, montarTurnstile, TurnstileWidget } from '../../shared/turnstile.util';

@Component({
  standalone: false,
  selector: 'app-portal-recuperar',
  templateUrl: './portal-recuperar.page.html',
  styleUrls: ['./portal-login.page.scss'],
})
export class PortalRecuperarPage implements OnDestroy {
  private router = inject(Router);
  private auth = inject(AuthService);
  /** Sin taller, la pantalla se viste de Motiq (theme/acceso-producto.scss). */
  readonly marca = inject(MarcaService);

  private loading = inject(LoadingController);
  private toast = inject(ToastController);

  private destroy$ = new Subject<void>();
  paso: 1 | 2 = 1;
  email = '';
  codigo = '';
  password = '';
  confirmar = '';

  verPass = false;
  verConfirmar = false;

  cooldown = 0;
  private timer?: any;

  // Anti-bot para el pedido de código: honeypot + captcha Turnstile.
  website = '';
  // Empieza en false y se enciende cuando el servidor dice que el captcha está activo.
  // El cuadro aparece después, así que se monta con un setter, cuando existe en el DOM.
  mostrarCaptcha = false;
  private readonly pedirCaptcha = captchaActivo().then(v => (this.mostrarCaptcha = v));
  private ts?: TurnstileWidget;
  @ViewChild('tsBox') set tsBox(el: ElementRef<HTMLElement> | undefined) {
    if (!el) { this.ts?.destroy(); this.ts = undefined; return; }
    if (!this.ts) montarTurnstile(el.nativeElement).then(w => (this.ts = w));
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
    if (this.timer) clearInterval(this.timer);
    this.ts?.destroy();
  }

  get emailOk(): boolean {
    return emailValido(this.email);
  }

  get validoPaso2(): boolean {
    return !!(this.codigo.trim().length === 6 &&
      this.password.length >= 8 && this.password === this.confirmar);
  }

  async solicitar() {
    if (!this.emailOk) return this.mostrar('Ingresa un correo válido', 'warning');
    const l = await this.loading.create({ message: 'Enviando código...', cssClass: 'portal-loading', spinner: 'crescent' });
    await l.present();
    const antibot = { website: this.website, turnstileToken: this.ts ? await this.ts.listo() : '' };
    this.auth.solicitarRecuperacion(this.email.trim(), antibot).pipe(takeUntil(this.destroy$)).subscribe({
      next: async (res) => {
        await l.dismiss();
        this.paso = 2;
        this.ts?.reset();   // deja un token fresco listo por si el usuario reenvía
        this.iniciarCooldown();
        this.mostrar(res.message || 'Si la cuenta existe, te enviamos un código');
      },
      error: async (err) => {
        await l.dismiss();
        this.ts?.reset();
        this.mostrar(err.error?.error || 'No se pudo enviar el código', 'danger');
      },
    });
  }

  async reenviar() {
    if (this.cooldown > 0) return;
    await this.solicitar();
  }

  async confirmar_() {
    if (!this.validoPaso2) {
      if (this.codigo.trim().length !== 6) return this.mostrar('El código tiene 6 dígitos', 'warning');
      if (this.password.length < 8) return this.mostrar('La contraseña debe tener al menos 8 caracteres', 'warning');
      if (this.password !== this.confirmar) return this.mostrar('Las contraseñas no coinciden', 'warning');
      return;
    }
    const l = await this.loading.create({ message: 'Verificando...', cssClass: 'portal-loading', spinner: 'crescent' });
    await l.present();
    const datos = { email: this.email.trim(), codigo: this.codigo.trim(), password: this.password };
    // No abre sesión: se vuelve al login, donde se pide la verificación en dos pasos si la hay.
    this.auth.confirmarRecuperacion(datos).pipe(takeUntil(this.destroy$)).subscribe({
      next: async (res) => {
        await l.dismiss();
        this.mostrar(res.message || 'Contraseña actualizada');
        this.router.navigate(['/portal/login'], { replaceUrl: true });
      },
      error: async (err) => {
        await l.dismiss();
        this.mostrar(err.error?.error || 'No se pudo restablecer la contraseña', 'danger');
      },
    });
  }

  irLogin() {
    this.router.navigate(['/portal/login']);
  }

  private iniciarCooldown() {
    this.cooldown = 60;
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => {
      this.cooldown--;
      if (this.cooldown <= 0) clearInterval(this.timer);
    }, 1000);
  }

  private async mostrar(message: string, color = 'success') {
    const t = await this.toast.create({ message, duration: 2600, color });
    await t.present();
  }
}
