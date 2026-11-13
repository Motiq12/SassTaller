import { Component, OnInit, OnDestroy } from '@angular/core';
import { ToastController } from '@ionic/angular';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { AdminService } from '../../services/admin.service';
import { InventarioService, Repuesto, MovimientoInventario, DatosRepuesto } from '../../services/inventario.service';

type Modal = null | 'repuesto' | 'entrada' | 'ajuste' | 'movimientos';

// Inventario de repuestos: catálogo, cuántos hay en cada sucursal, compras y ajustes.
// Las salidas no se cargan acá: salen solas al entregar una orden que usó el repuesto.
@Component({
  standalone: false,
  selector: 'app-admin-inventario',
  templateUrl: './admin-inventario.page.html',
  styleUrls: ['./admin-inventario.page.scss'],
})
export class AdminInventarioPage implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  repuestos: Repuesto[] = [];
  sucursales: { id: number; nombre: string }[] = [];
  sucursalId: number | null = null;
  busqueda = '';
  soloBajos = false;
  verInactivos = false;
  cargando = true;
  guardando = false;

  modal: Modal = null;
  elegido: Repuesto | null = null;
  form: DatosRepuesto = this.vacio();
  entradaForm = { cantidad: null as number | null, costo_unitario: null as number | null, proveedor: '', documento: '', nota: '', sucursal_id: null as number | null };
  ajusteForm = { conteo: null as number | null, nota: '', sucursal_id: null as number | null };
  movimientos: MovimientoInventario[] = [];
  cargandoMovs = false;

  constructor(private inv: InventarioService, private admin: AdminService, private toast: ToastController) {}

  ngOnInit() {
    this.admin.getSucursales().pipe(takeUntil(this.destroy$)).subscribe({
      next: r => {
        this.sucursales = (r.data || []).filter((s: any) => Number(s.activa) !== 0).map((s: any) => ({ id: s.id, nombre: s.nombre }));
        if (this.sucursales.length === 1) this.sucursalId = this.sucursales[0].id;
        this.cargar();
      },
      error: () => this.cargar(),
    });
  }
  ionViewWillEnter() { if (!this.cargando) this.cargar(); }
  ngOnDestroy() { this.destroy$.next(); this.destroy$.complete(); }

  cargar(ev?: any) {
    this.cargando = true;
    this.inv.listar({ sucursal_id: this.sucursalId, inactivos: this.verInactivos }).pipe(takeUntil(this.destroy$)).subscribe({
      next: r => { this.repuestos = r.data || []; this.cargando = false; ev?.target?.complete(); },
      error: () => { this.cargando = false; ev?.target?.complete(); }, // el ErrorInterceptor ya avisa
    });
  }

  get filtrados(): Repuesto[] {
    const q = this.busqueda.trim().toLowerCase();
    return this.repuestos.filter(r =>
      (!this.soloBajos || r.bajo) &&
      (!q || `${r.nombre} ${r.codigo || ''} ${r.marca || ''}`.toLowerCase().includes(q)));
  }
  get cuantosBajos(): number { return this.repuestos.filter(r => r.bajo).length; }
  get valorInventario(): number {
    return this.repuestos.reduce((s, r) => s + Math.max(0, r.existencia) * Number(r.costo || 0), 0);
  }
  get nombreSucursal(): string {
    return this.sucursales.find(s => s.id === this.sucursalId)?.nombre || 'todas las sucursales';
  }
  get variasSucursales(): boolean { return this.sucursales.length > 1; }

  // ── Alta y edición ──
  private vacio(): DatosRepuesto {
    return { codigo: '', nombre: '', marca: '', unidad: 'unidad', costo: null, precio: null, minimo: 0, existencia_inicial: null, sucursal_id: null };
  }
  nuevo() {
    this.elegido = null;
    this.form = { ...this.vacio(), sucursal_id: this.sucursalId };
    this.modal = 'repuesto';
  }
  editar(r: Repuesto) {
    this.elegido = r;
    this.form = { codigo: r.codigo || '', nombre: r.nombre, marca: r.marca || '', unidad: r.unidad, costo: Number(r.costo), precio: Number(r.precio), minimo: r.minimo };
    this.modal = 'repuesto';
  }
  guardar() {
    if (!this.form.nombre?.trim()) { this.aviso('Escribí el nombre del repuesto', 'warning'); return; }
    this.guardando = true;
    const editando = this.elegido;
    const datos = { ...this.form, nombre: this.form.nombre.trim() };
    const req$ = editando ? this.inv.editar(editando.id, datos) : this.inv.crear(datos);
    req$.pipe(takeUntil(this.destroy$)).subscribe({
      next: r => { this.guardando = false; this.cerrar(); this.cargar(); this.aviso(r.message); },
      error: () => { this.guardando = false; },
    });
  }
  cambiarActivo(r: Repuesto) {
    this.inv.activar(r.id, !r.activo).pipe(takeUntil(this.destroy$)).subscribe({
      next: x => { this.cargar(); this.aviso(x.message); },
      error: () => {},
    });
  }

  // ── Compra (entrada) ──
  abrirEntrada(r: Repuesto) {
    this.elegido = r;
    this.entradaForm = { cantidad: null, costo_unitario: Number(r.costo) || null, proveedor: '', documento: '', nota: '', sucursal_id: this.sucursalId };
    this.modal = 'entrada';
  }
  guardarEntrada() {
    const f = this.entradaForm;
    if (!f.cantidad || f.cantidad <= 0) { this.aviso('Escribí cuántas unidades entraron', 'warning'); return; }
    if (!f.sucursal_id) { this.aviso('Elegí la sucursal', 'warning'); return; }
    this.guardando = true;
    this.inv.entrada(this.elegido!.id, { ...f, cantidad: Number(f.cantidad) }).pipe(takeUntil(this.destroy$)).subscribe({
      next: r => { this.guardando = false; this.cerrar(); this.cargar(); this.aviso(`${r.message}: quedan ${r.data.existencia}`); },
      error: () => { this.guardando = false; },
    });
  }

  // ── Conteo físico (ajuste) ──
  abrirAjuste(r: Repuesto) {
    this.elegido = r;
    this.ajusteForm = { conteo: null, nota: '', sucursal_id: this.sucursalId };
    this.modal = 'ajuste';
  }
  guardarAjuste() {
    const f = this.ajusteForm;
    if (f.conteo === null || f.conteo === undefined || f.conteo < 0) { this.aviso('Escribí cuántas contaste', 'warning'); return; }
    if (!f.sucursal_id) { this.aviso('Elegí la sucursal', 'warning'); return; }
    if (f.nota.trim().length < 3) { this.aviso('Escribí el motivo del ajuste', 'warning'); return; }
    this.guardando = true;
    this.inv.ajuste(this.elegido!.id, { conteo: Number(f.conteo), sucursal_id: f.sucursal_id, nota: f.nota.trim() }).pipe(takeUntil(this.destroy$)).subscribe({
      next: r => {
        this.guardando = false; this.cerrar(); this.cargar();
        const d = r.data.diferencia;
        this.aviso(`Ajuste registrado: ${d > 0 ? '+' : ''}${d}. Quedan ${r.data.existencia}`);
      },
      error: () => { this.guardando = false; },
    });
  }

  // ── Historial ──
  verMovimientos(r: Repuesto) {
    this.elegido = r;
    this.movimientos = [];
    this.cargandoMovs = true;
    this.modal = 'movimientos';
    this.inv.movimientos(r.id, this.sucursalId).pipe(takeUntil(this.destroy$)).subscribe({
      next: x => { this.movimientos = x.data || []; this.cargandoMovs = false; },
      error: () => { this.cargandoMovs = false; },
    });
  }
  textoMovimiento(m: MovimientoInventario): string {
    if (m.tipo === 'salida') return m.numero_orden ? `Orden ${m.numero_orden}` : 'Salida';
    if (m.tipo === 'entrada') return [m.proveedor, m.documento].filter(Boolean).join(' · ') || m.nota || 'Entrada';
    return m.nota || 'Ajuste';
  }

  cerrar() { this.modal = null; }

  private async aviso(message: string, color = 'success') {
    const t = await this.toast.create({ message, duration: 2400, color });
    await t.present();
  }
}
