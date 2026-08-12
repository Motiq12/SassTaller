import { Component, OnInit, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { AlertController, ToastController } from '@ionic/angular';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { PortalService } from '../../services/portal.service';
import { MARCAS_MOTO, modelosDeMarca } from '../../utils/vehiculos-catalogo';
import { comprimirImagen } from '../../utils/imagen';
import { mesesDesde } from '../../utils/mantenimiento';

@Component({
  standalone: false,
  selector: 'app-portal-vehiculos',
  templateUrl: './portal-vehiculos.page.html',
  styleUrls: ['./portal-vehiculos.page.scss'],
})
export class PortalVehiculosPage implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  vehiculos: any[] = [];
  cargando = true;

  mostrarForm = false;
  enviando = false;
  procesandoFoto = false;
  editandoId: number | null = null;
  nueva = { marca: '', modelo: '', placa: '', anio: null as number | null, color: '', kilometraje: null as number | null, foto: null as string | null };

  // Autocompletado de marca/modelo (catálogo local, no restrictivo).
  marcasSugeridas: string[] = [];
  modelosSugeridos: string[] = [];

  constructor(private portal: PortalService, private toast: ToastController, private alert: AlertController, private router: Router) {}

  verHistorial(m: any) { this.router.navigate(['/portal/vehiculo', m.id, 'historial']); }

  // Aviso de servicio a nivel lista (a partir de la fecha del último servicio entregado).
  // Umbral por tiempo: ≥12 m "le toca", 6–11 m "revisión sugerida", <6 m "al día".
  avisoMoto(m: any): { tono: 'ok' | 'warn' | 'due' | 'none'; texto: string } {
    if (!m.ultimo_servicio) return { tono: 'none', texto: 'Sin servicios aún' };
    const meses = mesesDesde(m.ultimo_servicio);
    if (meses >= 12) return { tono: 'due', texto: 'Le toca servicio' };
    if (meses >= 6) return { tono: 'warn', texto: 'Revisión sugerida' };
    return { tono: 'ok', texto: meses <= 1 ? 'Al día' : `Al día · hace ${meses} m` };
  }

  ngOnInit() { this.cargar(); }
  ionViewWillEnter() { this.cargar(); }

  cargar() {
    this.cargando = true;
    this.portal.getMotos().pipe(takeUntil(this.destroy$)).subscribe({
      next: res => { this.vehiculos = res.data; this.cargando = false; },
      error: () => { this.cargando = false; },
    });
  }

  abrirForm() {
    this.editandoId = null;
    this.nueva = { marca: '', modelo: '', placa: '', anio: null, color: '', kilometraje: null, foto: null };
    this.marcasSugeridas = [];
    this.modelosSugeridos = [];
    this.mostrarForm = true;
  }

  editar(m: any) {
    this.editandoId = m.id;
    this.nueva = {
      marca: m.marca, modelo: m.modelo, placa: m.placa,
      anio: m.anio || null, color: m.color || '', kilometraje: m.kilometraje_actual || null,
      foto: m.foto || null,
    };
    this.marcasSugeridas = [];
    this.modelosSugeridos = [];
    this.mostrarForm = true;
  }

  // —— Foto de la vehiculo ——
  async onFoto(ev: Event) {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.procesandoFoto = true;
    try {
      this.nueva.foto = await comprimirImagen(file, { maxLado: 800, calidad: 0.82 });
    } catch (e: any) {
      this.mostrarToast(e?.message || 'No se pudo procesar la imagen', 'danger');
    } finally {
      this.procesandoFoto = false;
    }
  }
  quitarFoto() { this.nueva.foto = null; }

  cerrarForm() { this.mostrarForm = false; this.editandoId = null; this.marcasSugeridas = []; this.modelosSugeridos = []; }

  // —— Autocompletado de marca ——
  onMarcaInput() {
    const q = this.nueva.marca.trim().toLowerCase();
    this.marcasSugeridas = q ? MARCAS_MOTO.filter(m => m.toLowerCase().includes(q)).slice(0, 8) : [];
  }
  seleccionarMarca(m: string) {
    this.nueva.marca = m;
    this.marcasSugeridas = [];
    // Al cambiar de marca, el modelo previo deja de aplicar.
    this.nueva.modelo = '';
    this.modelosSugeridos = [];
  }

  // —— Autocompletado de modelo, filtrado por la marca elegida ——
  onModeloFocus() {
    if (!this.nueva.modelo.trim()) this.modelosSugeridos = modelosDeMarca(this.nueva.marca).slice(0, 8);
  }
  onModeloInput() {
    const q = this.nueva.modelo.trim().toLowerCase();
    const modelos = modelosDeMarca(this.nueva.marca);
    this.modelosSugeridos = (q ? modelos.filter(m => m.toLowerCase().includes(q)) : modelos).slice(0, 8);
  }
  seleccionarModelo(m: string) {
    this.nueva.modelo = m;
    this.modelosSugeridos = [];
  }

  // Marca, modelo y placa son obligatorios.
  get valido(): boolean {
    return !!(this.nueva.marca.trim() && this.nueva.modelo.trim() && this.nueva.placa.trim());
  }

  guardar() {
    if (!this.valido) { this.mostrarToast('Marca, modelo y placa son obligatorios', 'warning'); return; }
    this.enviando = true;
    const datos = {
      marca: this.nueva.marca.trim(),
      modelo: this.nueva.modelo.trim(),
      placa: this.nueva.placa.trim().toUpperCase(),
      anio: this.nueva.anio || null,
      color: this.nueva.color.trim() || undefined,
      kilometraje_actual: this.nueva.kilometraje || 0,
      foto: this.nueva.foto || null,
    };
    const op = this.editandoId
      ? this.portal.editarMoto(this.editandoId, datos)
      : this.portal.crearMoto(datos);
    op.pipe(takeUntil(this.destroy$)).subscribe({
      next: res => {
        if (this.editandoId) {
          const i = this.vehiculos.findIndex(m => m.id === this.editandoId);
          if (i >= 0) this.vehiculos[i] = res.data;
          this.mostrarToast('Vehiculo actualizada');
        } else {
          this.vehiculos.unshift(res.data);
          this.mostrarToast('Vehiculo registrada');
        }
        this.cerrarForm();
        this.enviando = false;
      },
      error: err => {
        this.enviando = false;
        this.mostrarToast(err.error?.error || 'No se pudo guardar la vehiculo', 'danger');
      },
    });
  }

  async eliminar(m: any) {
    const al = await this.alert.create({
      cssClass: 'portal-alert',
      header: 'Eliminar vehiculo',
      message: `¿Querés eliminar tu ${m.marca} ${m.modelo} (${m.placa})? Dejará de aparecer en tu lista.`,
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        { text: 'Eliminar', role: 'destructive', cssClass: 'portal-alert-danger', handler: () => this.confirmarEliminar(m) },
      ],
    });
    await al.present();
  }

  private confirmarEliminar(m: any) {
    this.portal.eliminarMoto(m.id).pipe(takeUntil(this.destroy$)).subscribe({
      next: () => {
        this.vehiculos = this.vehiculos.filter(x => x.id !== m.id);
        if (this.editandoId === m.id) this.cerrarForm();
        this.mostrarToast('Vehiculo eliminada');
      },
      error: err => this.mostrarToast(err.error?.error || 'No se pudo eliminar la vehiculo', 'danger'),
    });
  }

  ngOnDestroy() { this.destroy$.next(); this.destroy$.complete(); }

  private async mostrarToast(message: string, color = 'success') {
    const t = await this.toast.create({ message, duration: 2400, color });
    await t.present();
  }
}
