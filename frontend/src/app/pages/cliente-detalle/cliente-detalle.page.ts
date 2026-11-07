import { Component, OnInit, OnDestroy } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { enPanel, rutaPanel } from '../../shared/ruta-panel';
import { AlertController, ToastController } from '@ionic/angular';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { ClientesService } from '../../services/clientes.service';
import { AuthService } from '../../services/auth.service';
import { Cliente } from '../../models/cliente.model';
import { Moto } from '../../models/moto.model';
import { Orden } from '../../models/orden.model';
import { abrirWhatsApp } from '../../shared/whatsapp.util';
import { MensajesService } from '../../services/mensajes.service';

@Component({ standalone: false,
  selector: 'app-cliente-detalle',
  templateUrl: './cliente-detalle.page.html',
  styleUrls: ['./cliente-detalle.page.scss'],
})
export class ClienteDetallePage implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  cliente: Cliente | null = null;
  motos: Moto[] = [];
  ordenes: Orden[] = [];
  cargando = true;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private clienteSvc: ClientesService,
    private auth: AuthService,
    private alert: AlertController,
    private toast: ToastController,
    private mensajes: MensajesService
  ) {}

  // La lista de clientes vive en dos lugares según el rol: recepción tiene la suya
  // y el resto del personal la ve dentro de las pestañas. No existe un /clientes suelto.
  private rutaListaClientes(): string {
    if (enPanel(this.router)) return '/admin/clientes';
    return this.auth.getUsuario()?.rol === 'recepcion' ? '/recepcion/clientes' : '/admin/clientes';
  }
  // A dónde vuelve la flecha si no hay historial (se abrió con un enlace directo).
  get listaClientes(): string { return this.rutaListaClientes(); }

  // Abierta desde el panel de administración (ver shared/ruta-panel.ts).
  get dentroDelPanel(): boolean { return enPanel(this.router); }

  get iniciales(): string {
    const c = this.cliente;
    return ((c?.nombre?.[0] || '') + (c?.apellido?.[0] || '')).toUpperCase() || '?';
  }
  // "octubre de 2026"
  get clienteDesde(): string {
    const f = this.cliente?.created_at;
    return f ? new Date(f).toLocaleDateString('es-CR', { month: 'long', year: 'numeric' }) : '';
  }
  get ordenesActivas(): number { return this.ordenes.filter(o => !['entregada', 'cancelada'].includes(o.estado as string)).length; }

  // Los montos solo para quien ve precios: administración y recepción (el mecánico
  // no ve precios, ver utils/permisos.js).
  get verMontos(): boolean { return this.auth.tieneRol('admin', 'recepcion'); }
  totalDe(o: any): number { return (Number(o.costo_mano_obra) || 0) + (Number(o.costo_repuestos) || 0) - (Number(o.descuento) || 0); }
  get totalCobrado(): number { return this.ordenes.filter(o => o.estado === 'entregada').reduce((n, o) => n + this.totalDe(o), 0); }

  whatsapp() { if (this.cliente?.telefono) abrirWhatsApp(this.cliente.telefono, ''); }

  ngOnInit() {
    this.mensajes.precargar();
    const id = +(this.route.snapshot.paramMap.get('id') || 0);
    this.recargar(id);
  }

  recargar(id: number) {
    this.clienteSvc.getById(id).pipe(takeUntil(this.destroy$)).subscribe(res => { this.cliente = res.data; this.cargando = false; });
    this.clienteSvc.getMotos(id).pipe(takeUntil(this.destroy$)).subscribe(res => this.motos = res.data);
    this.clienteSvc.getOrdenes(id).pipe(takeUntil(this.destroy$)).subscribe(res => this.ordenes = res.data);
  }

  editarCliente() { this.router.navigate([rutaPanel(this.router, '/cliente-form'), this.cliente!.id]); }
  nuevaMoto() { this.router.navigate([rutaPanel(this.router, '/moto-form')], { queryParams: { cliente_id: this.cliente!.id } }); }
  abrirOrden(id: number) { this.router.navigate([rutaPanel(this.router, '/detalle-orden'), id]); }
  abrirHistorial(moto: Moto) { this.router.navigate([rutaPanel(this.router, '/moto-historial'), moto.id]); }

  async canjearCortesia() {
    const conf = await this.alert.create({
      header: 'Canjear cortesía',
      message: `¿Confirmás el uso de la cortesía de ${this.cliente!.nombre}? Se aplicará a un servicio.`,
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Canjear',
          handler: () => {
            this.clienteSvc.canjearCortesia(this.cliente!.id!).pipe(takeUntil(this.destroy$)).subscribe({
              next: () => { this.cliente!.cortesia_disponible = 0; this.mostrarToast('Cortesía canjeada'); },
              error: err => this.mostrarToast(err.error?.error || 'Error', 'danger'),
            });
          },
        },
      ],
    });
    await conf.present();
  }

  // ===== Acceso al portal del cliente =====
  async activarPortal() {
    if (!this.cliente?.email) {
      this.mostrarAlert('Falta email', 'El cliente necesita un correo registrado para acceder al portal. Editá el cliente y agregá su email.');
      return;
    }
    const a = await this.alert.create({
      header: this.cliente.tiene_portal ? 'Cambiar contraseña' : 'Activar portal',
      message: `Definí una contraseña para que ${this.cliente.nombre} acceda al portal con su correo ${this.cliente.email}.`,
      inputs: [{ name: 'password', type: 'password', placeholder: 'Contraseña (mín. 6 caracteres)' }],
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Guardar',
          handler: (data) => {
            if (!data.password || data.password.length < 6) {
              this.mostrarToast('La contraseña debe tener al menos 6 caracteres', 'danger');
              return false;
            }
            this.clienteSvc.setPortal(this.cliente!.id!, { password: data.password }).pipe(takeUntil(this.destroy$)).subscribe({
              next: () => {
                this.cliente!.tiene_portal = 1;
                this.compartirCredenciales(data.password);
              },
              error: err => this.mostrarToast(err.error?.error || 'Error', 'danger'),
            });
            return true;
          },
        },
      ],
    });
    await a.present();
  }

  async desactivarPortal() {
    const conf = await this.alert.create({
      header: 'Desactivar portal',
      message: '¿Quitar el acceso del cliente al portal?',
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Desactivar', role: 'destructive',
          handler: () => {
            this.clienteSvc.setPortal(this.cliente!.id!, { activar: false }).pipe(takeUntil(this.destroy$)).subscribe({
              next: () => { this.cliente!.tiene_portal = 0; this.mostrarToast('Acceso desactivado'); },
            });
          },
        },
      ],
    });
    await conf.present();
  }

  // Saca al cliente del sistema. Sus órdenes y facturación se conservan (van
  // ligadas por columnas NOT NULL), pero se borran sus datos personales y accesos.
  async eliminarCliente() {
    const conf = await this.alert.create({
      header: 'Eliminar cliente',
      message: `¿Eliminar a ${this.cliente!.nombre} ${this.cliente!.apellido || ''}? Se borran sus datos personales, su acceso al portal y sus motos salen de los listados. Las órdenes y facturas ya registradas se conservan. No se puede deshacer.`,
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Eliminar', role: 'destructive',
          handler: () => {
            this.clienteSvc.eliminar(this.cliente!.id!).pipe(takeUntil(this.destroy$)).subscribe({
              next: () => {
                this.mostrarToast('Cliente eliminado');
                // replaceUrl: el detalle sale del historial, así el botón "atrás"
                // no vuelve a la ficha de un cliente que ya no existe.
                this.router.navigate([this.rutaListaClientes()], { replaceUrl: true });
              },
              error: (e) => this.mostrarToast(e.error?.error || 'No se pudo eliminar'),
            });
          },
        },
      ],
    });
    await conf.present();
  }

  // Abre WhatsApp con las credenciales y el link del portal para enviárselas al cliente
  async compartirCredenciales(password: string) {
    const url = `${location.origin}/portal/login`;
    const msg = this.mensajes.armar('portal_acceso', { nombre: this.cliente!.nombre, portal: url, usuario: this.cliente!.email, contrasena: password });
    const a = await this.alert.create({
      header: 'Portal activado',
      message: 'Enviá las credenciales al cliente por WhatsApp.',
      buttons: [
        { text: 'Cerrar', role: 'cancel' },
        { text: 'Enviar por WhatsApp', handler: () => { abrirWhatsApp(this.cliente!.telefono || '', msg); } },
      ],
    });
    await a.present();
  }

  private async mostrarToast(message: string, color = 'success') {
    const t = await this.toast.create({ message, duration: 2200, color });
    await t.present();
  }

  ngOnDestroy() { this.destroy$.next(); this.destroy$.complete(); }

  private async mostrarAlert(header: string, message: string) {
    const a = await this.alert.create({ header, message, buttons: ['OK'] });
    await a.present();
  }
}
