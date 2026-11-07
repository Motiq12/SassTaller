import { Component, OnInit, OnDestroy } from '@angular/core';
import { AlertController, ToastController } from '@ionic/angular';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { UsuariosService } from '../../services/usuarios.service';
import { AdminService } from '../../services/admin.service';
import { Usuario } from '../../models/usuario.model';
import { sitioWeb } from '../../sitio-web-activo';

@Component({
  standalone: false,
  selector: 'app-admin-empleados',
  templateUrl: './admin-empleados.page.html',
  styleUrls: ['./admin-empleados.page.scss'],
})
export class AdminEmpleadosPage implements OnInit, OnDestroy {
  // Sitio web en pausa: no se ofrece el rol Contenido ni los permisos del sitio.
  get sitioWebActivo(): boolean { return sitioWeb.activo; }
  private destroy$ = new Subject<void>();
  usuarios: Usuario[] = [];
  sucursales: any[] = [];
  cargando = true;
  creando = false;
  verPass = false;
  nuevo = { nombre: '', email: '', password: '', password2: '', rol: 'tecnico', rol_id: null as number | null, eleccion: 'tecnico', telefono: '', sucursal_id: null as number | null, permisos_web: {} as Record<string, boolean> };

  // Roles propios (Equipo → Roles). Se ofrecen junto a los de fábrica; uno de
  // Mostrador usa la pantalla de recepción y uno de Taller la del mecánico.
  rolesPropios: { id: number; nombre: string; base: string }[] = [];
  private readonly ROL_DE_BASE: Record<string, Usuario['rol']> = { mostrador: 'recepcion', taller: 'tecnico' };
  readonly BASE_LABEL: Record<string, string> = { mostrador: 'mostrador', taller: 'taller' };

  readonly rolLabel: Record<string, string> = {
    tecnico: 'Mecánico', recepcion: 'Recepcionista', admin: 'Administración', contenido: 'Contenido web',
  };

  // Casillas de permisos del sitio web (las define el backend: utils/permisos-web.js).
  permisosWeb: { id: string; nombre: string; descripcion: string }[] = [];

  eliminando: number | null = null;

  // Alta y edición viven las dos en el modal, en cualquier ancho: la lista se lleva
  // la pantalla, que es lo que se viene a mirar.
  modalAbierto = false;
  busqueda = '';
  editandoId: number | null = null;
  editando = {
    nombre: '', email: '', telefono: '',
    rol: 'tecnico' as Usuario['rol'],
    rol_id: null as number | null,
    eleccion: 'tecnico',
    sucursal_id: null as number | null,
    permisos_web: {} as Record<string, boolean>,
  };

  constructor(
    private svc: UsuariosService,
    private admin: AdminService,
    private toast: ToastController,
    private alert: AlertController,
  ) {}

  ngOnInit() {
    this.cargar();
    this.cargarSucursales();
    this.svc.getPermisosWeb().pipe(takeUntil(this.destroy$)).subscribe({ next: r => this.permisosWeb = r.data, error: () => {} });
    this.cargarRoles();
  }

  private cargarRoles() {
    this.admin.getRoles().pipe(takeUntil(this.destroy$)).subscribe({
      next: r => { this.rolesPropios = (r.data.roles || []).filter((x: any) => !x.de_fabrica); },
      error: () => {},
    });
  }

  // El selector de rol: un rol de fábrica ('recepcion', 'tecnico'…) o uno propio
  // ('r:12'). De ahí salen el rol del sistema y el rol propio que se mandan a la API.
  elegir(destino: { rol: string; rol_id: number | null; eleccion: string }, valor: string) {
    destino.eleccion = valor;
    if (valor.startsWith('r:')) {
      const id = Number(valor.slice(2));
      const rol = this.rolesPropios.find(x => x.id === id);
      destino.rol_id = id;
      destino.rol = (rol && this.ROL_DE_BASE[rol.base]) || 'recepcion';
    } else {
      destino.rol_id = null;
      destino.rol = valor as Usuario['rol'];
    }
  }

  // Cómo se llama el rol de alguien en la lista: el propio, si tiene, o el de fábrica.
  nombreRol(u: Usuario): string {
    return u.rol_nombre || this.rolLabel[u.rol] || u.rol;
  }

  // ¿Tiene algún permiso sobre el sitio web? (para la etiqueta en la lista)
  tieneWeb(u: Usuario): boolean {
    return u.rol === 'admin' || Object.values(u.permisos_web || {}).some(Boolean);
  }

  // Lo que se manda a la API: el admin puede todo, así que no lleva permisos.
  private permisosParaEnviar(rol: string, permisos: Record<string, boolean>): Record<string, boolean> {
    if (rol === 'admin') return {};
    const elegidos: Record<string, boolean> = {};
    for (const [id, v] of Object.entries(permisos)) if (v) elegidos[id] = true;
    return elegidos;
  }

  // Un colaborador de contenido sin ningún permiso no podría hacer nada.
  private faltanPermisos(rol: string, permisos: Record<string, boolean>): boolean {
    return rol === 'contenido' && !Object.values(permisos).some(Boolean);
  }

  get filtrados(): Usuario[] {
    const q = this.busqueda.trim().toLowerCase();
    if (!q) return this.usuarios;
    return this.usuarios.filter(u =>
      [u.nombre, u.email, u.telefono, this.nombreRol(u)]
        .some(c => (c || '').toLowerCase().includes(q)));
  }
  get activos(): number { return this.usuarios.filter(u => u.activo).length; }
  get filtrando(): boolean { return !!this.busqueda.trim(); }
  ionViewWillEnter() { this.cargar(); }

  abrirModal() { this.editandoId = null; this.modalAbierto = true; }
  cerrarModal() { this.modalAbierto = false; this.editandoId = null; }

  abrirEdicion(u: Usuario) {
    this.editandoId = u.id!;
    this.editando = {
      nombre: u.nombre || '',
      email: u.email || '',
      rol: u.rol || 'tecnico',
      rol_id: u.rol_id ?? null,
      eleccion: u.rol_id ? 'r:' + u.rol_id : (u.rol || 'tecnico'),
      telefono: u.telefono || '',
      sucursal_id: u.sucursal_id ?? null,
      permisos_web: { ...(u.permisos_web || {}) },
    };
    this.modalAbierto = true;
  }

  get edicionValida(): boolean {
    return !!(this.editando.nombre.trim() && this.editando.email.trim());
  }

  guardarEdicion() {
    if (!this.edicionValida) { this.aviso('Nombre y correo son requeridos', 'warning'); return; }
    if (this.faltanPermisos(this.editando.rol, this.editando.permisos_web)) { this.aviso('Marcá al menos un permiso del sitio web', 'warning'); return; }
    this.creando = true;
    this.svc.update(this.editandoId!, {
      nombre: this.editando.nombre.trim(),
      email: this.editando.email.trim(),
      rol: this.editando.rol,
      rol_id: this.editando.rol_id,
      telefono: this.editando.telefono.trim() || undefined,
      sucursal_id: this.editando.sucursal_id,
      permisos_web: this.permisosParaEnviar(this.editando.rol, this.editando.permisos_web),
    }).pipe(takeUntil(this.destroy$)).subscribe({
      next: () => { this.creando = false; this.cerrarModal(); this.cargar(); this.aviso('Empleado actualizado'); },
      // El backend rechaza que un admin se quite a sí mismo el rol de admin: ese
      // mensaje es el que hay que mostrar tal cual, no uno genérico.
      error: e => { this.creando = false; this.aviso(e.error?.error || 'No se pudo actualizar', 'danger'); },
    });
  }

  cargar() {
    this.cargando = true;
    this.svc.getAll().pipe(takeUntil(this.destroy$)).subscribe({
      next: r => { this.usuarios = r.data; this.cargando = false; },
      error: () => { this.cargando = false; },
    });
  }

  cargarSucursales() {
    this.admin.getSucursales().pipe(takeUntil(this.destroy$)).subscribe({ next: r => this.sucursales = (r.data || []).filter((s: any) => s.activa) });
  }

  // Cambia el local de un empleado desde la lista (null = atiende ambas).
  cambiarSucursal(u: Usuario, valor: any) {
    const sucursal_id = valor === '' || valor == null ? null : Number(valor);
    this.svc.setSucursal(u.id!, sucursal_id).pipe(takeUntil(this.destroy$)).subscribe({
      next: () => {
        u.sucursal_id = sucursal_id;
        u.sucursal_nombre = this.sucursales.find(s => s.id === sucursal_id)?.nombre || null;
        this.aviso('Sucursal actualizada');
      },
      error: (e) => this.aviso(e.error?.error || 'No se pudo cambiar', 'danger'),
    });
  }

  // ¿Las dos contraseñas coinciden? (solo relevante si ya escribió la confirmación)
  get passCoincide(): boolean {
    return this.nuevo.password === this.nuevo.password2;
  }

  get valido(): boolean {
    return !!(this.nuevo.nombre.trim() && this.nuevo.email.trim() &&
      this.nuevo.password && this.nuevo.password2 && this.passCoincide && this.nuevo.rol);
  }

  crear() {
    if (this.nuevo.password && !this.passCoincide) { this.aviso('Las contraseñas no coinciden', 'warning'); return; }
    if (!this.valido) { this.aviso('Completá nombre, email, contraseña y rol', 'warning'); return; }
    if (this.faltanPermisos(this.nuevo.rol, this.nuevo.permisos_web)) { this.aviso('Marcá al menos un permiso del sitio web', 'warning'); return; }
    this.creando = true;
    this.svc.create({
      nombre: this.nuevo.nombre.trim(),
      email: this.nuevo.email.trim(),
      password: this.nuevo.password,
      rol: this.nuevo.rol,
      rol_id: this.nuevo.rol_id,
      telefono: this.nuevo.telefono.trim() || undefined,
      sucursal_id: this.nuevo.rol === 'contenido' ? null : this.nuevo.sucursal_id,
      permisos_web: this.permisosParaEnviar(this.nuevo.rol, this.nuevo.permisos_web),
    }).pipe(takeUntil(this.destroy$)).subscribe({
      next: () => {
        this.creando = false;
        this.nuevo = { nombre: '', email: '', password: '', password2: '', rol: 'tecnico', rol_id: null, eleccion: 'tecnico', telefono: '', sucursal_id: null, permisos_web: {} };
        this.cerrarModal();   // en escritorio no hay modal abierto, así que no molesta
        this.cargar();
        this.aviso('Empleado creado');
      },
      error: (err) => { this.creando = false; this.aviso(err.error?.error || 'No se pudo crear', 'danger'); },
    });
  }

  // Borrado definitivo (pide confirmación). Se van sus tareas, avances y mensajes;
  // las citas y órdenes del taller quedan, pero sin él como responsable.
  async eliminar(u: Usuario) {
    const al = await this.alert.create({
      header: 'Eliminar empleado',
      message: `¿Eliminar a ${u.nombre} definitivamente? Se borrarán sus tareas, avances y mensajes. Sus citas y órdenes se conservan, pero quedarán sin responsable asignado. Esta acción no se puede deshacer.`,
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        { text: 'Eliminar', role: 'destructive', handler: () => this.confirmarEliminar(u) },
      ],
    });
    await al.present();
  }

  private confirmarEliminar(u: Usuario) {
    this.eliminando = u.id!;
    this.svc.eliminar(u.id!).pipe(takeUntil(this.destroy$)).subscribe({
      next: async () => {
        this.eliminando = null;
        this.usuarios = this.usuarios.filter(x => x.id !== u.id);
        const t = await this.toast.create({ message: 'Empleado eliminado', duration: 2000, color: 'success' });
        await t.present();
      },
      error: async (err) => {
        this.eliminando = null;
        const t = await this.toast.create({
          message: err.error?.error || 'No se pudo eliminar',
          duration: 5000,
          color: 'warning',
        });
        await t.present();
      },
    });
  }

  toggle(u: Usuario) {
    this.svc.toggleActivo(u.id!, !u.activo).pipe(takeUntil(this.destroy$)).subscribe({ next: () => { u.activo = u.activo ? 0 : 1; } });
  }

  ngOnDestroy() { this.destroy$.next(); this.destroy$.complete(); }

  iniciales(n?: string): string {
    const p = (n || '?').trim().split(/\s+/);
    return ((p[0]?.[0] || '') + (p[1]?.[0] || '')).toUpperCase();
  }
  avatarColor(rol?: string): string { return rol === 'recepcion' ? 'am' : (rol === 'tecnico' ? 'in' : ''); }

  private async aviso(message: string, color = 'success') {
    const t = await this.toast.create({ message, duration: 1800, color });
    await t.present();
  }
}
