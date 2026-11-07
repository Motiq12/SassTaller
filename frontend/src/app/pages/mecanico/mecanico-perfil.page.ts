import { Component, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Location } from '@angular/common';
import { ModalController, ToastController } from '@ionic/angular';
import { takeUntil } from 'rxjs/operators';
import { MecanicoService } from '../../services/mecanico.service';
import { AuthService } from '../../services/auth.service';
import { AccesibilidadService } from '../../services/accesibilidad.service';
import { MiPerfilService } from '../../services/mi-perfil.service';
import { recortarFoto } from '../../shared/perfil/recortar-foto.component';
import { GrupoPerfil, PerfilListaBase } from '../../shared/perfil/perfil-lista.base';

// Mi perfil del taller: la misma lista de ajustes que el panel (shared/perfil), más
// "Mi desempeño". El nombre y el correo los cambia administración.
@Component({
  standalone: false,
  selector: 'app-mecanico-perfil',
  templateUrl: './mecanico-perfil.page.html',
  styleUrls: ['./mecanico-perfil.page.scss'],
})
export class MecanicoPerfilPage extends PerfilListaBase implements OnInit, OnDestroy {
  readonly rol = 'tecnico' as const;
  readonly grupos: GrupoPerfil[] = [
    { titulo: 'Mi trabajo', items: [
      { id: 'desempeno', nombre: 'Mi desempeño', icono: 'stats-chart-outline' },
    ] },
    { titulo: 'Información personal', items: [
      { id: 'datos', nombre: 'Datos de trabajo', icono: 'person-outline' },
      { id: 'foto', nombre: 'Foto de perfil', icono: 'image-outline' },
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
  cuenta = { telefono: '', especialidades: '', horario: '' };
  private cuentaGuardada = { telefono: '', especialidades: '', horario: '' };
  pass = { actual: '', nueva: '' };
  cargando = true;
  guardando = false;
  guardandoPass = false;
  subiendoFoto = false;
  verActual = false;
  verNueva = false;

  constructor(
    private mecanico: MecanicoService,
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
    this.mecanico.getPerfil().pipe(takeUntil(this.destroy$)).subscribe({
      next: r => {
        this.perfil = r.data;
        this.cuenta = {
          telefono: r.data.telefono || '',
          especialidades: r.data.especialidades || '',
          horario: r.data.horario || '',
        };
        this.cuentaGuardada = { ...this.cuenta };
        this.cargando = false;
      },
      error: () => { this.cargando = false; this.aviso('No se pudo cargar el perfil', 'danger'); },
    });
  }

  protected get fotoActual(): string | null { return this.perfil?.foto || null; }
  get iniciales(): string { return this.inicialesDe(this.perfil?.nombre || '', 'M'); }
  get sedeLabel(): string { return this.perfil?.sucursal_nombre || 'Todas las sedes'; }
  get rolNombre(): string { return this.auth.getUsuario()?.rol_nombre || 'Mecánico'; }
  get miembroDesde(): string { return this.fechaDesde(this.perfil?.created_at); }
  get fuerza() { return this.fuerzaDe(this.pass.nueva); }
  get cuentaCambiada(): boolean {
    return (['telefono', 'especialidades', 'horario'] as const).some(k => this.cuenta[k].trim() !== this.cuentaGuardada[k]);
  }

  override valor(id: string): string {
    if (id === 'desempeno') return this.perfil?.calificacion_promedio ? `★ ${this.perfil.calificacion_promedio}` : '';
    return super.valor(id);
  }

  estrellas(prom: number | null): string {
    if (!prom) return '—';
    const llenas = Math.round(prom);
    return '★'.repeat(llenas) + '☆'.repeat(5 - llenas);
  }

  formatMin(min: number | null | undefined): string {
    if (!min) return '—';
    const h = Math.floor(min / 60);
    const m = Math.round(min % 60);
    return h ? `${h}h ${m}min` : `${m} min`;
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
      this.mecanico.updateFoto(dataUrl).pipe(takeUntil(this.destroy$)).subscribe({
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
    this.mecanico.updateFoto(null).pipe(takeUntil(this.destroy$)).subscribe({
      next: () => {
        this.perfil = { ...this.perfil, foto: null };
        this.sincronizarSesion({ foto: null });
        this.subiendoFoto = false;
        this.aviso('Foto eliminada');
      },
      error: e => { this.subiendoFoto = false; this.aviso(e.error?.error || 'No se pudo quitar la foto', 'danger'); },
    });
  }

  private sincronizarSesion(parcial: { foto?: string | null }) {
    const u = this.auth.getUsuario();
    const token = this.auth.getToken();
    if (u && token) this.auth.aplicarSesionStaff(token, { ...u, ...parcial });
  }

  guardarCuenta() {
    this.guardando = true;
    this.mecanico.actualizarPerfil(this.cuenta).pipe(takeUntil(this.destroy$)).subscribe({
      next: () => { this.guardando = false; this.aviso('Perfil actualizado'); this.cargar(); },
      error: (e) => { this.guardando = false; this.aviso(e.error?.error || 'No se pudo guardar', 'danger'); },
    });
  }

  cambiarPassword() {
    if (!this.pass.actual || !this.pass.nueva) { this.aviso('Completá ambas contraseñas', 'warning'); return; }
    if (this.pass.nueva.length < this.minimo) { this.aviso(`Mínimo ${this.minimo} caracteres`, 'warning'); return; }
    this.guardandoPass = true;
    this.mecanico.cambiarPassword(this.pass).pipe(takeUntil(this.destroy$)).subscribe({
      next: () => { this.guardandoPass = false; this.pass = { actual: '', nueva: '' }; this.aviso('Contraseña actualizada'); },
      error: (e) => { this.guardandoPass = false; this.aviso(e.error?.error || 'No se pudo cambiar', 'danger'); },
    });
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
