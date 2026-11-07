import { Component, OnInit, OnDestroy } from '@angular/core';
import { AlertController, ToastController } from '@ionic/angular';
import { Router } from '@angular/router';
import { enPanel } from '../../shared/ruta-panel';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { GarantiasService } from '../../services/garantias.service';
import { AuthService } from '../../services/auth.service';
import { Garantia, EstadoGarantia, ESTADO_GARANTIA_CONFIG } from '../../models/garantia.model';
import { comprimirImagen } from '../../shared/image.util';

@Component({
  standalone: false,
  selector: 'app-garantias',
  templateUrl: './garantias.page.html',
  styleUrls: ['./garantias.page.scss'],
})
export class GarantiasPage implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  garantias: Garantia[] = [];
  cargando = true;
  filtroEstado = '';

  seleccionada: Garantia | null = null;
  modalAbierto = false;
  subiendoFoto = false;

  // edición del trámite
  edicion = { estado: 'abierto' as EstadoGarantia, resolucion: '', cubre_repuestos: false, cubre_mano_obra: false };

  readonly estados: { valor: string; label: string }[] = [
    { valor: '', label: 'Todos' },
    { valor: 'abierto', label: 'Abiertos' },
    { valor: 'en_revision', label: 'En revisión' },
    { valor: 'aprobado', label: 'Aprobados' },
    { valor: 'rechazado', label: 'Rechazados' },
    { valor: 'resuelto', label: 'Resueltos' },
  ];

  readonly estadosTramite: EstadoGarantia[] = ['abierto', 'en_revision', 'aprobado', 'rechazado', 'resuelto'];

  constructor(
    private garantiaSvc: GarantiasService,
    public auth: AuthService,
    private alert: AlertController,
    private toast: ToastController,
    private router: Router,
  ) {}

  // Abierta desde el panel de administración (ver shared/ruta-panel.ts).
  get dentroDelPanel(): boolean { return enPanel(this.router); }

  ngOnInit() { this.cargar(); }
  ngOnDestroy() { this.destroy$.next(); this.destroy$.complete(); }
  ionViewWillEnter() { this.cargar(); }

  cargar() {
    this.cargando = true;
    const params = this.filtroEstado ? { estado: this.filtroEstado } : undefined;
    this.garantiaSvc.getAll(params).pipe(takeUntil(this.destroy$)).subscribe({
      next: res => { this.garantias = res.data; this.cargando = false; },
      error: () => { this.cargando = false; },
    });
  }

  filtrar() { this.cargar(); }

  estadoLabel(e: EstadoGarantia) { return ESTADO_GARANTIA_CONFIG[e]?.label ?? e; }
  // Insignia del estándar (.pill) para cada estado del trámite.
  estadoPill(e: EstadoGarantia): string {
    return ({ abierto: 'indigo', en_revision: 'amber', aprobado: 'green', rechazado: 'rose', resuelto: 'gris' } as Record<string, string>)[e] ?? 'gris';
  }

  abrir(g: Garantia) {
    this.garantiaSvc.getById(g.id!).pipe(takeUntil(this.destroy$)).subscribe(res => {
      this.seleccionada = res.data;
      this.edicion = {
        estado: res.data.estado || 'abierto',
        resolucion: res.data.resolucion || '',
        cubre_repuestos: !!res.data.cubre_repuestos,
        cubre_mano_obra: !!res.data.cubre_mano_obra,
      };
      this.modalAbierto = true;
    });
  }

  cerrarModal() { this.modalAbierto = false; this.seleccionada = null; }

  get puedeGestionar(): boolean {
    return this.auth.tieneRol('admin');
  }

  guardarTramite() {
    this.garantiaSvc.cambiarEstado(this.seleccionada!.id!, this.edicion).pipe(takeUntil(this.destroy$)).subscribe({
      next: res => {
        // refrescar en la lista y en el modal
        const i = this.garantias.findIndex(x => x.id === res.data.id);
        if (i >= 0) this.garantias[i] = { ...this.garantias[i], ...res.data };
        if (this.seleccionada) this.seleccionada = { ...this.seleccionada, ...res.data };
        this.mostrarToast('Trámite actualizado');
        if (this.filtroEstado && res.data.estado !== this.filtroEstado) this.cargar();
      },
      error: err => this.mostrarAlertError(err.error?.error),
    });
  }

  async onArchivoSeleccionado(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      this.mostrarAlertError('El archivo debe ser una imagen');
      input.value = '';
      return;
    }
    this.subiendoFoto = true;
    try {
      const dataUrl = await comprimirImagen(file);
      this.garantiaSvc.addFoto(this.seleccionada!.id!, { url: dataUrl }).pipe(takeUntil(this.destroy$)).subscribe({
        next: res => {
          this.seleccionada!.fotos = [...(this.seleccionada!.fotos || []), res.data];
          this.subiendoFoto = false;
          this.mostrarToast('Evidencia agregada');
        },
        error: err => { this.subiendoFoto = false; this.mostrarAlertError(err.error?.error); },
      });
    } catch {
      this.subiendoFoto = false;
      this.mostrarAlertError('No se pudo procesar la imagen');
    }
    input.value = '';
  }

  async verFoto(url: string) {
    const a = await this.alert.create({
      message: `<img src="${url}" style="width:100%;border-radius:2px" />`,
      buttons: ['Cerrar'],
    });
    await a.present();
  }

  async eliminarFoto(fid: number) {
    const conf = await this.alert.create({
      header: 'Eliminar evidencia',
      message: '¿Eliminar esta foto?',
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Eliminar', role: 'destructive',
          handler: () => {
            this.garantiaSvc.deleteFoto(this.seleccionada!.id!, fid).pipe(takeUntil(this.destroy$)).subscribe(() => {
              this.seleccionada!.fotos = (this.seleccionada!.fotos || []).filter(f => f.id !== fid);
            });
          },
        },
      ],
    });
    await conf.present();
  }

  private async mostrarToast(msg: string) {
    const t = await this.toast.create({ message: msg, duration: 2000, color: 'success' });
    await t.present();
  }

  private async mostrarAlertError(msg?: string) {
    const a = await this.alert.create({ header: 'Error', message: msg || 'Ocurrió un error', buttons: ['OK'] });
    await a.present();
  }
}
