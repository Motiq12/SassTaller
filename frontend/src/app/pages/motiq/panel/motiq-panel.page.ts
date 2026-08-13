import { Component, ElementRef, HostListener, OnInit, ViewChild } from '@angular/core';
import { Router } from '@angular/router';
import { AlertController } from '@ionic/angular';
import { Subject, debounceTime, distinctUntilChanged } from 'rxjs';
import {
  ContactoDemo, CuentaPlataforma, FichaTaller, MiEspacio, MotiqService, Pendiente,
  PlanConfig, ResumenPlataforma, TallerDelPanel, TallerInactivo, Vencimiento,
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
  vista: 'espacio' | 'resumen' | 'talleres' | 'vencen' | 'inactivos' | 'contactos' | 'cuentas' | 'planes' = 'espacio';
  espacio: MiEspacio | null = null;
  contactos: ContactoDemo[] = [];
  vencimientos: Vencimiento[] = [];
  inactivos: TallerInactivo[] = [];
  cuentas: CuentaPlataforma[] = [];
  readonly ESTADOS_CONTACTO = ['nuevo', 'contactado', 'cerrado', 'descartado'];

  // --- Planes: precio y límites, editables desde acá ---
  planes: PlanConfig[] = [];
  editandoPlan: string | null = null;
  formPlan: {
    precio_mensual: number | null; limite_usuarios: number | null; limite_sucursales: number | null;
    marca_propia: boolean; reportes_dias: number | null;
  } = { precio_mensual: 0, limite_usuarios: null, limite_sucursales: null, marca_propia: false, reportes_dias: null };

  // Ficha del taller abierto (null = cerrada).
  ficha: FichaTaller | null = null;
  cargandoFicha = false;

  filtroEstado = '';
  filtroPlan = '';
  orden: 'recientes' | 'antiguos' | 'nombre' | 'plan' = 'recientes';
  busqueda = '';
  private escribiendo$ = new Subject<string>();

  // El menú es un panel fijo en escritorio y un cajón que se desliza en teléfono —
  // en ese ancho no hay lugar para dejarlo siempre abierto sin tapar el contenido.
  menuAbierto = false;

  // Buscador global (Ctrl+K): saltar a un taller por nombre sin importar en qué
  // sección se esté parado, sin pasar por la lista de "Talleres" y sus filtros.
  buscadorGlobalAbierto = false;
  buscandoGlobal = false;
  resultadosGlobales: TallerDelPanel[] = [];
  private buscarGlobal$ = new Subject<string>();
  @ViewChild('inputBuscadorGlobal') inputBuscadorGlobal?: ElementRef<HTMLInputElement>;

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

  // Ctrl+K (o Cmd+K en Mac) abre el buscador desde cualquier sección; Esc lo cierra.
  // Sin esto, saltar a un taller puntual obliga a ir a "Talleres" y filtrar a mano
  // cada vez, aunque se sepa exactamente cuál se busca.
  @HostListener('document:keydown', ['$event'])
  atajoTeclado(ev: KeyboardEvent) {
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'k') {
      ev.preventDefault();
      this.abrirBuscadorGlobal();
    } else if (ev.key === 'Escape' && this.buscadorGlobalAbierto) {
      this.cerrarBuscadorGlobal();
    }
  }

  ngOnInit() {
    this.marca.limpiar();   // este panel es de Motiq, no de ningún taller
    // Buscar en cada tecla dispararía una consulta por letra; se espera a que pare.
    this.escribiendo$.pipe(debounceTime(300), distinctUntilChanged())
      .subscribe(() => this.cargarTalleres());
    this.buscarGlobal$.pipe(debounceTime(250), distinctUntilChanged()).subscribe((valor) => {
      const q = valor.trim();
      if (!q) { this.resultadosGlobales = []; this.buscandoGlobal = false; return; }
      this.buscandoGlobal = true;
      this.motiq.talleres({ q }).subscribe({
        next: (r) => { this.resultadosGlobales = r.data.slice(0, 8); this.buscandoGlobal = false; },
        error: () => { this.buscandoGlobal = false; },
      });
    });
    this.cargar();
  }

  abrirBuscadorGlobal() {
    this.buscadorGlobalAbierto = true;
    this.resultadosGlobales = [];
    this.menuAbierto = false;
    // El overlay todavía no está en el DOM en este mismo ciclo; sin el setTimeout
    // el focus() llega antes de que exista el input y no hace nada.
    setTimeout(() => this.inputBuscadorGlobal?.nativeElement.focus(), 30);
  }

  cerrarBuscadorGlobal() {
    this.buscadorGlobalAbierto = false;
  }

  alBuscarGlobal(valor: string) {
    this.buscarGlobal$.next(valor);
  }

  irAResultado(t: TallerDelPanel) {
    this.cerrarBuscadorGlobal();
    this.abrirFicha(t.id);
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
    this.motiq.planes().subscribe({ next: (r) => (this.planes = r.data), error: () => {} });
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
      edito_cuenta: 'editó una cuenta de plataforma',
      edito_plan: 'editó un plan',
      atendio_contacto: 'atendió un contacto',
    };
    const base = textos[l.accion] || l.accion;
    return l.detalle ? `${base} — ${l.detalle}` : base;
  }

  iconoAccion(accion: string): string {
    return {
      suspendio: 'pause-circle-outline', reactivo: 'play-circle-outline',
      cambio_plan: 'swap-horizontal-outline', borro: 'trash-outline',
      creo_cuenta: 'person-add-outline', edito_cuenta: 'person-outline',
      edito_plan: 'pricetag-outline', atendio_contacto: 'mail-open-outline',
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

  // --- MRR estimado y conversión ---

  // El precio real del plan Pro (editable en "Planes"), no un valor guardado a mano
  // por cada quien: los dos ven el mismo MRR porque parten del mismo precio.
  get mrrEstimado(): number {
    const pro = this.planes.find((p) => p.plan === 'pro');
    return (pro?.precio_mensual || 0) * Number(this.resumen?.talleres.en_pro || 0);
  }

  // De los que ya terminaron la prueba y eligieron un plan (Pro o Gratis), cuántos
  // se quedaron pagando. Los que todavía están en prueba no cuentan para este número:
  // meterlos abajaría la tasa sin que hayan decidido nada todavía.
  //
  // MySQL entrega los SUM() del resumen como string y no como number: sumarlos con
  // "+" sin convertir concatena texto ("1" + "0" = "10") en vez de sumar. De ahí el
  // Number() explícito en los dos.
  get tasaConversion(): number | null {
    const pro = Number(this.resumen?.talleres.en_pro || 0);
    const base = pro + Number(this.resumen?.talleres.en_gratis || 0);
    return base ? Math.round((pro / base) * 100) : null;
  }

  formatoColones(monto: number): string {
    return new Intl.NumberFormat('es-CR', { style: 'currency', currency: 'CRC', maximumFractionDigits: 0 }).format(monto);
  }

  // --- Planes ---

  rotuloLimite(valor: number | null, singular: string, plural: string): string {
    if (valor == null) return `${plural} ilimitados`;
    return valor === 1 ? `1 ${singular}` : `${valor} ${plural}`;
  }

  editarPlan(p: PlanConfig) {
    this.editandoPlan = p.plan;
    this.formPlan = {
      precio_mensual: p.precio_mensual,
      limite_usuarios: p.limite_usuarios,
      limite_sucursales: p.limite_sucursales,
      marca_propia: !!p.marca_propia,
      reportes_dias: p.reportes_dias,
    };
  }

  cancelarEdicionPlan() {
    this.editandoPlan = null;
  }

  guardarPlan(plan: string) {
    // Vacío = sin límite. El input de Ionic entrega '' y no null cuando se borra a
    // mano, así que hay que tratar los dos casos igual.
    const vacioEsNull = (v: number | null): number | null => (v === null || (v as any) === '' ? null : Number(v));
    const datos = {
      precio_mensual: Number(this.formPlan.precio_mensual) || 0,
      limite_usuarios: vacioEsNull(this.formPlan.limite_usuarios),
      limite_sucursales: vacioEsNull(this.formPlan.limite_sucursales),
      marca_propia: !!this.formPlan.marca_propia,
      reportes_dias: vacioEsNull(this.formPlan.reportes_dias),
    };
    this.motiq.actualizarPlan(plan, datos).subscribe({
      next: (r) => { this.toast.success(r.message); this.editandoPlan = null; this.cargar(); },
      error: (e) => this.toast.error(e?.error?.error || 'No se pudo guardar'),
    });
  }

  // --- Perfiles: el propio y el de un compañero, sin distinción ---

  async editarPerfil(c: CuentaPlataforma) {
    const esMio = c.id === this.admin?.id;
    const a = await this.alerta.create({
      header: esMio ? 'Editar mi perfil' : `Editar a ${c.nombre}`,
      inputs: [
        { name: 'nombre', type: 'text', value: c.nombre, placeholder: 'Nombre' },
        { name: 'email', type: 'email', value: c.email, placeholder: 'correo@motiq.cr' },
      ],
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Guardar',
          handler: (d) => {
            const nombre = String(d.nombre || '').trim();
            const email = String(d.email || '').trim();
            if (!nombre || !email) { this.toast.error('Falta el nombre o el correo'); return false; }
            this.motiq.editarCuenta(c.id, nombre, email).subscribe({
              next: (r) => {
                this.toast.success(r.message);
                // Si me edité a mí mismo, la copia local del admin (saludo, pie de la
                // barra lateral) queda vieja hasta el próximo login si no se actualiza acá.
                if (esMio) this.motiq.actualizarAdminLocal({ nombre, email });
                this.cargar();
              },
              error: (e) => this.toast.error(e?.error?.error || 'No se pudo actualizar'),
            });
            return true;
          },
        },
      ],
    });
    await a.present();
  }

  // --- Salud del taller ---
  //
  // Un solo vistazo en vez de tener que cruzar "Vencen" e "Inactivos" mentalmente:
  // combina si tiene actividad reciente con si le queda poco de prueba. Solo se
  // muestra para talleres activos — uno suspendido o cancelado ya lo dice su propia
  // insignia de estado, y mostrar las dos juntas sería ruido repetido.
  salud(t: TallerDelPanel): { texto: string; color: string } {
    if (!t.ordenes) return { texto: 'sin arrancar', color: 'danger' };
    const dias = t.ultima_orden ? Math.floor((Date.now() - new Date(t.ultima_orden).getTime()) / 86400000) : null;
    if (dias == null || dias > 60) return { texto: 'en riesgo', color: 'danger' };
    if (dias > 30) return { texto: 'atención', color: 'warning' };
    if (t.plan === 'trial' && t.trial_hasta) {
      const restan = Math.floor((new Date(t.trial_hasta).getTime() - Date.now()) / 86400000);
      if (restan <= 3) return { texto: 'prueba por vencer', color: 'warning' };
    }
    return { texto: 'saludable', color: 'success' };
  }

  // --- Exportar a CSV ---
  //
  // Para armar campañas de llamadas fuera del panel. Con BOM al inicio: sin él, Excel
  // en Windows interpreta el archivo como Latin-1 y las tildes salen rotas.
  private descargarCSV(filas: Record<string, any>[], nombreArchivo: string) {
    if (!filas.length) { this.toast.error('No hay nada para exportar'); return; }
    const columnas = Object.keys(filas[0]);
    const escapar = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = [columnas.join(','), ...filas.map((f) => columnas.map((c) => escapar(f[c])).join(','))].join('\r\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = nombreArchivo;
    a.click();
    URL.revokeObjectURL(url);
  }

  private hoyISO(): string { return new Date().toISOString().slice(0, 10); }

  exportarVencimientos() {
    this.descargarCSV(
      this.vencimientos.map((v) => ({
        taller: v.nombre, identificador: v.slug, vence: v.trial_hasta, dias_restantes: v.dias_restantes,
        admin: v.admin_nombre || '', email: v.admin_email || '', telefono: v.admin_telefono || '', ordenes: v.ordenes,
      })),
      `motiq-vencen-${this.hoyISO()}.csv`,
    );
  }

  exportarInactivos() {
    this.descargarCSV(
      this.inactivos.map((i) => ({
        taller: i.nombre, identificador: i.slug, plan: i.plan, registrado: i.created_at,
        ultima_orden: i.ultima_orden || 'nunca', ordenes: i.ordenes, email: i.admin_email || '',
      })),
      `motiq-inactivos-${this.hoyISO()}.csv`,
    );
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

  // El servidor siempre entrega ORDER BY created_at DESC (más nuevo primero), así que
  // "recientes" no necesita tocar nada y "antiguos" alcanza con invertir el arreglo:
  // evita otro viaje al servidor solo para cambiar el orden de lo que ya se tiene.
  get talleresOrdenados(): TallerDelPanel[] {
    const copia = [...this.talleres];
    switch (this.orden) {
      case 'antiguos': return copia.reverse();
      case 'nombre': return copia.sort((a, b) => a.nombre.localeCompare(b.nombre));
      case 'plan': return copia.sort((a, b) => a.plan.localeCompare(b.plan));
      default: return copia;
    }
  }

  cargarTalleres(ev?: any) {
    this.cargando = true;
    this.motiq.talleres({ estado: this.filtroEstado, plan: this.filtroPlan, q: this.busqueda.trim() }).subscribe({
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
