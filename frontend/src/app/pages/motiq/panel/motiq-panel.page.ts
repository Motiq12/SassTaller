import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { AlertController } from '@ionic/angular';
import { Subject, debounceTime, distinctUntilChanged } from 'rxjs';
import {
  ContactoDemo, CuentaPlataforma, FichaTaller, MiEspacio, MotiqService, Pendiente,
  ResumenPlataforma, TallerDelPanel, TallerInactivo, Vencimiento,
} from '../../../services/motiq.service';
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

  // Secciones del panel. "Vencen" e "Inactivos" van separadas y no como un filtro más
  // de la lista de talleres: son las dos listas de LLAMADAS, no de consulta. Metidas
  // dentro de un filtro habría que acordarse de ir a buscarlas, y nadie se acuerda.
  // Arranca en "Mi espacio" y no en el resumen: los dos administran todo el SaaS, así
  // que los datos son los mismos para ambos — lo primero que cada uno tiene que ver al
  // entrar es lo SUYO, no el total compartido.
  vista: 'espacio' | 'resumen' | 'talleres' | 'vencen' | 'inactivos' | 'contactos' | 'cuentas' = 'espacio';
  espacio: MiEspacio | null = null;
  contactos: ContactoDemo[] = [];
  vencimientos: Vencimiento[] = [];
  inactivos: TallerInactivo[] = [];
  cuentas: CuentaPlataforma[] = [];
  readonly ESTADOS_CONTACTO = ['nuevo', 'contactado', 'cerrado', 'descartado'];

  // Ficha del taller abierto (null = cerrada).
  ficha: FichaTaller | null = null;
  cargandoFicha = false;

  filtroEstado = '';
  busqueda = '';
  private escribiendo$ = new Subject<string>();

  // El menú es un panel fijo en escritorio y un cajón que se desliza en teléfono —
  // en ese ancho no hay lugar para dejarlo siempre abierto sin tapar el contenido.
  menuAbierto = false;

  // Espejo de PLANES en backend/src/utils/limites.js, que es la única fuente de
  // verdad. Si acá aparece uno que allá no existe, el backend responde 400; y si
  // falta uno, desde el panel no se puede mover un taller a ese plan — que es lo que
  // pasaba con "gratis", justo el plan al que caen solos al vencer la prueba.
  readonly PLANES = ['trial', 'gratis', 'pro'];

  constructor(
    private motiq: MotiqService,
    private marca: MarcaService,
    private alerta: AlertController,
    private toast: ToastService,
    private router: Router,
  ) {}

  get admin() { return this.motiq.admin; }

  get iniciales(): string {
    const p = (this.admin?.nombre || '').trim().split(/\s+/);
    return ((p[0]?.[0] || '') + (p[1]?.[0] || '')).toUpperCase() || 'M';
  }

  // Cambia de sección y cierra el cajón en teléfono; en escritorio no hace nada
  // porque ahí el menú no se cierra solo.
  irA(v: typeof this.vista) {
    this.vista = v;
    this.menuAbierto = false;
  }

  alternarMenu() { this.menuAbierto = !this.menuAbierto; }

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
    this.motiq.vencimientos(14).subscribe({ next: (r) => (this.vencimientos = r.data), error: () => {} });
    this.motiq.inactivos(30).subscribe({ next: (r) => (this.inactivos = r.data), error: () => {} });
    this.motiq.cuentas().subscribe({ next: (r) => (this.cuentas = r.data), error: () => {} });
    this.cargarEspacio();
  }

  cargarEspacio() {
    this.motiq.espacio().subscribe({
      next: (r) => (this.espacio = r.data),
      error: () => this.toast.error('No se pudo cargar tu espacio'),
    });
  }

  // --- Mis pendientes ---

  get pendientesAbiertos(): Pendiente[] {
    return (this.espacio?.tareas || []).filter(t => !t.hecha);
  }
  get pendientesHechos(): Pendiente[] {
    return (this.espacio?.tareas || []).filter(t => t.hecha);
  }

  async anotar() {
    const a = await this.alerta.create({
      header: 'Anotar un pendiente',
      inputs: [
        { name: 'texto', type: 'text', placeholder: '¿Qué hay que hacer?', attributes: { maxlength: 300 } },
        { name: 'vence_el', type: 'date', label: 'Para cuándo (opcional)' },
      ],
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Anotar',
          handler: (d) => {
            const texto = String(d.texto || '').trim();
            if (!texto) { this.toast.error('Escribí qué hay que hacer'); return false; }
            this.motiq.anotarPendiente(texto, null, String(d.vence_el || '').slice(0, 10) || null).subscribe({
              next: () => this.cargarEspacio(),
              error: (e) => this.toast.error(e?.error?.error || 'No se pudo anotar'),
            });
            return true;
          },
        },
      ],
    });
    await a.present();
  }

  tachar(t: Pendiente) {
    this.motiq.marcarPendiente(t.id, !t.hecha).subscribe({
      next: () => this.cargarEspacio(),
      error: () => this.toast.error('No se pudo actualizar'),
    });
  }

  borrarPendiente(t: Pendiente) {
    this.motiq.borrarPendiente(t.id).subscribe({
      next: () => this.cargarEspacio(),
      error: () => this.toast.error('No se pudo borrar'),
    });
  }

  // --- Talleres que sigo ---

  sigo(id: number): boolean {
    return (this.espacio?.seguidos || []).some(s => s.id === id);
  }

  alternarSeguido(t: { id: number; nombre: string }) {
    const accion = this.sigo(t.id) ? this.motiq.dejarDeSeguir(t.id) : this.motiq.seguir(t.id);
    accion.subscribe({
      next: (r) => { this.toast.success(r.message); this.cargarEspacio(); },
      error: () => this.toast.error('No se pudo cambiar'),
    });
  }

  // Lo que dice cada línea de la bitácora, en castellano. Se arma acá y no se guarda
  // ya escrito en la base: así se puede corregir la redacción sin reescribir el
  // historial, que es justo lo que un registro de auditoría no debe permitir.
  rotuloAccion(l: { accion: string; tenant_slug: string | null; detalle: string | null }): string {
    const donde = l.tenant_slug ? ` a ${l.tenant_slug}` : '';
    const textos: Record<string, string> = {
      suspendio: `suspendió${donde}`,
      reactivo: `reactivó${donde}`,
      cambio_plan: `cambió el plan${donde}`,
      borro: `borró${donde}`,
      creo_cuenta: 'creó una cuenta de plataforma',
      atendio_contacto: 'atendió un contacto',
    };
    const base = textos[l.accion] || l.accion;
    return l.detalle ? `${base} — ${l.detalle}` : base;
  }

  iconoAccion(accion: string): string {
    return {
      suspendio: 'pause-circle-outline', reactivo: 'play-circle-outline',
      cambio_plan: 'swap-horizontal-outline', borro: 'trash-outline',
      creo_cuenta: 'person-add-outline', atendio_contacto: 'mail-open-outline',
    }[accion] || 'ellipse-outline';
  }

  // Altura de cada barra del gráfico de altas, en porcentaje del mes más alto. Se
  // calcula acá y no en la plantilla para no recorrer el arreglo en cada pintado.
  get altasConAltura(): { mes: string; talleres: number; alto: number }[] {
    const altas = this.resumen?.altas || [];
    const techo = Math.max(1, ...altas.map(a => a.talleres));
    return altas.map(a => ({ ...a, alto: Math.round((a.talleres / techo) * 100) }));
  }

  mesCorto(mes: string): string {
    const M = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'set', 'oct', 'nov', 'dic'];
    return M[Number(String(mes).slice(5, 7)) - 1] || mes;
  }

  // --- Ficha del taller ---

  abrirFicha(id: number) {
    this.cargandoFicha = true;
    this.ficha = null;
    this.motiq.ficha(id).subscribe({
      next: (r) => { this.ficha = r.data; this.cargandoFicha = false; },
      error: () => { this.cargandoFicha = false; this.toast.error('No se pudo abrir la ficha'); },
    });
  }

  cerrarFicha() { this.ficha = null; }

  // --- Cuentas de la plataforma ---

  async invitarCuenta() {
    const a = await this.alerta.create({
      header: 'Sumar a alguien al equipo',
      message: 'Va a ver TODOS los talleres y podrá suspenderlos. No hay permisos parciales.',
      inputs: [
        { name: 'nombre', type: 'text', placeholder: 'Nombre' },
        { name: 'email', type: 'email', placeholder: 'correo@motiq.cr' },
      ],
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Crear',
          handler: (d) => {
            const nombre = String(d.nombre || '').trim();
            const email = String(d.email || '').trim();
            if (!nombre || !email) { this.toast.error('Falta el nombre o el correo'); return false; }
            this.motiq.crearCuenta(nombre, email).subscribe({
              next: (r) => { this.mostrarPassword(r.data.email, r.data.password); this.cargar(); },
              error: (e) => this.toast.error(e?.error?.error || 'No se pudo crear la cuenta'),
            });
            return true;
          },
        },
      ],
    });
    await a.present();
  }

  // La contraseña se muestra en un diálogo que hay que cerrar a mano, no en un toast
  // que se va solo: es la única vez que se ve, y perderla obliga a generar otra.
  private async mostrarPassword(email: string, password: string) {
    const a = await this.alerta.create({
      header: 'Cuenta creada',
      subHeader: email,
      message: `Contraseña: ${password}\n\nCopiala ahora y pasásela por un canal privado. No se vuelve a mostrar.`,
      buttons: ['Ya la copié'],
      cssClass: 'alerta-password',
    });
    await a.present();
  }

  async cambiarActivo(c: CuentaPlataforma) {
    const prender = !c.activo;
    const a = await this.alerta.create({
      header: prender ? `Activar a ${c.nombre}` : `Desactivar a ${c.nombre}`,
      message: prender
        ? 'Vuelve a poder entrar al panel con su contraseña de siempre.'
        : 'Deja de poder entrar. Su cuenta no se borra, así que queda el registro de quién hizo qué.',
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: prender ? 'Activar' : 'Desactivar',
          role: prender ? undefined : 'destructive',
          handler: () => {
            this.motiq.activarCuenta(c.id, prender).subscribe({
              next: (r) => { this.toast.success(r.message); this.cargar(); },
              error: (e) => this.toast.error(e?.error?.error || 'No se pudo cambiar'),
            });
            return true;
          },
        },
      ],
    });
    await a.present();
  }

  async cambiarMiPassword() {
    const a = await this.alerta.create({
      header: 'Cambiar mi contraseña',
      inputs: [
        { name: 'actual', type: 'password', placeholder: 'Contraseña actual' },
        { name: 'nueva', type: 'password', placeholder: 'Nueva (mínimo 12 caracteres)' },
      ],
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Cambiar',
          handler: (d) => {
            if (String(d.nueva || '').length < 12) {
              this.toast.error('La nueva necesita al menos 12 caracteres');
              return false;
            }
            this.motiq.cambiarPassword(String(d.actual || ''), String(d.nueva)).subscribe({
              next: (r) => this.toast.success(r.message),
              error: (e) => this.toast.error(e?.error?.error || 'No se pudo cambiar'),
            });
            return true;
          },
        },
      ],
    });
    await a.present();
  }

  // --- Borrar un taller ---
  //
  // Pide escribir su identificador. No es burocracia: en una lista donde todas las
  // filas se ven igual, es la única defensa contra tocar el botón en la equivocada.
  async borrarTaller(t: { id: number; nombre: string; slug: string }) {
    const a = await this.alerta.create({
      header: `Borrar ${t.nombre}`,
      message: `Se borra el taller y TODO lo suyo: sus clientes, sus vehículos y su historial de órdenes. No se puede deshacer.\n\nEscribí "${t.slug}" para confirmar.`,
      inputs: [{ name: 'confirmacion', type: 'text', placeholder: t.slug }],
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Borrar para siempre',
          role: 'destructive',
          handler: (d) => {
            const escrito = String(d.confirmacion || '').trim();
            if (escrito !== t.slug) {
              this.toast.error('El identificador no coincide');
              return false;   // deja el diálogo abierto en vez de perder lo escrito
            }
            this.motiq.borrarTaller(t.id, escrito).subscribe({
              next: (r) => { this.toast.success(r.message); this.cerrarFicha(); this.cargar(); },
              error: (e) => this.toast.error(e?.error?.error || 'No se pudo borrar'),
            });
            return true;
          },
        },
      ],
    });
    await a.present();
  }

  // Cuántos días le quedan, en palabras. "vence en 3 días" se entiende de un vistazo;
  // una fecha obliga a calcular.
  cuantoFalta(dias: number | null): string {
    if (dias == null) return '';
    if (dias < 0) return `venció hace ${Math.abs(dias)} d`;
    if (dias === 0) return 'vence hoy';
    if (dias === 1) return 'vence mañana';
    return `vence en ${dias} d`;
  }

  colorUrgencia(dias: number | null): string {
    if (dias == null) return 'medium';
    if (dias <= 0) return 'danger';
    if (dias <= 3) return 'warning';
    return 'medium';
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
    return { trial: 'Prueba', gratis: 'Gratis', pro: 'Pro' }[p] || p;
  }

  colorEstado(e: string): string {
    return { activo: 'success', suspendido: 'danger', cancelado: 'medium' }[e] || 'medium';
  }

  salir() {
    this.motiq.logout();
    this.router.navigate(['/motiq/login'], { replaceUrl: true });
  }
}
