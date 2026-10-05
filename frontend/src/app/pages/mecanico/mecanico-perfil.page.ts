import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { Router } from '@angular/router';
import { ToastController } from '@ionic/angular';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { MecanicoService } from '../../services/mecanico.service';
import { AuthService } from '../../services/auth.service';
import { AccesibilidadService } from '../../services/accesibilidad.service';
import { comprimirImagen } from '../../shared/utils/image.util';

@Component({
  standalone: false,
  selector: 'app-mecanico-perfil',
  templateUrl: './mecanico-perfil.page.html',
  styleUrls: ['./mecanico-perfil.page.scss'],
})
export class MecanicoPerfilPage implements OnInit, OnDestroy {
  private mecanico = inject(MecanicoService);
  private auth = inject(AuthService);
  a11y = inject(AccesibilidadService);
  private router = inject(Router);
  private toast = inject(ToastController);

  private destroy$ = new Subject<void>();
  perfil: any = null;
  cuenta = { telefono: '', especialidades: '', horario: '' };
  pass = { actual: '', nueva: '' };
  cargando = true;
  guardando = false;
  guardandoPass = false;
  subiendoFoto = false;
  verActual = false;
  verNueva = false;

  readonly nivelesTexto = [
    { i: 0, etiqueta: 'A', nombre: 'Normal' },
    { i: 1, etiqueta: 'A', nombre: 'Grande' },
    { i: 2, etiqueta: 'A', nombre: 'Muy grande' },
  ];

  ngOnInit() { this.cargar(); }
  ionViewWillEnter() { this.cargar(); }
  ngOnDestroy() { this.destroy$.next(); this.destroy$.complete(); }

  cargar(ev?: any) {
    this.cargando = true;
    this.mecanico.getPerfil().pipe(takeUntil(this.destroy$)).subscribe({
      next: r => {
        this.perfil = r.data;
        this.cuenta = {
          telefono: r.data.telefono || '',
          especialidades: r.data.especialidades || '',
          horario: r.data.horario || '',
        };
        this.cargando = false;
        if (ev) ev.target.complete();
      },
      error: () => { this.cargando = false; if (ev) ev.target.complete(); },
    });
  }

  get iniciales(): string {
    const p = (this.perfil?.nombre || 'M').trim().split(/\s+/);
    return ((p[0]?.[0] || '') + (p[1]?.[0] || '')).toUpperCase() || 'M';
  }

  get sedeLabel(): string { return this.perfil?.sucursal_nombre || 'Todas las sedes'; }

  get miembroDesde(): string {
    if (!this.perfil?.created_at) return '—';
    return new Date(this.perfil.created_at).toLocaleDateString('es-CR', { month: 'long', year: 'numeric' });
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

  setTexto(i: number) { this.a11y.setNivel(i); }

  pedirFoto(input: HTMLInputElement) { if (!this.subiendoFoto) input.click(); }

  async onFoto(ev: Event) {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.subiendoFoto = true;
    try {
      const dataUrl = await comprimirImagen(file, { maxLado: 400, calidad: 0.8 });
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
    if (this.pass.nueva.length < 8) { this.aviso('La nueva debe tener al menos 8 caracteres', 'warning'); return; }
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
