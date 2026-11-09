import { AfterViewInit, Component, ElementRef, OnDestroy, OnInit, ViewChild, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { LoadingController, ToastController } from '@ionic/angular';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { PortalService, RespuestaGoogle } from '../../services/portal.service';
import { emailValido } from '../../utils/validar';
import { marcarCampo } from '../../shared/errores';
import { MarcaService } from '../../services/marca.service';
import { montarTurnstile, turnstileHabilitado, TurnstileWidget } from '../../shared/turnstile.util';

@Component({
  standalone: false,
  selector: 'app-portal-registro',
  templateUrl: './portal-registro.page.html',
  styleUrls: ['./portal-login.page.scss'],
})
export class PortalRegistroPage implements OnInit, AfterViewInit, OnDestroy {
  private destroy$ = new Subject<void>();
  /** Sin taller, la pantalla se viste de Motiq (theme/acceso-producto.scss). */
  readonly marca = inject(MarcaService);
  nombre = '';
  apellido = '';
  telefono = '';
  email = '';
  cedula = '';
  password = '';
  confirmar = '';
  verPass = false;
  verConfirmar = false;

  // Anti-bot: honeypot (debe quedar vacío) + captcha Turnstile.
  website = '';
  mostrarCaptcha = turnstileHabilitado();
  @ViewChild('tsBox') tsBox?: ElementRef<HTMLElement>;
  private ts?: TurnstileWidget;

  // Paso 2: confirmar el correo con el código de 6 dígitos que se manda al crear la cuenta.
  paso: 1 | 2 = 1;
  // El paso 1 va en dos partes cortas: tus datos (4 campos) y tu acceso (3). Para la
  // persona son tres pasos: datos, acceso y código.
  parte: 1 | 2 = 1;
  codigo = '';
  verificando = false;
  reenviando = false;
  cooldown = 0;
  private timer?: any;

  constructor(
    private portal: PortalService,
    private router: Router,
    private route: ActivatedRoute,
    private loading: LoadingController,
    private toast: ToastController
  ) {}

  // Si venís del login porque tu cuenta existe pero no está verificada
  // (?verificar=1&email=...), saltamos directo al paso 2 con un código fresco.
  ngOnInit() {
    // Viene de "Continuar con Google" en Entrar, sin cuenta todavía.
    const desdeEntrar = history.state?.google as RespuestaGoogle | undefined;
    if (desdeEntrar?.requiere_datos) this.usarPaseGoogle(desdeEntrar);

    const qp = this.route.snapshot.queryParamMap;
    if (qp.get('verificar') === '1' && qp.get('email')) {
      this.email = qp.get('email')!;
      this.paso = 2;
      this.reenviar();
    }
  }

  async ngAfterViewInit() {
    if (this.tsBox) this.ts = await montarTurnstile(this.tsBox.nativeElement);
  }

  get numeroPaso(): number { return this.paso === 2 ? 3 : this.parte; }
  get nombrePaso(): string { return ['Tus datos', 'Tu acceso', 'Tu correo'][this.numeroPaso - 1]; }

  get datosOk(): boolean {
    return !!(this.nombre.trim() && this.apellido.trim() && this.telefono.trim() && this.cedula.trim());
  }
  get passLarga(): boolean { return this.password.length >= 8; }
  get coinciden(): boolean { return !!this.confirmar && this.password === this.confirmar; }

  // Con Google no hay paso de acceso: los datos y listo.
  siguiente() {
    if (!this.datosOk) return;
    if (this.google) this.completarGoogle();
    else this.parte = 2;
  }

  // ── Crear la cuenta con Google ──
  // Llega del botón de esta pantalla, o de Entrar (con el pase en el estado de la ruta).
  google: { pase: string; email: string } | null = null;
  creandoConGoogle = false;

  private usarPaseGoogle(d: RespuestaGoogle) {
    if (!d.pase_google || !d.email) return;
    this.google = { pase: d.pase_google, email: d.email };
    this.email = d.email;
    if (!this.nombre.trim()) this.nombre = d.nombre || '';
    if (!this.apellido.trim()) this.apellido = d.apellido || '';
    this.parte = 1;
  }

  async conGoogle(credential: string) {
    const l = await this.loading.create({ message: 'Comprobando con Google...', cssClass: 'portal-loading', spinner: 'crescent' });
    await l.present();
    this.portal.conGoogle(credential).pipe(takeUntil(this.destroy$)).subscribe({
      next: async (d) => {
        await l.dismiss();
        // Ya tenía cuenta: entra directo.
        if (d.token) { this.router.navigate(['/portal'], { replaceUrl: true }); return; }
        if (d.requiere_datos) this.usarPaseGoogle(d);
      },
      error: async () => { await l.dismiss(); },
    });
  }

  private async completarGoogle() {
    if (!this.google || this.creandoConGoogle) return;
    this.creandoConGoogle = true;
    const l = await this.loading.create({ message: 'Creando tu cuenta...', cssClass: 'portal-loading', spinner: 'crescent' });
    await l.present();
    this.portal.completarGoogle({
      pase_google: this.google.pase, nombre: this.nombre.trim(), apellido: this.apellido.trim(),
      telefono: this.telefono.trim(), cedula: this.cedula.trim(),
    }).pipe(takeUntil(this.destroy$)).subscribe({
      next: async () => {
        await l.dismiss();
        this.creandoConGoogle = false;
        this.mostrar('¡Listo! Ya tienes tu cuenta');
        this.router.navigate(['/portal'], { replaceUrl: true });
      },
      error: async (err) => {
        await l.dismiss();
        this.creandoConGoogle = false;
        // Pase vencido (15 min): se vuelve a empezar con el botón.
        if (err.status === 401) this.google = null;
      },
    });
  }

  dejarGoogle() { this.google = null; this.email = ''; }

  get valido(): boolean {
    return !!(this.nombre.trim() && this.apellido.trim() && this.telefono.trim() && this.cedula.trim() &&
      emailValido(this.email) && this.password.length >= 8 && this.password === this.confirmar);
  }

  async registrar() {
    if (!this.valido) {
      if (this.email.trim() && !emailValido(this.email)) return this.mostrar('Ingresa un correo válido', 'warning');
      if (!this.cedula.trim()) return this.mostrar('La cédula es requerida', 'warning');
      if (this.password && this.password.length < 8) return this.mostrar('La contraseña debe tener al menos 8 caracteres', 'warning');
      if (this.password !== this.confirmar) return this.mostrar('Las contraseñas no coinciden', 'warning');
      return;
    }
    const l = await this.loading.create({ message: 'Creando tu cuenta...', cssClass: 'portal-loading', spinner: 'crescent' });
    await l.present();
    this.portal.registro({
      nombre: this.nombre.trim(), apellido: this.apellido.trim(), telefono: this.telefono.trim(),
      email: this.email.trim(), cedula: this.cedula.trim(), password: this.password,
      website: this.website, turnstileToken: this.ts?.token() || '',
    }).pipe(takeUntil(this.destroy$)).subscribe({
      next: async () => {
        await l.dismiss();
        this.paso = 2;
        this.iniciarCooldown();
        this.mostrar('Te enviamos un código para confirmar tu correo');
      },
      error: async (err) => {
        await l.dismiss();
        this.ts?.reset();   // token de un solo uso: pedir uno nuevo para el próximo intento
        // Si el problema es de un dato del primer paso (la cédula ya usada, el
        // teléfono), se vuelve ahí y se marca: en este paso ese campo no está.
        const campo = err.error?.campo;
        if (['nombre', 'apellido', 'telefono', 'cedula'].includes(campo)) {
          this.parte = 1;
          setTimeout(() => marcarCampo(campo, err.error?.error || 'Revisa este dato'), 80);
        }
        this.mostrar(err.error?.error || 'No se pudo crear la cuenta', 'danger');
      },
    });
  }

  // Confirma el código y entra (el backend ya guarda la sesión vía guardarSesion).
  async verificar() {
    if (!this.codigo || this.codigo.trim().length < 4 || this.verificando) return;
    this.verificando = true;
    this.portal.verificarRegistro(this.email.trim(), this.codigo.trim()).pipe(takeUntil(this.destroy$)).subscribe({
      next: async () => {
        this.verificando = false;
        this.mostrar('¡Cuenta confirmada!');
        this.router.navigate(['/portal'], { replaceUrl: true });
      },
      error: async (err) => {
        this.verificando = false;
        this.codigo = '';
        this.mostrar(err.error?.error || 'Código inválido o expirado', 'danger');
      },
    });
  }

  reenviar() {
    if (this.cooldown > 0 || this.reenviando) return;
    this.reenviando = true;
    this.portal.reenviarVerificacion(this.email.trim()).pipe(takeUntil(this.destroy$)).subscribe({
      next: async () => { this.reenviando = false; this.iniciarCooldown(); this.mostrar('Te enviamos un código nuevo'); },
      error: async (err) => { this.reenviando = false; this.mostrar(err.error?.error || 'No se pudo reenviar', 'danger'); },
    });
  }

  private iniciarCooldown() {
    this.cooldown = 30;
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => {
      this.cooldown--;
      if (this.cooldown <= 0) clearInterval(this.timer);
    }, 1000);
  }

  ngOnDestroy() {
    this.destroy$.next(); this.destroy$.complete(); this.ts?.destroy();
    if (this.timer) clearInterval(this.timer);
  }

  private async mostrar(message: string, color = 'success') {
    const t = await this.toast.create({ message, duration: 2500, color });
    await t.present();
  }
}
