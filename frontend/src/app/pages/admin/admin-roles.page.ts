import { Component, OnDestroy, OnInit } from '@angular/core';
import { AlertController, ToastController } from '@ionic/angular';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { AdminService } from '../../services/admin.service';
import { PERMISOS_WEB_INFO } from './admin-roles.util';

type Catalogo = { grupo: string; permisos: { id: string; nombre: string }[] }[];
type PorBase = Record<string, { ajustables: string[]; fijas: string[] }>;
// Cómo se ve una casilla en el editor: se elige, va siempre, o no es de esa base.
type EstadoCasilla = 'elige' | 'fija' | 'fuera';

// Equipo → Roles: qué puede hacer cada rol, casilla por casilla, y los roles propios.
// Un rol propio parte de Mostrador o de Taller y solo puede quitar casillas de lo que
// esa base permite; las de Recepción y Mecánico también se pueden ajustar. El servidor
// las respeta en cada acción (backend/src/middleware/permisos.js). Lo que ve cada
// persona lo decide su sucursal, que se elige en Gestión de empleados.
@Component({
  standalone: false,
  selector: 'app-admin-roles',
  templateUrl: './admin-roles.page.html',
  styleUrls: ['./admin-roles.page.scss'],
})
export class AdminRolesPage implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  roles: any[] = [];
  catalogo: Catalogo = [];
  bases: Record<string, string> = {};
  basesPropias: PorBase = {};
  cargando = true;
  abierto: number | null = null;
  readonly webInfo = PERMISOS_WEB_INFO;

  // El editor: un rol que se está editando (su id), uno nuevo, o ninguno.
  editando: number | 'nuevo' | null = null;
  borrador = { nombre: '', base: 'mostrador', descripcion: '', permisos: [] as string[] };
  guardando = false;

  constructor(private admin: AdminService, private alert: AlertController, private toast: ToastController) {}

  ngOnInit() { this.cargar(); }
  ngOnDestroy() { this.destroy$.next(); this.destroy$.complete(); }

  cargar(abrir?: number) {
    this.admin.getRoles().pipe(takeUntil(this.destroy$)).subscribe({
      next: r => {
        this.roles = r.data.roles || [];
        this.catalogo = r.data.catalogo || [];
        this.bases = r.data.bases || {};
        this.basesPropias = r.data.bases_propias || {};
        if (abrir !== undefined) this.abierto = abrir;
        else if (this.abierto === null) this.abierto = this.roles[1]?.id ?? this.roles[0]?.id ?? null;
        this.cargando = false;
      },
      error: () => { this.cargando = false; },
    });
  }

  get basesElegibles(): string[] { return Object.keys(this.basesPropias); }
  get propios(): number { return this.roles.filter(r => !r.de_fabrica).length; }

  alternar(id: number) {
    if (this.editando === id) return;
    this.abierto = this.abierto === id ? null : id;
  }
  tiene(rol: any, permiso: string): boolean { return (rol.permisos || []).includes(permiso); }
  cuantas(rol: any, grupo: { permisos: { id: string }[] }): number { return grupo.permisos.filter(p => this.tiene(rol, p.id)).length; }

  // ── Editor ──
  nuevo() {
    const base = this.basesElegibles[0] || 'mostrador';
    // Arranca con lo mismo que el rol de fábrica de esa base: es más fácil quitar que
    // acordarse de todo lo que hay que marcar.
    this.borrador = { nombre: '', base, descripcion: '', permisos: [...this.permisosDeFabrica(base)] };
    this.editando = 'nuevo';
    this.abierto = null;
  }

  editar(r: any) {
    this.borrador = { nombre: r.nombre, base: r.base, descripcion: r.descripcion || '', permisos: [...(r.permisos || [])] };
    this.editando = r.id;
    this.abierto = r.id;
  }

  cancelar() { this.editando = null; }

  cambiarBase(base: string) {
    this.borrador.base = base;
    this.borrador.permisos = [...this.permisosDeFabrica(base)];
  }

  private permisosDeFabrica(base: string): string[] {
    const clave = base === 'taller' ? 'tecnico' : 'recepcion';
    const r = this.roles.find(x => x.clave === clave);
    const aj = this.basesPropias[base]?.ajustables || [];
    return (r?.permisos || []).filter((p: string) => aj.includes(p));
  }

  estado(permiso: string): EstadoCasilla {
    const b = this.basesPropias[this.borrador.base];
    if (b?.fijas.includes(permiso)) return 'fija';
    if (b?.ajustables.includes(permiso)) return 'elige';
    return 'fuera';
  }

  // Solo se muestran en el editor los grupos que tienen algo de esa base.
  gruposDelBorrador(): Catalogo {
    return this.catalogo
      .map(g => ({ ...g, permisos: g.permisos.filter(p => this.estado(p.id) !== 'fuera') }))
      .filter(g => g.permisos.length);
  }

  marcado(permiso: string): boolean {
    return this.estado(permiso) === 'fija' || this.borrador.permisos.includes(permiso);
  }

  alternarCasilla(permiso: string) {
    if (this.estado(permiso) !== 'elige') return;
    const i = this.borrador.permisos.indexOf(permiso);
    if (i >= 0) this.borrador.permisos.splice(i, 1);
    else this.borrador.permisos.push(permiso);
  }

  rolEditado(): any { return typeof this.editando === 'number' ? this.roles.find(r => r.id === this.editando) : null; }

  guardar() {
    if (this.guardando) return;
    const datos = {
      nombre: this.borrador.nombre.trim(),
      descripcion: this.borrador.descripcion.trim(),
      permisos: this.borrador.permisos.filter(p => this.estado(p) === 'elige'),
    };
    this.guardando = true;
    const pedido = this.editando === 'nuevo'
      ? this.admin.crearRol({ ...datos, base: this.borrador.base })
      : this.admin.guardarRol(this.editando as number, datos);
    pedido.pipe(takeUntil(this.destroy$)).subscribe({
      next: r => {
        this.guardando = false;
        this.editando = null;
        this.aviso(r.message || 'Rol guardado');
        this.cargar(r.data?.id);
      },
      // El servidor dice qué está mal y marca el campo (ErrorInterceptor).
      error: () => { this.guardando = false; },
    });
  }

  async restablecer(r: any) {
    const a = await this.alert.create({
      header: `¿Volver ${r.nombre} a lo de fábrica?`,
      message: 'Vuelve a tener las casillas con las que venía. Le cambia a todos los que tienen este rol.',
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        { text: 'Restablecer', handler: () => this.hacer(this.admin.restablecerRol(r.id), r.id) },
      ],
    });
    await a.present();
  }

  async eliminar(r: any) {
    const a = await this.alert.create({
      header: `¿Eliminar el rol «${r.nombre}»?`,
      message: r.empleados
        ? 'Primero pasá a sus empleados a otro rol en Gestión de empleados.'
        : 'No se puede deshacer.',
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        { text: 'Eliminar', role: 'destructive', handler: () => this.hacer(this.admin.eliminarRol(r.id)) },
      ],
    });
    await a.present();
  }

  private hacer(pedido: ReturnType<AdminService['eliminarRol']>, abrir?: number) {
    pedido.pipe(takeUntil(this.destroy$)).subscribe({
      next: r => { this.editando = null; this.aviso(r.message || 'Listo'); this.cargar(abrir); },
      error: () => {},
    });
  }

  private async aviso(mensaje: string) {
    const t = await this.toast.create({ message: mensaje, duration: 2500, color: 'success', position: 'bottom' });
    await t.present();
  }
}
