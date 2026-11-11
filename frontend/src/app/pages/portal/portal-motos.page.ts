import { Component, OnInit, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { AlertController, ToastController } from '@ionic/angular';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { PortalService } from '../../services/portal.service';
import { TipoVehiculo } from '../../services/taller.service';
import { MARCAS_MOTO, modelosDeMarca } from '../../utils/motos-catalogo';
import { comprimirImagen } from '../../utils/imagen';
import { mesesDesde } from '../../utils/mantenimiento';

@Component({
  standalone: false,
  selector: 'app-portal-motos',
  templateUrl: './portal-motos.page.html',
  styleUrls: ['./portal-motos.page.scss'],
})
export class PortalMotosPage implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  motos: any[] = [];
  cargando = true;

  mostrarForm = false;
  enviando = false;
  procesandoFoto = false;
  editandoId: number | null = null;
  nueva = { tipo: '', marca: '', modelo: '', placa: '', anio: null as number | null, color: '', kilometraje: null as number | null, foto: null as string | null };

  // Los tipos que atiende el taller. Con uno solo no se pregunta nada.
  private atendidos: TipoVehiculo[] = [];
  private otros: TipoVehiculo[] = [];
  atributos: Record<string, string | number | null> = {};
  // Más el de este vehículo, si es de un tipo que el taller dejó de atender.
  get tipos(): TipoVehiculo[] { return [...this.atendidos, ...this.otros.filter(t => t.clave === this.nueva.tipo)]; }
  get tipoActual(): TipoVehiculo | undefined { return this.tipos.find(t => t.clave === this.nueva.tipo); }
  // Al cambiar de tipo, los datos del anterior ya no aplican, y las sugerencias son de motos.
  cambiarTipo() { this.atributos = {}; this.marcasSugeridas = []; this.modelosSugeridos = []; }

  // Autocompletado de marca/modelo (catálogo local, no restrictivo).
  marcasSugeridas: string[] = [];
  modelosSugeridos: string[] = [];

  constructor(private portal: PortalService, private toast: ToastController, private alert: AlertController, private router: Router) {}

  verHistorial(m: any) { this.router.navigate(['/portal/moto', m.id, 'historial']); }

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
    this.portal.getTiposVehiculo().pipe(takeUntil(this.destroy$)).subscribe({
      next: res => { this.atendidos = res.data; this.otros = res.otros || []; },
    });
    this.portal.getMotos().pipe(takeUntil(this.destroy$)).subscribe({
      next: res => { this.motos = res.data; this.cargando = false; },
      error: () => { this.cargando = false; },
    });
  }

  abrirForm() {
    this.editandoId = null;
    // Con varios tipos hay que elegir: uno puesto por defecto pasaría sin que nadie lo note.
    this.nueva = { tipo: this.atendidos.length === 1 ? this.atendidos[0].clave : '', marca: '', modelo: '', placa: '', anio: null, color: '', kilometraje: null, foto: null };
    this.atributos = {};
    this.marcasSugeridas = [];
    this.modelosSugeridos = [];
    this.mostrarForm = true;
  }

  editar(m: any) {
    this.editandoId = m.id;
    this.atributos = { ...(m.atributos || {}) };
    this.nueva = {
      tipo: m.tipo || '', marca: m.marca, modelo: m.modelo, placa: m.placa,
      anio: m.anio || null, color: m.color || '', kilometraje: m.kilometraje_actual || null,
      foto: m.foto || null,
    };
    this.marcasSugeridas = [];
    this.modelosSugeridos = [];
    this.mostrarForm = true;
  }

  // —— Foto de la moto ——
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
    if (this.nueva.tipo !== 'moto') { this.marcasSugeridas = []; return; }
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
    if (this.nueva.tipo === 'moto' && !this.nueva.modelo.trim()) this.modelosSugeridos = modelosDeMarca(this.nueva.marca).slice(0, 8);
  }
  onModeloInput() {
    if (this.nueva.tipo !== 'moto') { this.modelosSugeridos = []; return; }
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
    return !!(this.nueva.marca.trim() && this.nueva.modelo.trim() && this.nueva.placa.trim()) && (this.tipos.length <= 1 || !!this.nueva.tipo);
  }

  guardar() {
    if (!this.valido) { this.mostrarToast('Tipo, marca, modelo y placa son obligatorios', 'warning'); return; }
    this.enviando = true;
    const datos = {
      marca: this.nueva.marca.trim(),
      modelo: this.nueva.modelo.trim(),
      placa: this.nueva.placa.trim().toUpperCase(),
      anio: this.nueva.anio || null,
      color: this.nueva.color.trim() || undefined,
      kilometraje_actual: this.nueva.kilometraje || 0,
      foto: this.nueva.foto || null,
      // Sin tipo (no cargó la lista) no se manda: el servidor deja el que había.
      ...(this.nueva.tipo ? { tipo: this.nueva.tipo, atributos: this.atributos } : {}),
    };
    const op = this.editandoId
      ? this.portal.editarMoto(this.editandoId, datos)
      : this.portal.crearMoto(datos);
    op.pipe(takeUntil(this.destroy$)).subscribe({
      next: res => {
        if (this.editandoId) {
          const i = this.motos.findIndex(m => m.id === this.editandoId);
          if (i >= 0) this.motos[i] = res.data;
          this.mostrarToast('Vehículo actualizado');
        } else {
          this.motos.unshift(res.data);
          this.mostrarToast('Vehículo registrado');
        }
        this.cerrarForm();
        this.enviando = false;
      },
      error: err => {
        this.enviando = false;
        this.mostrarToast(err.error?.error || 'No se pudo guardar el vehículo', 'danger');
      },
    });
  }

  async eliminar(m: any) {
    const al = await this.alert.create({
      cssClass: 'portal-alert',
      header: 'Eliminar vehículo',
      message: `¿Quieres eliminar tu ${m.marca} ${m.modelo} (${m.placa})? Dejará de aparecer en tu lista.`,
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
        this.motos = this.motos.filter(x => x.id !== m.id);
        if (this.editandoId === m.id) this.cerrarForm();
        this.mostrarToast('Vehículo eliminado');
      },
      error: err => this.mostrarToast(err.error?.error || 'No se pudo eliminar el vehículo', 'danger'),
    });
  }

  ngOnDestroy() { this.destroy$.next(); this.destroy$.complete(); }

  private async mostrarToast(message: string, color = 'success') {
    const t = await this.toast.create({ message, duration: 2400, color });
    await t.present();
  }
}
