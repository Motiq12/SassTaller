import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { AlertController } from '@ionic/angular';
import { Subject, debounceTime, distinctUntilChanged } from 'rxjs';
import { ContactoDemo, MotiqService, ResumenPlataforma, TallerDelPanel } from '../../../services/motiq.service';
import { MarcaService } from '../../../services/marca.service';
import { ToastService } from '../../../services/toast.service';
import { PRODUCTO } from '../../../shared/producto';

/**
 * Panel de la plataforma: todos los talleres de Motiq en una pantalla, con lo que hace
 * falta para operarlos — cuántos son, cuánto usan el sistema, y cortarle o devolverle
 * el servicio a uno.
 *
 * Suspender pide un motivo y confirmación porque deja a un taller sin poder trabajar:
 * es la acción más destructiva del producto y no puede estar a un toque de distancia.
 */
@Component({
  selector: 'app-motiq-panel',
  templateUrl: './motiq-panel.page.html',
  styleUrls: ['./motiq-panel.page.scss'],
  standalone: false,
})
export class MotiqPanelPage implements OnInit {
  producto = PRODUCTO;
  resumen: ResumenPlataforma | null = null;
  talleres: TallerDelPanel[] = [];
  cargando = true;

  // Dos bandejas: los que ya son clientes y los que preguntaron desde la landing.
  vista: 'talleres' | 'contactos' = 'talleres';
  contactos: ContactoDemo[] = [];
  readonly ESTADOS_CONTACTO = ['nuevo', 'contactado', 'cerrado', 'descartado'];

  filtroEstado = '';
  busqueda = '';
  private escribiendo$ = new Subject<string>();

  // Los mismos que acepta el backend (PLANES en motiq.routes.js). Tenía cuatro y dos
  // no existían allá: elegirlos daba error 400. Mientras el plan no limite nada de
  // verdad, inventar escalones acá es prometer algo que el sistema no cumple.
  readonly PLANES = ['trial', 'pro'];

  constructor(
    private motiq: MotiqService,
    private marca: MarcaService,
    private alerta: AlertController,
    private toast: ToastService,
    private router: Router,
  ) {}

  get admin() { return this.motiq.admin; }

  ngOnInit() {
    this.marca.limpiar();   // este panel es de Motiq, no de ningún taller
    // Buscar en cada tecla dispararía una consulta por letra; se espera a que pare.
    this.escribiendo$.pipe(debounceTime(300), distinctUntilChanged())
      .subscribe(() => this.cargarTalleres());
    this.cargar();
  }

  cargar(ev?: any) {
    this.motiq.resumen().subscribe({
      next: (r) => (this.resumen = r.data),
      error: () => this.toast.error('No se pudo cargar el resumen'),
    });
    this.cargarContactos();
    this.cargarTalleres(ev);
  }

  cargarContactos() {
    this.motiq.contactos().subscribe({
      next: (r) => (this.contactos = r.data),
      error: () => this.toast.error('No se pudieron cargar los contactos'),
    });
  }

  // Mover a alguien en el embudo, con la nota de qué pasó en la llamada. La nota es
  // lo que evita que dentro de tres semanas nadie recuerde por qué se descartó.
  async atender(c: ContactoDemo) {
    const a = await this.alerta.create({
      header: c.nombre,
      subHeader: c.empresa || c.email,
      inputs: [
        ...this.ESTADOS_CONTACTO.map((e) => ({
          type: 'radio' as const, label: this.rotuloContacto(e), value: e, checked: c.estado === e,
        })),
      ],
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Guardar',
          handler: (estado: string) => {
            if (!estado || estado === c.estado) return true;
            this.motiq.actualizarContacto(c.id, estado, c.nota_interna || '').subscribe({
              next: () => { this.toast.success('Contacto actualizado'); this.cargar(); },
              error: (e) => this.toast.error(e?.error?.error || 'No se pudo actualizar'),
            });
            return true;
          },
        },
      ],
    });
    await a.present();
  }

  // Del contacto al taller andando. El nombre y el identificador se confirman acá porque
  // lo que la persona escribió en "Empresa" al pedir la demo suele ser aproximado, y el
  // identificador termina siendo su dirección pública: conviene mirarlo antes.
  async crearTaller(c: ContactoDemo) {
    const a = await this.alerta.create({
      header: 'Crear el taller',
      message: `Se crea con ${c.email} como administrador y se le genera una contraseña.`,
      inputs: [
        { name: 'nombre', type: 'text', placeholder: 'Nombre del taller', value: c.empresa || '' },
        { name: 'slug', type: 'text', placeholder: 'Identificador (opcional, sale del nombre)' },
      ],
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Crear',
          handler: (d: { nombre: string; slug: string }) => {
            if (!d.nombre?.trim()) { this.toast.error('Falta el nombre del taller'); return false; }
            this.motiq.crearTallerDesdeContacto(c.id, d.nombre.trim(), d.slug?.trim()).subscribe({
              next: (r) => { this.mostrarCredenciales(r.data); this.cargar(); },
              error: (e) => this.toast.error(e?.error?.error || 'No se pudo crear el taller'),
            });
            return true;
          },
        },
      ],
    });
    await a.present();
  }

  // La contraseña se muestra UNA vez: en la base solo queda el hash. Va en un diálogo
  // que hay que cerrar a mano, no en un toast que se va solo a los tres segundos.
  private async mostrarCredenciales(d: { taller: { nombre: string; slug: string }; admin: { email: string; password: string } }) {
    const a = await this.alerta.create({
      header: `${d.taller.nombre} creado`,
      message: `Identificador: ${d.taller.slug}<br><br>`
        + `Usuario: ${d.admin.email}<br>`
        + `Contraseña: <strong>${d.admin.password}</strong><br><br>`
        + 'Anotala ahora: no se vuelve a mostrar.',
      buttons: ['Ya la guardé'],
      backdropDismiss: false,
    });
    await a.present();
  }

  rotuloContacto(e: string): string {
    return { nuevo: 'Sin atender', contactado: 'Ya lo contacté', cerrado: 'Cerrado', descartado: 'Descartado' }[e] || e;
  }

  colorContacto(e: string): string {
    return { nuevo: 'warning', contactado: 'primary', cerrado: 'success', descartado: 'medium' }[e] || 'medium';
  }

  cargarTalleres(ev?: any) {
    this.cargando = true;
    this.motiq.talleres({ estado: this.filtroEstado, q: this.busqueda.trim() }).subscribe({
      next: (r) => {
        this.talleres = r.data;
        this.cargando = false;
        ev?.target?.complete();
      },
      error: () => {
        this.cargando = false;
        ev?.target?.complete();
        this.toast.error('No se pudieron cargar los talleres');
      },
    });
  }

  alEscribir(valor: string) {
    this.busqueda = valor;
    this.escribiendo$.next(valor);
  }

  async suspender(t: TallerDelPanel) {
    const a = await this.alerta.create({
      header: `Suspender ${t.nombre}`,
      message: 'Deja de funcionar de inmediato, también para las sesiones que estén abiertas. Sus datos no se borran.',
      inputs: [{ name: 'motivo', type: 'text', placeholder: 'Motivo (queda registrado)', attributes: { maxlength: 200 } }],
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Suspender',
          role: 'destructive',
          handler: (datos) => {
            const motivo = String(datos.motivo || '').trim();
            if (!motivo) {
              this.toast.error('Indicá el motivo de la suspensión');
              return false;   // deja el diálogo abierto en vez de perder lo escrito
            }
            this.aplicarEstado(t, 'suspendido', motivo);
            return true;
          },
        },
      ],
    });
    await a.present();
  }

  async reactivar(t: TallerDelPanel) {
    const a = await this.alerta.create({
      header: `Reactivar ${t.nombre}`,
      message: 'Vuelve a funcionar enseguida, con todo lo que tenía.',
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        { text: 'Reactivar', handler: () => { this.aplicarEstado(t, 'activo'); return true; } },
      ],
    });
    await a.present();
  }

  private aplicarEstado(t: TallerDelPanel, estado: string, motivo?: string) {
    this.motiq.cambiarEstado(t.id, estado, motivo).subscribe({
      next: (r) => { this.toast.success(r.message); this.cargar(); },
      error: (e) => this.toast.error(e?.error?.error || 'No se pudo cambiar el estado'),
    });
  }

  async cambiarPlan(t: TallerDelPanel) {
    const a = await this.alerta.create({
      header: `Plan de ${t.nombre}`,
      inputs: this.PLANES.map((p) => ({
        type: 'radio' as const, label: this.rotuloPlan(p), value: p, checked: t.plan === p,
      })),
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Guardar',
          handler: (plan: string) => {
            if (!plan || plan === t.plan) return true;
            this.motiq.cambiarPlan(t.id, plan).subscribe({
              next: (r) => { this.toast.success(r.message); this.cargar(); },
              error: (e) => this.toast.error(e?.error?.error || 'No se pudo cambiar el plan'),
            });
            return true;
          },
        },
      ],
    });
    await a.present();
  }

  rotuloPlan(p: string): string {
    return { trial: 'Prueba', basico: 'Básico', pro: 'Pro', enterprise: 'Enterprise' }[p] || p;
  }

  colorEstado(e: string): string {
    return { activo: 'success', suspendido: 'danger', cancelado: 'medium' }[e] || 'medium';
  }

  salir() {
    this.motiq.logout();
    this.router.navigate(['/motiq/login'], { replaceUrl: true });
  }
}
