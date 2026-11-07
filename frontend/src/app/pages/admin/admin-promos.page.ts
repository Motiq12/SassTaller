import { Component, OnInit, OnDestroy } from '@angular/core';
import { AlertController, ToastController } from '@ionic/angular';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { PromosService, Promo } from '../../services/promos.service';

@Component({
  standalone: false,
  selector: 'app-admin-promos',
  templateUrl: './admin-promos.page.html',
  styleUrls: ['./admin-promos.page.scss'],
})
export class AdminPromosPage implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  promos: Promo[] = [];
  cargando = true;
  guardando = false;
  editId: number | null = null;
  modalAbierto = false;
  busqueda = '';
  // Imagenes cargadas a demanda: el listado ya no las trae (pesaba ~100 KB por
  // promocion, 3 MB con 30 activas). Se piden solo las que se van a ver.
  imagenes: Record<number, string> = {};
  form: { titulo: string; descripcion: string; descuento: number | null; precio_final: number | null; imagen: string | null; activa: boolean } =
    { titulo: '', descripcion: '', descuento: null, precio_final: null, imagen: null, activa: true };

  constructor(private svc: PromosService, private toast: ToastController, private alert: AlertController) {}

  ngOnInit() { this.cargar(); }
  ionViewWillEnter() { this.cargar(); }

  cargar(ev?: any) {
    this.cargando = true;
    this.svc.getAll().pipe(takeUntil(this.destroy$)).subscribe({
      next: r => {
        this.promos = r.data;
        this.cargando = false;
        if (ev) ev.target.complete();
        // Las imágenes van aparte (pesan). Se piden las de las primeras 6 y las de
        // todas las que son solo una imagen: sin ella no se sabe cuál es cuál.
        const conImagen = r.data.filter((p: Promo) => (p as any).tiene_imagen && !this.imagenes[p.id!]);
        const soloImagen = conImagen.filter((p: Promo) => !p.titulo && !p.descripcion);
        new Set([...conImagen.slice(0, 6), ...soloImagen]).forEach(p => this.cargarImagen(p));
      },
      error: () => { this.cargando = false; if (ev) ev.target.complete(); },
    });
  }

  get filtradas(): Promo[] {
    const q = this.busqueda.trim().toLowerCase();
    if (!q) return this.promos;
    return this.promos.filter(p =>
      (p.titulo || '').toLowerCase().includes(q) || (p.descripcion || '').toLowerCase().includes(q));
  }
  get activas(): number { return this.promos.filter(p => p.activa).length; }
  get filtrando(): boolean { return !!this.busqueda.trim(); }

  abrirModal() { this.cancelar(); this.modalAbierto = true; }
  cerrarModal() { this.modalAbierto = false; this.cancelar(); }
  quitarImagen() { this.form.imagen = null; }

  // Si falla, simplemente no se pinta: la tarjeta cae al icono de siempre.
  cargarImagen(p: Promo) {
    this.svc.getImagen(p.id!).pipe(takeUntil(this.destroy$)).subscribe({
      next: r => { if (r.data) this.imagenes[p.id!] = r.data; },
      error: () => {},
    });
  }

  onFile(ev: any) {
    const file = ev.target?.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { this.form.imagen = reader.result as string; };
    reader.readAsDataURL(file);
  }

  // Título y descripción, o una imagen sola (la que el taller diseña con todo puesto).
  get valido(): boolean { return !!((this.form.titulo.trim() && this.form.descripcion.trim()) || this.form.imagen); }

  // Cómo se llama en la lista una promoción que es solo una imagen.
  nombre(p: Promo): string { return (p.titulo || '').trim() || 'Promoción con imagen'; }

  guardar() {
    if (!this.valido) { this.aviso('Pon un título y una descripción, o sube una imagen', 'warning'); return; }
    this.guardando = true;
    const editando = !!this.editId;
    const payload: any = {
      titulo: this.form.titulo.trim(),
      descripcion: this.form.descripcion.trim(),
      descuento: this.form.descuento || 0,
      precio_final: this.form.precio_final || null,
      imagen: this.form.imagen || null,
      activa: this.form.activa ? 1 : 0,
    };
    const op = editando ? this.svc.update(this.editId!, payload) : this.svc.create(payload);
    op.pipe(takeUntil(this.destroy$)).subscribe({
      next: () => { this.guardando = false; this.cerrarModal(); this.cargar(); this.aviso(editando ? 'Promoción actualizada' : 'Promoción creada'); },
      error: (err) => { this.guardando = false; this.aviso(err.error?.error || 'No se pudo guardar', 'danger'); },
    });
  }

  editar(p: Promo) {
    this.editId = p.id!;
    this.form = {
      titulo: p.titulo, descripcion: p.descripcion,
      descuento: p.descuento ?? null, precio_final: p.precio_final ?? null,
      imagen: this.imagenes[p.id!] || p.imagen || null, activa: !!p.activa,
    };
    this.modalAbierto = true;
  }

  cancelar() {
    this.editId = null;
    this.form = { titulo: '', descripcion: '', descuento: null, precio_final: null, imagen: null, activa: true };
  }

  toggle(p: Promo) {
    this.svc.toggle(p.id!).pipe(takeUntil(this.destroy$)).subscribe({ next: r => { p.activa = r.data.activa; } });
  }

  async borrar(p: Promo) {
    const al = await this.alert.create({
      cssClass: 'alert-light',
      header: 'Eliminar promoción',
      message: `¿Eliminar "${this.nombre(p)}"? No se puede deshacer.`,
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        { text: 'Eliminar', role: 'destructive', handler: () => {
            this.svc.delete(p.id!).pipe(takeUntil(this.destroy$)).subscribe({
              next: () => { this.promos = this.promos.filter(x => x.id !== p.id); this.aviso('Promoción eliminada'); },
              error: () => this.aviso('No se pudo eliminar', 'danger'),
            });
          } },
      ],
    });
    await al.present();
  }

  ngOnDestroy() { this.destroy$.next(); this.destroy$.complete(); }

  private async aviso(message: string, color = 'success') {
    const t = await this.toast.create({ message, duration: 1800, color });
    await t.present();
  }
}
