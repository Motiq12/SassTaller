import { Component, ElementRef, ViewChild, inject } from '@angular/core';
import { Subject, debounceTime, switchMap, catchError, of } from 'rxjs';
import { TallerService, TipoVehiculo } from '../../services/taller.service';
import { AuthService } from '../../services/auth.service';
import { ToastService } from '../../services/toast.service';
import { PRODUCTO } from '../../shared/producto';

/**
 * Alta de un taller nuevo en el SaaS. Es la puerta de entrada del producto: antes de
 * esto, dar de alta un taller requería un INSERT a mano en la base.
 *
 * El identificador (slug) se valida contra el servidor mientras se escribe. Hacerlo
 * al enviar sería peor de lo que parece: el formulario tiene contraseña, así que un
 * choque de nombre obligaría a rellenarla, y el nombre es justo el campo que más
 * probablemente esté tomado.
 *
 * Va en dos pasos —el taller, la cuenta del dueño— y un cierre: el taller ya creado,
 * la confirmación del correo (sin bloquear: también se puede hacer desde el panel) y
 * los primeros pasos de la configuración.
 */
@Component({
  selector: 'app-registro-taller',
  templateUrl: './registro-taller.page.html',
  styleUrls: ['./registro-taller.page.scss'],
  standalone: false,
})
export class RegistroTallerPage {
  private taller = inject(TallerService);
  private auth = inject(AuthService);
  private toast = inject(ToastService);

  /** 1: el taller · 2: la cuenta del dueño · 3: creado. */
  paso: 1 | 2 | 3 = 1;
  @ViewChild('encabezado') set encabezado(el: ElementRef<HTMLElement> | undefined) {
    // Al cambiar de paso el foco va al título del paso nuevo: quien usa lector de
    // pantalla o teclado no queda parado en un botón que ya no existe.
    if (el && this.moverFoco) { this.moverFoco = false; setTimeout(() => el.nativeElement.focus()); }
  }
  private moverFoco = false;

  // Esta pantalla identifica al PRODUCTO, no a un taller: quien la abre todavía no
  // pertenece a ninguno.
  producto = PRODUCTO;

  // Datos del taller
  nombre = '';
  slug = '';
  slugEditado = false;      // si el usuario lo tocó, deja de derivarse del nombre
  telefono = '';
  direccion = '';

  // La marca: se ve desde el primer minuto en el panel, en el portal de sus clientes,
  // en las facturas y en los correos. Opcional: se puede poner después.
  logo: string | null = null;
  errorLogo = '';
  color = '#e11d48';
  readonly colores = ['#e11d48', '#c2410c', '#a16207', '#15803d', '#0f766e', '#1d4ed8', '#6d28d9', '#27272a'];

  // Para sus facturas. Opcional.
  razonSocial = '';
  cedulaJuridica = '';

  // Qué vehículos atiende. Define su catálogo de servicios inicial, los campos del
  // formulario de vehículo y cómo lo llama la interfaz. No arranca nada marcado: el
  // SaaS es para motos Y autos, y marcar motos por defecto decidía por el taller.
  tiposDisponibles: TipoVehiculo[] = [];
  // Mapa clave->marcado, para que cada checkbox tenga su propio ngModel.
  tiposMarcados: Record<string, boolean> = {};
  cargandoTipos = false;
  catalogoFallo = false;

  get tiposElegidos(): string[] {
    return Object.keys(this.tiposMarcados).filter(k => this.tiposMarcados[k]);
  }

  // Datos del dueño (primer admin)
  adminNombre = '';
  adminEmail = '';
  adminPassword = '';
  adminPassword2 = '';

  // Estado de la validación del slug
  verificando = false;
  disponible: boolean | null = null;
  motivoSlug: string | null = null;

  enviando = false;
  verClave = false;

  // Cierre: confirmar el correo del dueño (el código lo manda el servidor al crear).
  codigo = '';
  correoConfirmado = false;
  trabajandoCorreo = false;
  private slugCambiado = new Subject<string>();

  // La dirección donde vive la app (motiq12.com en producción). El portal de cada
  // taller cuelga de ahí con ?taller=<slug>, igual que el enlace de admin-portal.
  readonly dominio = window.location.host;

  /** Las iniciales del taller para el sello de la ficha: "Taller Los Andes" → "LA". */
  get iniciales(): string {
    const palabras = this.nombre.trim().split(/\s+/).filter(Boolean)
      .filter((p, i, todas) => !(todas.length > 1 && i === 0 && /^taller$/i.test(p)));
    const letras = palabras.slice(0, 2).map(p => p[0]).join('');
    return (letras || 'M').toUpperCase();
  }

  /** "Motocicletas y automóviles", según lo marcado; para la ficha. */
  get tiposTexto(): string {
    const nombres = this.tiposDisponibles
      .filter(t => this.tiposMarcados[t.clave])
      .map(t => t.plural.toLowerCase());
    if (!nombres.length) return 'Elegí qué vehículos atienden';
    const texto = nombres.length > 1
      ? `${nombres.slice(0, -1).join(', ')} y ${nombres[nombres.length - 1]}`
      : nombres[0];
    return texto.charAt(0).toUpperCase() + texto.slice(1);
  }

  get paso1Listo(): boolean {
    return !!this.nombre.trim() && this.disponible === true && this.tiposElegidos.length > 0;
  }

  /** Qué falta para pasar al paso 2, en una línea. */
  get faltaPaso1(): string {
    if (!this.nombre.trim()) return 'Falta el nombre del taller.';
    if (!this.tiposElegidos.length) return 'Elegí qué vehículos atiende.';
    if (this.verificando) return 'Verificando el identificador…';
    if (this.disponible !== true) return 'Elegí un identificador disponible.';
    return '';
  }

  /**
   * Por qué el botón sigue apagado, en una línea. Sin esto, un botón deshabilitado
   * no explica nada y la persona no sabe qué le falta completar.
   */
  get loQueFalta(): string {
    if (!this.nombre.trim()) return 'Falta el nombre del taller.';
    if (this.verificando) return 'Verificando el identificador…';
    if (this.disponible !== true) return 'Elegí un identificador disponible.';
    if (!this.tiposElegidos.length) return 'Elegí qué vehículos atienden.';
    if (!this.adminNombre.trim()) return 'Falta tu nombre.';
    if (!this.adminEmail.trim()) return 'Falta tu correo.';
    if (this.adminPassword.length < 8) return 'La contraseña necesita al menos 8 caracteres.';
    if (!this.adminPassword2) return 'Repetí la contraseña.';
    if (this.adminPassword !== this.adminPassword2) return 'Las contraseñas no coinciden.';
    return '';
  }

  constructor() {
    // Se espera a que deje de escribir antes de preguntar: sin esto, cada tecla
    // dispararía una consulta y las respuestas podrían llegar desordenadas.
    // switchMap además cancela la anterior, así que siempre gana la última.
    //
    // A propósito SIN distinctUntilChanged: `pedirVerificacion` deja `verificando`
    // en true antes de emitir, así que un valor descartado por repetido nunca
    // llegaría al suscriptor y el formulario quedaría colgado en "Verificando…"
    // para siempre, con el botón deshabilitado. Se dispara con una secuencia
    // normal: escribir un nombre, probar otro identificador y volver al anterior.
    // Además, revalidar el mismo valor es correcto: pudo ocupárselo alguien más.
    this.slugCambiado.pipe(
      debounceTime(400),
      switchMap(valor => {
        if (!valor) { this.verificando = false; return of(null); }
        return this.taller.disponible(valor).pipe(catchError(() => of(null)));
      }),
    ).subscribe(res => {
      this.verificando = false;
      if (!res) { this.disponible = null; this.motivoSlug = null; return; }
      this.slug = res.data.slug;
      this.disponible = res.data.disponible;
      this.motivoSlug = res.data.motivo;
    });

    this.cargarTipos();
  }

  /**
   * El catálogo de tipos viene del servidor. Si falla, se avisa con la opción de
   * reintentar y se ofrecen las dos opciones básicas para elegir A MANO. Antes se
   * seguía sin catálogo y el servidor ponía 'moto' en silencio.
   */
  cargarTipos(): void {
    this.cargandoTipos = true;
    this.taller.tipos().subscribe({
      next: res => {
        this.cargandoTipos = false;
        this.catalogoFallo = false;
        this.tiposDisponibles = res.data;
      },
      error: () => {
        this.cargandoTipos = false;
        this.catalogoFallo = true;
        if (!this.tiposDisponibles.length) this.tiposDisponibles = TIPOS_BASICOS;
      },
    });
  }

  // Se achica acá y no en el servidor: una foto de celular pesa varios MB, y el logo se
  // muestra en un cuadro chico. Cae a 512 px como máximo, sin deformarla.
  elegirLogo(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const archivo = input.files?.[0];
    input.value = '';
    this.errorLogo = '';
    if (!archivo) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(archivo.type)) {
      this.errorLogo = 'Elegí una imagen PNG, JPG o WebP.';
      return;
    }
    if (archivo.size > 10 * 1024 * 1024) {
      this.errorLogo = 'La imagen pesa más de 10 MB.';
      return;
    }
    const url = URL.createObjectURL(archivo);
    const img = new Image();
    img.onload = () => {
      const escala = Math.min(1, 512 / Math.max(img.width, img.height));
      const lienzo = document.createElement('canvas');
      lienzo.width = Math.max(1, Math.round(img.width * escala));
      lienzo.height = Math.max(1, Math.round(img.height * escala));
      lienzo.getContext('2d')?.drawImage(img, 0, 0, lienzo.width, lienzo.height);
      URL.revokeObjectURL(url);
      // PNG conserva el fondo transparente; si queda pesado, WebP.
      let dato = lienzo.toDataURL('image/png');
      if (dato.length > 650 * 1024) dato = lienzo.toDataURL('image/webp', 0.85);
      if (dato.length > 650 * 1024 || !dato.startsWith('data:image/')) {
        this.errorLogo = 'No pudimos achicar esa imagen. Probá con otra.';
        return;
      }
      this.logo = dato;
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      this.errorLogo = 'No pudimos abrir esa imagen.';
    };
    img.src = url;
  }

  quitarLogo(): void {
    this.logo = null;
    this.errorLogo = '';
  }

  seguir(): void {
    if (!this.paso1Listo) return;
    this.irAPaso(2);
  }

  volver(): void { this.irAPaso(1); }

  private irAPaso(n: 1 | 2 | 3): void {
    this.paso = n;
    this.moverFoco = true;
  }

  // Mientras no toque el campo, el identificador se deriva del nombre del taller:
  // es lo que quiere el 95% de los casos y evita pedirle algo que no entiende.
  onNombre(): void {
    if (!this.slugEditado) this.pedirVerificacion(this.nombre);
  }

  onSlug(): void {
    this.slugEditado = true;
    this.pedirVerificacion(this.slug);
  }

  private pedirVerificacion(valor: string): void {
    this.verificando = true;
    this.disponible = null;
    this.motivoSlug = null;
    this.slugCambiado.next((valor || '').trim());
  }

  get passwordCorta(): boolean {
    return this.adminPassword.length > 0 && this.adminPassword.length < 8;
  }

  get passwordsDistintas(): boolean {
    return this.adminPassword2.length > 0 && this.adminPassword !== this.adminPassword2;
  }

  get puedeEnviar(): boolean {
    return !!this.nombre.trim()
      && !!this.adminNombre.trim()
      && !!this.adminEmail.trim()
      && this.adminPassword.length >= 8
      && this.adminPassword === this.adminPassword2
      && this.disponible === true
      && this.tiposElegidos.length > 0
      && !this.enviando;
  }

  crear(): void {
    if (!this.puedeEnviar) return;
    this.enviando = true;

    this.taller.registrarTaller({
      nombre: this.nombre.trim(),
      slug: this.slug,
      tipos: this.tiposElegidos,
      logo: this.logo,
      color_primario: this.color,
      razon_social: this.razonSocial.trim(),
      cedula_juridica: this.cedulaJuridica.trim(),
      admin: {
        nombre: this.adminNombre.trim(),
        email: this.adminEmail.trim().toLowerCase(),
        password: this.adminPassword,
      },
      contacto: { telefono: this.telefono.trim(), direccion: this.direccion.trim() },
    }).subscribe({
      next: res => {
        // El taller queda fijado para que los próximos logins y el portal sepan
        // a cuál pertenecen, incluso sin subdominio (nativo o localhost).
        this.taller.fijar(res.data.taller.slug);
        this.auth.aplicarSesionStaff(res.data.token, res.data.usuario);
        this.enviando = false;
        // No se salta directo al panel: el cierre confirma el correo (el servidor ya
        // mandó el código) y muestra por dónde seguir.
        this.irAPaso(3);
      },
      error: err => {
        this.enviando = false;
        const msg = err?.error?.error || 'No se pudo crear el taller';
        this.toast.error(msg);
        // 409 = el identificador se ocupó entre la validación y el envío: se vuelve
        // al paso 1, que es donde está ese campo.
        if (err?.status === 409) { this.disponible = false; this.motivoSlug = msg; this.irAPaso(1); }
      },
    });
  }

  confirmarCorreo(): void {
    const codigo = this.codigo.trim();
    if (codigo.length < 6 || this.trabajandoCorreo) return;
    this.trabajandoCorreo = true;
    this.auth.confirmarCorreo(codigo).subscribe({
      next: () => { this.trabajandoCorreo = false; this.correoConfirmado = true; },
      error: e => {
        this.trabajandoCorreo = false;
        this.codigo = '';
        this.toast.error(e?.error?.error || 'No se pudo confirmar el código');
      },
    });
  }

  reenviarCodigo(): void {
    this.trabajandoCorreo = true;
    this.auth.enviarCodigoCorreo().subscribe({
      next: r => { this.trabajandoCorreo = false; this.toast.success(r.message); },
      error: e => { this.trabajandoCorreo = false; this.toast.error(e?.error?.error || 'No se pudo enviar el código'); },
    });
  }
}

/**
 * Las dos opciones que el servidor siempre conoce (utils/tipos-vehiculo.js), para
 * elegir a mano si el catálogo no carga. Solo la clave y el nombre: los campos
 * propios de cada tipo los pone el servidor al crear el taller.
 */
const TIPOS_BASICOS: TipoVehiculo[] = [
  { clave: 'moto', etiqueta: 'Motocicleta', plural: 'Motocicletas', unidadUso: 'km', campos: [] },
  { clave: 'auto', etiqueta: 'Automóvil', plural: 'Automóviles', unidadUso: 'km', campos: [] },
];
