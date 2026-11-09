import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
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
  private router = inject(Router);
  private toast = inject(ToastService);

  // Esta pantalla identifica al PRODUCTO, no a un taller: quien la abre todavía no
  // pertenece a ninguno.
  producto = PRODUCTO;

  // Datos del taller
  nombre = '';
  slug = '';
  slugEditado = false;      // si el usuario lo tocó, deja de derivarse del nombre
  telefono = '';
  direccion = '';

  // Qué vehículos atiende. Define su catálogo de servicios inicial, los campos del
  // formulario de vehículo y cómo lo llama la interfaz. Arranca con motos marcado
  // porque es el caso más común y deja el formulario válido desde el inicio; el
  // taller de autos lo cambia con un toque.
  tiposDisponibles: TipoVehiculo[] = [];
  // Mapa clave->marcado, para que cada checkbox tenga su propio ngModel. Arranca
  // con motos porque es el caso más común y deja el formulario válido de entrada.
  tiposMarcados: Record<string, boolean> = { moto: true };

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

    this.taller.tipos().subscribe({
      next: res => { this.tiposDisponibles = res.data; },
      // Sin catálogo no se puede elegir, pero tampoco tiene sentido bloquear el alta:
      // el servidor cae a 'moto' si no le llega nada, así que el taller queda creado
      // y puede corregirlo desde su configuración.
      error: () => { this.tiposDisponibles = []; },
    });
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
        this.toast.success(`Taller "${res.data.taller.nombre}" creado`);
        this.router.navigate(['/admin'], { replaceUrl: true });
      },
      error: err => {
        this.enviando = false;
        const msg = err?.error?.error || 'No se pudo crear el taller';
        this.toast.error(msg);
        // 409 = el identificador se ocupó entre la validación y el envío.
        if (err?.status === 409) { this.disponible = false; this.motivoSlug = msg; }
      },
    });
  }
}
