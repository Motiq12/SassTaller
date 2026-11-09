import { Component, ElementRef, OnInit, OnDestroy, ViewChild, inject } from '@angular/core';
import { MarcaService } from '../../services/marca.service';
import { ActivatedRoute, Router } from '@angular/router';
import { TallerService } from '../../services/taller.service';
import { LoadingController, ToastController } from '@ionic/angular';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { PortalService } from '../../services/portal.service';
import { AuthService } from '../../services/auth.service';
import { BiometriaService } from '../../services/biometria.service';
import { emailValido } from '../../shared/utils/validar.util';
import { montarTurnstile, turnstileHabilitado, TurnstileWidget } from '../../shared/utils/turnstile.util';

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
  private route = inject(ActivatedRoute);
  private taller = inject(TallerService);

  /**
   * Por dónde entra: el personal de un taller o un cliente. Es la misma autenticación
   * (login unificado); lo que cambia es lo que se le ofrece a cada uno. Se recuerda en
   * el navegador y se puede fijar con ?como=taller|cliente.
   */
  camino: 'taller' | 'cliente' | null = null;
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

  // Se enciende cuando el ingreso es rechazado y se apaga solo. Sacude el formulario:
  // el aviso sale en un toast abajo, lejos de donde está mirando quien acaba de
  // escribir, y con el sacudón se entiende que falló antes de leer nada.
  fallo = false;

  // Anti-bot para el pedido de código OTP: honeypot + captcha Turnstile.
  website = '';
  mostrarCaptcha = turnstileHabilitado();
  private ts?: TurnstileWidget;
  // El contenedor aparece recién al entrar al modo "código", así que lo montamos
  // vía setter cuando el elemento existe en el DOM (no en ngAfterViewInit).
  @ViewChild('tsBox') set tsBox(el: ElementRef<HTMLElement> | undefined) {
    if (el && !this.ts) montarTurnstile(el.nativeElement).then(w => (this.ts = w));
  }

  elegirCamino(c: 'taller' | 'cliente') {
    this.camino = c;
    if (c === 'taller') this.modo = 'clave';   // el código por correo es solo de clientes
    try { localStorage.setItem(CLAVE_CAMINO, c); } catch { /* modo privado */ }
  }

  cambiarCamino() {
    this.camino = null;
    this.modo = 'clave';
    try { localStorage.removeItem(CLAVE_CAMINO); } catch { /* modo privado */ }
  }

  ngOnInit() {
    const pedido = this.route.snapshot.queryParamMap.get('como');
    let guardado: string | null = null;
    try { guardado = localStorage.getItem(CLAVE_CAMINO); } catch { /* modo privado */ }
    const c = pedido || guardado;
    if (c === 'taller' || c === 'cliente') this.camino = c;

    // Si ya hay una sesión activa, mandamos a la zona que corresponde.
    if (this.portal.isLoggedIn()) this.router.navigate(['/portal'], { replaceUrl: true });
    else if (this.auth.isLoggedIn()) this.router.navigate([this.rutaStaff()], { replaceUrl: true });
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

  // Cada rol arranca en su panel: técnico y recepción tienen el suyo; el resto, el dashboard.
  private rutaStaff(): string {
    const rol = this.auth.getUsuario()?.rol;
    if (rol === 'tecnico') return '/mecanico';
    if (rol === 'recepcion') return '/recepcion';
    return '/tabs';
  }

  async ingresar() {
    if (!this.email || !this.password) return;
    if (!emailValido(this.email)) {
      const t = await this.toast.create({ message: 'Ingresá un correo válido', duration: 2500, color: 'warning' });
      return await t.present();
    }
    const l = await this.loading.create({ message: 'Ingresando...', cssClass: 'portal-loading', spinner: 'crescent' });
    await l.present();
    this.auth.loginUnificado(this.email.trim(), this.password).pipe(takeUntil(this.destroy$)).subscribe({
      next: async (res) => {
        await l.dismiss();
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
          this.router.navigate([this.rutaStaff()], { replaceUrl: true });
        } else if (res.data.cliente && res.data.token) {
          this.portal.aplicarSesion(res.data.token, res.data.cliente);
          await this.ofrecerBiometria(cred.email, cred.password);
          this.router.navigate(['/portal'], { replaceUrl: true });
        }
      },
      error: async (err) => {
        await l.dismiss();
        this.sacudir();
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
        this.router.navigate([this.rutaStaff()], { replaceUrl: true });
      },
      error: async (err) => {
        this.verificando2fa = false;
        this.codigo2fa = '';
        this.sacudir();
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

  // Marca el formulario como rechazado y lo desmarca cuando termina la animación,
  // para que el siguiente intento fallido vuelva a dispararla. Sin apagarlo, la
  // clase queda puesta y el segundo error no se nota.
  private sacudir() {
    this.fallo = false;
    // En el mismo tick Angular no ve el cambio y la animación no se reinicia.
    setTimeout(() => {
      this.fallo = true;
      setTimeout(() => (this.fallo = false), 500);
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
      const t = await this.toast.create({ message: 'Ingresá un correo válido', duration: 2500, color: 'warning' });
      return await t.present();
    }
    this.procesandoCodigo = true;
    this.portal.solicitarCodigoLogin(this.email.trim(), { website: this.website, turnstileToken: this.ts?.token() || '' })
      .pipe(takeUntil(this.destroy$)).subscribe({
      next: async () => {
        this.procesandoCodigo = false;
        this.codigoEnviado = true;
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

const CLAVE_CAMINO = 'motiq_acceso_camino';
