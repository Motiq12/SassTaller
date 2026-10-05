import { Component, OnInit, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { ToastController } from '@ionic/angular';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { RecepcionService } from '../../services/recepcion.service';
import { AuthService } from '../../services/auth.service';
import { AccesibilidadService } from '../../services/accesibilidad.service';
import { comprimirImagen } from '../../shared/utils/image.util';

@Component({
  standalone: false,
  selector: 'app-recepcion-perfil',
  templateUrl: './recepcion-perfil.page.html',
  styleUrls: ['./recepcion-perfil.page.scss'],
})
export class RecepcionPerfilPage implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  perfil: any = null;
  cuenta = { nombre: '', email: '', telefono: '' };
  pass = { actual: '', nueva: '' };
  cargando = true;
  guardando = false;
  guardandoPass = false;
  subiendoFoto = false;

  // Niveles de tamaño de texto (accesibilidad), igual que el portal del cliente.
  readonly nivelesTexto = [
    { i: 0, etiqueta: 'A', nombre: 'Normal' },
    { i: 1, etiqueta: 'A', nombre: 'Grande' },
    { i: 2, etiqueta: 'A', nombre: 'Muy grande' },
  ];

  constructor(
    private rec: RecepcionService,
    private auth: AuthService,
    public a11y: AccesibilidadService,
    private router: Router,
    private toast: ToastController,
  ) {}

  ngOnInit() { this.cargar(); }
  ngOnDestroy() { this.destroy$.next(); this.destroy$.complete(); }
  ionViewWillEnter() { this.cargar(); }

  cargar() {
    this.cargando = true;
    this.rec.getMiPerfil().pipe(takeUntil(this.destroy$)).subscribe({
      next: r => {
        this.perfil = r.data;
        this.cuenta = { nombre: r.data.nombre || '', email: r.data.email || '', telefono: r.data.telefono || '' };
        // Refleja la foto en la sesión (avatar del sidebar) por si entró sin ella.
        this.sincronizarSesion({ foto: r.data.foto ?? null });
        this.cargando = false;
      },
      error: () => { this.cargando = false; this.aviso('No se pudo cargar el perfil', 'danger'); },
    });
  }

  get iniciales(): string {
    const p = (this.cuenta.nombre || 'Recepción').trim().split(/\s+/);
    return ((p[0]?.[0] || '') + (p[1]?.[0] || '')).toUpperCase() || 'R';
  }

  // Sede asignada (la fija el admin). null = atiende todas las sedes.
  get sedeLabel(): string { return this.perfil?.sucursal_nombre || 'Todas las sedes'; }

  // "Miembro desde" a partir de created_at.
  get miembroDesde(): string {
    if (!this.perfil?.created_at) return '—';
    const d = new Date(this.perfil.created_at);
    return d.toLocaleDateString('es-CR', { month: 'long', year: 'numeric' });
  }

  setTexto(i: number) { this.a11y.setNivel(i); }

  // —— Foto de perfil ——
  pedirFoto(input: HTMLInputElement) { if (!this.subiendoFoto) input.click(); }

  async onFoto(ev: Event) {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ''; // permite re-elegir el mismo archivo
    if (!file) return;
    this.subiendoFoto = true;
    try {
      const dataUrl = await comprimirImagen(file, { maxLado: 400, calidad: 0.8 });
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
        this.sincronizarSesion({ nombre: r.data.nombre, email: r.data.email, foto: r.data.foto ?? null });
        this.guardando = false;
        this.aviso('Perfil actualizado');
      },
      error: (e) => { this.guardando = false; this.aviso(e.error?.error || 'No se pudo actualizar', 'danger'); },
    });
  }

  cambiarPassword() {
    if (!this.pass.actual || !this.pass.nueva) { this.aviso('Completá ambas contraseñas', 'warning'); return; }
    if (this.pass.nueva.length < 8) { this.aviso('La nueva debe tener al menos 8 caracteres', 'warning'); return; }
    this.guardandoPass = true;
    this.rec.updateMiPassword({ actual: this.pass.actual, nueva: this.pass.nueva }).pipe(takeUntil(this.destroy$)).subscribe({
      next: () => { this.guardandoPass = false; this.pass = { actual: '', nueva: '' }; this.aviso('Contraseña actualizada'); },
      error: (e) => { this.guardandoPass = false; this.aviso(e.error?.error || 'No se pudo cambiar', 'danger'); },
    });
  }

  // Mantiene la sesión guardada (header/sidebar) al día con los cambios del perfil.
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
