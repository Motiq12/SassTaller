import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { Subject, debounceTime, distinctUntilChanged, switchMap, catchError, of } from 'rxjs';
import { TallerService } from '../../services/taller.service';
import { AuthService } from '../../services/auth.service';
import { ToastService } from '../../services/toast.service';

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
  // Datos del taller
  nombre = '';
  slug = '';
  slugEditado = false;      // si el usuario lo tocó, deja de derivarse del nombre
  telefono = '';
  direccion = '';

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
  private slugCambiado = new Subject<string>();

  constructor(
    private taller: TallerService,
    private auth: AuthService,
    private router: Router,
    private toast: ToastService,
  ) {
    // Se espera a que deje de escribir antes de preguntar: sin esto, cada tecla
    // dispararía una consulta y las respuestas podrían llegar desordenadas.
    // switchMap además cancela la anterior, así que siempre gana la última.
    this.slugCambiado.pipe(
      debounceTime(400),
      distinctUntilChanged(),
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
      && !this.enviando;
  }

  crear(): void {
    if (!this.puedeEnviar) return;
    this.enviando = true;

    this.taller.registrarTaller({
      nombre: this.nombre.trim(),
      slug: this.slug,
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
