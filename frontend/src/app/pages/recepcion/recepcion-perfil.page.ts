import { Component, OnInit, OnDestroy } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Location } from '@angular/common';
import { ModalController, ToastController } from '@ionic/angular';
import { takeUntil } from 'rxjs/operators';
import { RecepcionService } from '../../services/recepcion.service';
import { AuthService } from '../../services/auth.service';
import { AccesibilidadService } from '../../services/accesibilidad.service';
import { MiPerfilService } from '../../services/mi-perfil.service';
import { recortarFoto } from '../../shared/perfil/recortar-foto.component';
import { GrupoPerfil, PerfilListaBase } from '../../shared/perfil/perfil-lista.base';

// Mi perfil de recepción: la misma lista de ajustes que el panel (shared/perfil).
@Component({
  standalone: false,
  selector: 'app-recepcion-perfil',
  templateUrl: './recepcion-perfil.page.html',
})
export class RecepcionPerfilPage extends PerfilListaBase implements OnInit, OnDestroy {
  readonly rol = 'recepcion' as const;
  readonly grupos: GrupoPerfil[] = [
    { titulo: 'Información personal', items: [
      { id: 'datos', nombre: 'Datos personales', icono: 'person-outline' },
      { id: 'foto', nombre: 'Foto de perfil', icono: 'image-outline' },
      { id: 'firma', nombre: 'Mi firma', icono: 'pencil-outline' },
    ] },
    { titulo: 'Seguridad', items: [
      { id: 'contrasena', nombre: 'Cambiar contraseña', icono: 'lock-closed-outline' },
      { id: 'dosfa', nombre: 'Verificación en dos pasos', icono: 'shield-checkmark-outline' },
      { id: 'sesiones', nombre: 'Dónde estás conectado', icono: 'laptop-outline' },
    ] },
    { titulo: 'Preferencias', items: [
      { id: 'apariencia', nombre: 'Apariencia', icono: 'color-palette-outline' },
      { id: 'inicio', nombre: 'Al entrar y avisos', icono: 'options-outline' },
    ] },
    { titulo: 'Actividad', items: [
      { id: 'actividad', nombre: 'Mi actividad', icono: 'time-outline' },
    ] },
  ];

  perfil: any = null;
  cuenta = { nombre: '', email: '', telefono: '' };
  private cuentaGuardada = { nombre: '', email: '', telefono: '' };
  pass = { actual: '', nueva: '' };
  cargando = true;
  guardando = false;
  guardandoPass = false;
  subiendoFoto = false;
  verActual = false;
  verNueva = false;

  constructor(
    private rec: RecepcionService,
    private toast: ToastController,
    private modal: ModalController,
    route: ActivatedRoute,
    router: Router,
    location: Location,
    miPerfil: MiPerfilService,
    auth: AuthService,
    a11y: AccesibilidadService,
  ) {
    super(route, router, location, miPerfil, auth, a11y);
  }

  ngOnInit() { this.iniciarLista(); this.cargar(); }
  ngOnDestroy() { this.terminarLista(); }
  ionViewWillEnter() { this.cargar(); }

  cargar() {
    this.rec.getMiPerfil().pipe(takeUntil(this.destroy$)).subscribe({
      next: r => {
        this.perfil = r.data;
        this.cuenta = { nombre: r.data.nombre || '', email: r.data.email || '', telefono: r.data.telefono || '' };
        this.cuentaGuardada = { ...this.cuenta };
        // Refleja la foto en la sesión (avatar del menú) por si entró sin ella.
        this.sincronizarSesion({ foto: r.data.foto ?? null });
        this.cargando = false;
      },
      error: () => { this.cargando = false; this.aviso('No se pudo cargar el perfil', 'danger'); },
    });
  }

  protected get fotoActual(): string | null { return this.perfil?.foto || null; }
  get iniciales(): string { return this.inicialesDe(this.perfil?.nombre || '', 'Recepción'); }
  // Sede asignada (la fija administración). null = atiende todas las sedes.
  get sedeLabel(): string { return this.perfil?.sucursal_nombre || 'Todas las sedes'; }
  get rolNombre(): string { return this.auth.getUsuario()?.rol_nombre || 'Recepción'; }
  get miembroDesde(): string { return this.fechaDesde(this.perfil?.created_at); }
  get fuerza() { return this.fuerzaDe(this.pass.nueva); }
  get cuentaCambiada(): boolean {
    return this.cuenta.nombre.trim() !== this.cuentaGuardada.nombre || this.cuenta.email.trim() !== this.cuentaGuardada.email
      || this.cuenta.telefono.trim() !== this.cuentaGuardada.telefono;
  }

  // —— Foto de perfil ——
  pedirFoto(input: HTMLInputElement) { if (!this.subiendoFoto) input.click(); }

  async onFoto(ev: Event) {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ''; // permite re-elegir el mismo archivo
    if (!file) return;
    try {
      // Primero se encuadra (y sale ya en 400 px); cancelar no sube nada.
      const dataUrl = await recortarFoto(this.modal, file);
      if (!dataUrl) return;
      this.subiendoFoto = true;
      this.rec.updateMiFoto(dataUrl).pipe(takeUntil(this.destroy$)).subscribe({
        next: r => {
          this.perfil = { ...this.perfil, foto: r.data.foto };
          this.sincronizarSesion({ foto: r.data.foto });
          this.subiendoFoto = false;
          this.aviso('Foto actualizada');
        },
        error: e => { this.subiendoFoto = false; this.aviso(e.error?.error || 'No se pudo subir la foto', 'danger'); },
      });
    } catch {
      this.subiendoFoto = false;
      this.aviso('No se pudo procesar la imagen', 'danger');
    }
  }

  quitarFoto() {
    if (this.subiendoFoto) return;
    this.subiendoFoto = true;
    this.rec.updateMiFoto(null).pipe(takeUntil(this.destroy$)).subscribe({
      next: () => {
        this.perfil = { ...this.perfil, foto: null };
        this.sincronizarSesion({ foto: null });
        this.subiendoFoto = false;
        this.aviso('Foto eliminada');
      },
      error: e => { this.subiendoFoto = false; this.aviso(e.error?.error || 'No se pudo quitar la foto', 'danger'); },
    });
  }

  guardarCuenta() {
    if (!this.cuenta.nombre.trim() || !this.cuenta.email.trim()) { this.aviso('Nombre y correo son requeridos', 'warning'); return; }
    this.guardando = true;
    this.rec.updateMiPerfil({ nombre: this.cuenta.nombre.trim(), email: this.cuenta.email.trim(), telefono: this.cuenta.telefono.trim() }).pipe(takeUntil(this.destroy$)).subscribe({
      next: r => {
        this.perfil = r.data;
        this.cuentaGuardada = { nombre: r.data.nombre || '', email: r.data.email || '', telefono: r.data.telefono || '' };
        this.sincronizarSesion({ nombre: r.data.nombre, email: r.data.email, foto: r.data.foto ?? null });
        this.guardando = false;
        this.aviso('Perfil actualizado');
      },
      error: (e) => { this.guardando = false; this.aviso(e.error?.error || 'No se pudo actualizar', 'danger'); },
    });
  }

  cambiarPassword() {
    if (!this.pass.actual || !this.pass.nueva) { this.aviso('Completá ambas contraseñas', 'warning'); return; }
    if (this.pass.nueva.length < this.minimo) { this.aviso(`Mínimo ${this.minimo} caracteres`, 'warning'); return; }
    this.guardandoPass = true;
    this.rec.updateMiPassword({ actual: this.pass.actual, nueva: this.pass.nueva }).pipe(takeUntil(this.destroy$)).subscribe({
      next: () => { this.guardandoPass = false; this.pass = { actual: '', nueva: '' }; this.aviso('Contraseña actualizada'); },
      error: (e) => { this.guardandoPass = false; this.aviso(e.error?.error || 'No se pudo cambiar', 'danger'); },
    });
  }

  // Mantiene la sesión guardada (menú) al día con los cambios del perfil.
  private sincronizarSesion(parcial: { nombre?: string; email?: string; foto?: string | null }) {
    const u = this.auth.getUsuario();
    const token = this.auth.getToken();
    if (u && token) this.auth.aplicarSesionStaff(token, { ...u, ...parcial });
  }

  logout() {
    this.auth.logout();
    this.router.navigate(['/portal/login'], { replaceUrl: true });
  }

  private async aviso(message: string, color = 'success') {
    const t = await this.toast.create({ message, duration: 1800, color });
    await t.present();
  }
}
