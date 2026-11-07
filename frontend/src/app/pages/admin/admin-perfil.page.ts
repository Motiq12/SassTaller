import { Component, OnInit, OnDestroy } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Location } from '@angular/common';
import { ModalController, ToastController } from '@ionic/angular';
import { Observable, forkJoin } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { AdminService } from '../../services/admin.service';
import { AuthService } from '../../services/auth.service';
import { AccesibilidadService } from '../../services/accesibilidad.service';
import { MiPerfilService } from '../../services/mi-perfil.service';
import { recortarFoto } from '../../shared/perfil/recortar-foto.component';
import { GrupoPerfil, PerfilListaBase } from '../../shared/perfil/perfil-lista.base';

@Component({
  standalone: false,
  selector: 'app-admin-perfil',
  templateUrl: './admin-perfil.page.html',
})
export class AdminPerfilPage extends PerfilListaBase implements OnInit, OnDestroy {
  readonly rol = 'admin' as const;
  // Las filas de Mi perfil, por grupo. Cada una abre su sección (?ver=<id>).
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
      { id: 'inicio', nombre: 'Al entrar', icono: 'options-outline' },
    ] },
    { titulo: 'Actividad', items: [
      { id: 'actividad', nombre: 'Mi actividad', icono: 'time-outline' },
    ] },
  ];

  perfil: any = null;
  cuenta = { nombre: '', email: '', telefono: '' };
  cuentaGuardada = { nombre: '', email: '', telefono: '' };
  pass = { actual: '', nueva: '' };
  guardando = false;
  guardandoPass = false;
  subiendoFoto = false;
  verActual = false;
  verNueva = false;

  constructor(
    private admin: AdminService,
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
  ionViewWillEnter() { this.cargar(); }
  ngOnDestroy() { this.terminarLista(); }

  cargar() {
    const u = this.auth.getUsuario();
    this.perfil = { ...u, foto: (u as any)?.foto || null };
    this.cuenta = { nombre: u?.nombre || '', email: u?.email || '', telefono: '' };
    this.cuentaGuardada = { ...this.cuenta };
    // El teléfono no viaja en la sesión: se pide aparte.
    this.miPerfil.get().pipe(takeUntil(this.destroy$)).subscribe({
      next: r => { this.cuenta.telefono = r.data.telefono || ''; this.cuentaGuardada.telefono = this.cuenta.telefono; },
      error: () => {},
    });
  }

  protected get fotoActual(): string | null { return this.perfil?.foto || null; }
  get rolNombre(): string { return this.perfil?.rol_nombre || 'Administrador'; }
  get sede(): string { return this.perfil?.sucursal_nombre || 'Todas las sedes'; }
  get iniciales(): string { return this.inicialesDe(this.cuentaGuardada.nombre); }
  get miembroDesde(): string { return this.fechaDesde(this.perfil?.created_at); }
  get fuerza() { return this.fuerzaDe(this.pass.nueva); }
  get cuentaCambiada(): boolean {
    return this.cuenta.nombre.trim() !== this.cuentaGuardada.nombre || this.cuenta.email.trim() !== this.cuentaGuardada.email
      || this.cuenta.telefono.trim() !== this.cuentaGuardada.telefono;
  }

  pedirFoto(input: HTMLInputElement) { if (!this.subiendoFoto) input.click(); }

  async onFoto(ev: Event) {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      // Primero se encuadra (y sale ya en 400 px); cancelar no sube nada.
      const dataUrl = await recortarFoto(this.modal, file);
      if (!dataUrl) return;
      this.subiendoFoto = true;
      this.admin.updateFoto(dataUrl).pipe(takeUntil(this.destroy$)).subscribe({
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
    this.admin.updateFoto(null).pipe(takeUntil(this.destroy$)).subscribe({
      next: () => {
        this.perfil = { ...this.perfil, foto: null };
        this.sincronizarSesion({ foto: null });
        this.subiendoFoto = false;
        this.aviso('Foto eliminada');
      },
      error: () => { this.subiendoFoto = false; this.aviso('No se pudo quitar', 'danger'); },
    });
  }

  guardarCuenta() {
    if (!this.cuenta.nombre.trim() || !this.cuenta.email.trim()) { this.aviso('Nombre y correo son requeridos', 'warning'); return; }
    const nombre = this.cuenta.nombre.trim();
    const email = this.cuenta.email.trim();
    const telefono = this.cuenta.telefono.trim();
    // Solo se manda lo que cambió: nombre y correo van al panel, el teléfono a Mi perfil.
    const pedidos: Observable<any>[] = [];
    if (nombre !== this.cuentaGuardada.nombre || email !== this.cuentaGuardada.email) pedidos.push(this.admin.updateCuenta({ nombre, email }));
    if (telefono !== this.cuentaGuardada.telefono) pedidos.push(this.miPerfil.guardarTelefono(telefono));
    if (!pedidos.length) return;
    this.guardando = true;
    forkJoin(pedidos).pipe(takeUntil(this.destroy$)).subscribe({
      next: () => {
        this.sincronizarSesion({ nombre, email });
        this.cuentaGuardada = { nombre, email, telefono };
        this.guardando = false;
        this.aviso('Cuenta actualizada');
      },
      error: e => { this.guardando = false; this.aviso(e.error?.error || 'No se pudo guardar', 'danger'); },
    });
  }

  cambiarPassword() {
    if (!this.pass.actual || !this.pass.nueva) { this.aviso('Completá ambas contraseñas', 'warning'); return; }
    if (this.pass.nueva.length < this.minimo) { this.aviso(`Mínimo ${this.minimo} caracteres`, 'warning'); return; }
    this.guardandoPass = true;
    this.admin.updatePassword(this.pass).pipe(takeUntil(this.destroy$)).subscribe({
      next: () => { this.guardandoPass = false; this.pass = { actual: '', nueva: '' }; this.aviso('Contraseña actualizada'); },
      error: e => { this.guardandoPass = false; this.aviso(e.error?.error || 'No se pudo cambiar', 'danger'); },
    });
  }

  private sincronizarSesion(parcial: { nombre?: string; email?: string; foto?: string | null }) {
    const u = this.auth.getUsuario();
    const token = this.auth.getToken();
    if (u && token) this.auth.aplicarSesionStaff(token, { ...u, ...parcial });
  }

  logout() {
    this.auth.logout();
    this.router.navigate(['/login'], { replaceUrl: true });
  }

  private async aviso(message: string, color = 'success') {
    const t = await this.toast.create({ message, duration: 1800, color });
    await t.present();
  }
}
