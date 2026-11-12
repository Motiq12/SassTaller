import { Component, ElementRef, OnInit, OnDestroy, ViewChild, inject } from '@angular/core';
import { MarcaService } from '../../services/marca.service';
import { Router } from '@angular/router';
import { TallerService } from '../../services/taller.service';
import { LoadingController, ToastController } from '@ionic/angular';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { PortalService } from '../../services/portal.service';
import { AuthService } from '../../services/auth.service';
import { BiometriaService } from '../../services/biometria.service';
import { emailValido } from '../../utils/validar';
import { sitioWeb } from '../../sitio-web-activo';
import { captchaActivo, montarTurnstile, TurnstileWidget } from '../../shared/turnstile.util';

@Component({
  standalone: false,
  selector: 'app-portal-login',
  templateUrl: './portal-login.page.html',
  styleUrls: ['./portal-login.page.scss'],
})
export class PortalLoginPage implements OnInit, OnDestroy {
  private portal = inject(PortalService);
  private auth = inject(AuthService);
  private bio = inject(BiometriaService);
  private router = inject(Router);
  private loading = inject(LoadingController);
  private toast = inject(ToastController);
  marca = inject(MarcaService);
  private taller = inject(TallerService);

  /** Si el correo está en varios talleres, a cuál entrar. Solo después de validar la contraseña. */
  opciones: { nombre: string; slug: string }[] = [];
  /** Hay un taller resuelto (subdominio o ?taller=): las rutas de cliente funcionan. */
  get conTaller(): boolean { return !!this.taller.actual(); }

  private destroy$ = new Subject<void>();
  email = '';
  password = '';
  verPass = false;
  bioActivado = false;   // hay credenciales guardadas → mostrar botón de huella

  // Ingreso sin contraseña (OTP por correo). Solo para clientes.
  modo: 'clave' | 'codigo' = 'clave';
  codigo = '';
  codigoEnviado = false;   // ya se pidió el código → mostrar el campo para escribirlo
  procesandoCodigo = false;

  // Verificación en dos pasos del personal: la contraseña fue correcta pero falta
  // el código de la app de autenticación. Guardamos el token parcial para canjearlo.
  paso2fa = false;
  tokenParcial = '';
  codigo2fa = '';
  verificando2fa = false;

  // Anti-bot para el pedido de código OTP: honeypot + captcha Turnstile.
  website = '';
  // Empieza en false y se enciende cuando el servidor dice que el captcha está activo.
  mostrarCaptcha = false;
  private readonly pedirCaptcha = captchaActivo().then(v => (this.mostrarCaptcha = v));
  private ts?: TurnstileWidget;
  // El contenedor aparece recién al entrar al modo "código", así que lo montamos
  // vía setter cuando el elemento existe en el DOM (no en ngAfterViewInit).
  @ViewChild('tsBox') set tsBox(el: ElementRef<HTMLElement> | undefined) {
    if (!el) { this.ts?.destroy(); this.ts = undefined; return; }
    if (!this.ts) montarTurnstile(el.nativeElement).then(w => (this.ts = w));
  }

  elegirTaller(slug: string) { this.ingresar(slug); }
  cancelarOpciones() { this.opciones = []; this.password = ''; }

  ngOnInit() {
    // Si ya hay una sesión activa, mandamos a la zona que corresponde.
    if (this.portal.isLoggedIn()) this.router.navigate(['/portal'], { replaceUrl: true });
    else if (this.auth.isLoggedIn()) this.irStaff();
    // ¿Está activado el ingreso biométrico en este dispositivo? (solo nativo)
    this.bio.activado().then(v => (this.bioActivado = v));
  }

  // Login con huella / Face ID: pide biometría, recupera credenciales y entra.
  async ingresarConBiometria() {
    try {
      const cred = await this.bio.obtener();
      if (!cred) return;
      this.email = cred.email;
      this.password = cred.password;
      await this.ingresar();
    } catch {
      /* el usuario canceló o falló la biometría: no hacemos nada */
    }
  }

  // Tras un login exitoso en nativo, ofrece guardar el acceso para la próxima vez.
  private async ofrecerBiometria(email: string, password: string) {
    if (this.bioActivado) return;
    if (!(await this.bio.disponible())) return;
    const t = await this.toast.create({
      message: '¿Activar ingreso con huella/Face ID para la próxima vez?',
      buttons: [
        { text: 'No', role: 'cancel' },
        { text: 'Activar', handler: async () => { try { await this.bio.activar(email, password); } catch {} } },
      ],
      duration: 6000,
      color: 'dark',
    });
    await t.present();
  }

  // Con el sitio web en pausa, quien tiene solo el rol Contenido no tiene a dónde
  // entrar: se le explica y se cierra la sesión, en vez de devolverlo a esta
  // pantalla sin decir nada.
  private async irStaff() {
    if (!sitioWeb.activo && this.auth.getUsuario()?.rol === 'contenido') {
      this.auth.logout();
      const t = await this.toast.create({
        message: 'El sitio web está pausado por ahora, y tu usuario solo tiene esa sección.',
        duration: 4000,
        color: 'warning',
      });
      await t.present();
      return;
    }
    this.router.navigate([this.rutaStaff()], { replaceUrl: true });
  }

  // Cada rol arranca en su panel: técnico y recepción tienen el suyo; el resto, el
  // dashboard. Si eligió otra pantalla de inicio en Mi perfil (de su panel), esa.
  private rutaStaff(): string {
    const u = this.auth.getUsuario();
    const rol = u?.rol;
    const inicio = u?.preferencias?.inicio || '';
    if (rol === 'tecnico') return inicio.startsWith('/mecanico/') ? inicio : '/mecanico';
    if (rol === 'recepcion') return inicio.startsWith('/recepcion/') ? inicio : '/recepcion';
    if (rol === 'admin' && inicio.startsWith('/admin/')) return inicio;
    // Contenido solo administraba el sitio web, hoy apagado; irStaff lo saca antes.
    if (rol === 'contenido') return '/admin';
    return '/tabs';
  }

  // Continuar con Google: si la cuenta existe, entra; si no, va a crear cuenta con
  // lo que dio Google, donde solo faltan teléfono y cédula.
  async conGoogle(credential: string) {
    const l = await this.loading.create({ message: 'Entrando con Google...', cssClass: 'portal-loading', spinner: 'crescent' });
    await l.present();
    this.portal.conGoogle(credential).pipe(takeUntil(this.destroy$)).subscribe({
      next: async (d) => {
        await l.dismiss();
        if (d.token) this.router.navigate(['/portal'], { replaceUrl: true });
        else if (d.requiere_datos) this.router.navigate(['/portal/registro'], { state: { google: d } });
      },
      // El aviso con el motivo lo pone el interceptor de errores.
      error: async () => { await l.dismiss(); },
    });
  }

  async ingresar(elegido?: string) {
    if (!this.email || !this.password) return;
    if (!emailValido(this.email)) {
      const t = await this.toast.create({ message: 'Ingresa un correo válido', duration: 2500, color: 'warning' });
      return await t.present();
    }
    const l = await this.loading.create({ message: 'Ingresando...', cssClass: 'portal-loading', spinner: 'crescent' });
    await l.present();
    this.auth.loginUnificado(this.email.trim(), this.password, elegido).pipe(takeUntil(this.destroy$)).subscribe({
      next: async (res) => {
        await l.dismiss();
        this.opciones = [];
        // Se recuerda de qué taller es: su marca, y a cuál entrar si tiene varios.
        if (res.data.taller?.slug) this.taller.fijar(res.data.taller.slug);
        const cred = { email: this.email.trim(), password: this.password };
        // Personal con verificación en dos pasos: todavía no hay sesión, falta el código.
        if (res.data.requiere_2fa && res.data.token_parcial) {
          this.tokenParcial = res.data.token_parcial;
          this.paso2fa = true;
          this.codigo2fa = '';
          return;
        }
        if (res.data.tipo === 'staff' && res.data.usuario && res.data.token) {
          this.auth.aplicarSesionStaff(res.data.token, res.data.usuario);
          await this.ofrecerBiometria(cred.email, cred.password);
          this.irStaff();
        } else if (res.data.cliente && res.data.token) {
          this.portal.aplicarSesion(res.data.token, res.data.cliente);
          await this.ofrecerBiometria(cred.email, cred.password);
          this.router.navigate(['/portal'], { replaceUrl: true });
        }
      },
      error: async (err) => {
        await l.dismiss();
        if (err.status === 409 && Array.isArray(err.error?.talleres)) {
          this.opciones = err.error.talleres;
          return;
        }
        const t = await this.toast.create({
          message: err.error?.error || 'No se pudo iniciar sesión',
          duration: 2500,
          color: 'danger',
        });
        await t.present();
        // Cuenta creada pero con el correo sin confirmar: la mandamos a completar
        // ese paso (la pantalla de registro pide un código nuevo al abrirse).
        if (err.status === 403 && err.error?.requiere_verificacion) {
          this.router.navigate(['/portal/registro'], { queryParams: { verificar: '1', email: this.email.trim() } });
        }
      },
    });
  }

  // Canjea el código de la app de autenticación (o uno de respaldo) por la sesión.
  async verificar2fa() {
    const codigo = this.codigo2fa.trim();
    if (!codigo || this.verificando2fa) return;
    this.verificando2fa = true;
    this.auth.verificar2FA(this.tokenParcial, codigo).pipe(takeUntil(this.destroy$)).subscribe({
      next: async (res) => {
        this.verificando2fa = false;
        this.auth.aplicarSesionStaff(res.data.token, res.data.usuario);
        this.irStaff();
      },
      error: async (err) => {
        this.verificando2fa = false;
        this.codigo2fa = '';
        // Si venció el token parcial (5 min), hay que empezar el login de nuevo.
        if (err.status === 401) this.cancelar2fa();
        const t = await this.toast.create({
          message: err.error?.error || 'Código incorrecto',
          duration: 2800, color: 'danger',
        });
        await t.present();
      },
    });
  }

  // Vuelve al formulario de contraseña (descarta el intento a medias).
  cancelar2fa() {
    this.paso2fa = false;
    this.tokenParcial = '';
    this.codigo2fa = '';
    this.password = '';
  }

  // Cambia entre "contraseña" y "código al correo".
  usarCodigo() { this.modo = 'codigo'; this.codigoEnviado = false; this.codigo = ''; }
  usarClave() { this.modo = 'clave'; }

  // Paso 1 del OTP: pide el código al correo. Respuesta genérica (no revela si la cuenta existe).
  async enviarCodigo() {
    if (!emailValido(this.email)) {
      const t = await this.toast.create({ message: 'Ingresa un correo válido', duration: 2500, color: 'warning' });
      return await t.present();
    }
    this.procesandoCodigo = true;
    const turnstileToken = this.ts ? await this.ts.listo() : '';
    this.portal.solicitarCodigoLogin(this.email.trim(), { website: this.website, turnstileToken })
      .pipe(takeUntil(this.destroy$)).subscribe({
      next: async () => {
        this.procesandoCodigo = false;
        this.codigoEnviado = true;
        this.ts?.reset();   // token de un solo uso: otro listo para "Reenviar código"
        const t = await this.toast.create({ message: 'Si tu correo está registrado, te enviamos un código', duration: 3000, color: 'success' });
        await t.present();
      },
      error: async (err) => {
        this.procesandoCodigo = false;
        this.ts?.reset();
        const t = await this.toast.create({ message: err.error?.error || 'No se pudo enviar el código', duration: 2500, color: 'danger' });
        await t.present();
      },
    });
  }

  // Paso 2 del OTP: valida el código y entra al portal.
  async ingresarConCodigo() {
    if (!this.codigo || this.codigo.trim().length < 4) return;
    const l = await this.loading.create({ message: 'Ingresando...', cssClass: 'portal-loading', spinner: 'crescent' });
    await l.present();
    this.portal.verificarCodigoLogin(this.email.trim(), this.codigo.trim()).pipe(takeUntil(this.destroy$)).subscribe({
      next: async () => {
        await l.dismiss();
        this.router.navigate(['/portal'], { replaceUrl: true });
      },
      error: async (err) => {
        await l.dismiss();
        const t = await this.toast.create({ message: err.error?.error || 'Código inválido o expirado', duration: 2500, color: 'danger' });
        await t.present();
      },
    });
  }

  ngOnDestroy() { this.destroy$.next(); this.destroy$.complete(); this.ts?.destroy(); }
}
