import { Component, OnInit, OnDestroy } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Location } from '@angular/common';
import { AlertController, ModalController, ToastController } from '@ionic/angular';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { PortalService } from '../../services/portal.service';
import { AccesibilidadService } from '../../services/accesibilidad.service';
import { BiometriaService } from '../../services/biometria.service';
import { GrupoPerfil } from '../../shared/perfil/perfil-lista.base';
import { recortarFoto } from '../../shared/perfil/recortar-foto.component';

@Component({
  standalone: false,
  selector: 'app-portal-perfil',
  templateUrl: './portal-perfil.page.html',
  styleUrls: ['./portal-perfil.page.scss'],
})
export class PortalPerfilPage implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  perfil: any = null;
  cuenta = { nombre: '', apellido: '', telefono: '', email: '' };
  cargando = true;
  guardando = false;
  eliminando = false;
  subiendoFoto = false;

  // Visor (lightbox) de la foto de perfil con zoom.
  zoomAbierto = false;
  zoomActivo = false;

  // Biometría (solo app nativa): disponibilidad del dispositivo y estado del ingreso rápido.
  bioDisponible = false;
  bioActivado = false;
  bioProcesando = false;

  // Preferencias de notificación del cliente.
  notif = { avances: true, recordatorios: true };
  guardandoNotif = false;

  // Cambio de correo en dos pasos: mientras `perfil.email_pendiente` tenga algo,
  // la cuenta sigue funcionando con el correo viejo y falta confirmar el nuevo.
  codigoCorreo = '';
  confirmandoCorreo = false;
  reenviandoCorreo = false;
  cooldown = 0;
  private timer: any = null;

  constructor(
    public portal: PortalService,
    public a11y: AccesibilidadService,
    private bio: BiometriaService,
    private router: Router,
    private route: ActivatedRoute,
    private location: Location,
    private modal: ModalController,
    private toast: ToastController,
    private alert: AlertController,
  ) {}

  // ── La lista, como Mi perfil del panel (shared/perfil) ──
  // Qué sección está abierta va en la dirección (?ver=<id>). Desde 1200 px se ven la
  // lista y la sección lado a lado; más angosto, una cosa a la vez.
  seccion: string | null = null;
  escritorio = false;
  private mq?: MediaQueryList;
  private alCambiarAncho = (e: MediaQueryListEvent) => { this.escritorio = e.matches; };
  private desdeLista = false;

  get grupos(): GrupoPerfil[] {
    return [
      { titulo: 'Tu cuenta', items: [
        { id: 'datos', nombre: 'Datos personales', icono: 'person-outline' },
        { id: 'foto', nombre: 'Foto de perfil', icono: 'image-outline' },
        { id: 'contrasena', nombre: 'Contraseña', icono: 'lock-closed-outline' },
        ...(this.bioDisponible ? [{ id: 'bio', nombre: 'Huella o Face ID', icono: 'finger-print-outline' }] : []),
      ] },
      { titulo: 'Preferencias', items: [
        { id: 'avisos', nombre: 'Avisos', icono: 'notifications-outline' },
        { id: 'apariencia', nombre: 'Apariencia', icono: 'color-palette-outline' },
      ] },
      { titulo: 'Más', items: [
        { id: 'legal', nombre: 'Términos y privacidad', icono: 'document-text-outline' },
        { id: 'cuenta', nombre: 'Eliminar cuenta', icono: 'trash-outline' },
      ] },
    ];
  }

  private get ids(): string[] { return this.grupos.reduce((ids: string[], g) => ids.concat(g.items.map(i => i.id)), []); }

  // En escritorio, sin ninguna elegida se muestra la primera.
  get vista(): string | null { return this.seccion || (this.escritorio ? 'datos' : null); }

  abrir(id: string) {
    this.desdeLista = true;
    this.router.navigate([], { relativeTo: this.route, queryParams: { ver: id } });
  }

  // En el celular, volver a la lista. Si se llegó desde ella, es "atrás" de verdad.
  volverALista() {
    if (this.desdeLista) { this.desdeLista = false; this.location.back(); return; }
    this.router.navigate([], { relativeTo: this.route, queryParams: {}, replaceUrl: true });
  }

  // Lo que se ve a la derecha de cada fila.
  get valores(): Record<string, string> {
    const p = this.perfil || {};
    const avisos = (this.notif.avances ? 1 : 0) + (this.notif.recordatorios ? 1 : 0);
    return {
      datos: p.email_pendiente ? 'Confirma tu correo' : (p.telefono || ''),
      foto: p.foto ? 'Puesta' : 'Sin foto',
      contrasena: p.tiene_password ? 'Puesta' : p.con_google ? 'Entras con Google' : 'Sin contraseña',
      bio: this.bioActivado ? 'Activado' : 'Desactivado',
      avisos: avisos === 2 ? 'Todos' : avisos === 1 ? '1 de 2' : 'Apagados',
      apariencia: this.a11y.temas.find(t => t.id === this.a11y.tema)?.nombre || '',
    };
  }

  get estados(): Record<string, string> {
    return { datos: this.perfil?.email_pendiente ? 'aviso' : '', bio: this.bioActivado ? 'ok' : '' };
  }

  get chips(): string[] { return ['Cliente', ...(this.perfil?.con_google ? ['Con Google'] : [])]; }
  get nombreCompleto(): string { return `${this.perfil?.nombre || ''} ${this.perfil?.apellido || ''}`.trim(); }

  // ¿Cambió algo de los datos? Sin cambios, el botón queda apagado.
  get cuentaCambiada(): boolean {
    const p = this.perfil || {};
    return this.cuenta.nombre.trim() !== (p.nombre || '') || this.cuenta.apellido.trim() !== (p.apellido || '')
      || this.cuenta.telefono.trim() !== (p.telefono || '') || this.cuenta.email.trim().toLowerCase() !== String(p.email || '').toLowerCase();
  }

  iconoTema(id: string): string { return id === 'claro' ? 'sunny-outline' : id === 'oscuro' ? 'moon-outline' : 'contrast-outline'; }

  // ── Contraseña ──
  pass = { actual: '', nueva: '' };
  verActual = false;
  verNueva = false;
  guardandoPass = false;

  // Solo orienta; la que manda es la regla del servidor (mínimo 8).
  get fuerza(): { nivel: number; texto: string } {
    const p = this.pass.nueva || '';
    if (p.length < 8) return { nivel: 1, texto: `Le faltan ${8 - p.length} caracteres` };
    const variedad = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter(r => r.test(p)).length;
    if (p.length >= 14 || (p.length >= 10 && variedad >= 3)) return { nivel: 3, texto: 'Fuerte' };
    return { nivel: 2, texto: 'Aceptable: más larga es más segura' };
  }

  cambiarPassword() {
    if (this.guardandoPass || !this.pass.actual || this.pass.nueva.length < 8) return;
    this.guardandoPass = true;
    this.portal.updateMiPassword({ actual: this.pass.actual, nueva: this.pass.nueva }).pipe(takeUntil(this.destroy$)).subscribe({
      next: () => {
        this.guardandoPass = false;
        this.pass = { actual: '', nueva: '' };
        this.aviso('Contraseña cambiada');
      },
      // El motivo (contraseña actual incorrecta, etc.) lo muestra el interceptor y marca el campo.
      error: () => { this.guardandoPass = false; },
    });
  }

  pedirFoto(input: HTMLInputElement) { if (!this.subiendoFoto) input.click(); }

  // Niveles de tamaño de texto (accesibilidad).
  readonly nivelesTexto = [
    { i: 0, etiqueta: 'A', nombre: 'Normal' },
    { i: 1, etiqueta: 'A', nombre: 'Grande' },
    { i: 2, etiqueta: 'A', nombre: 'Muy grande' },
  ];
  setTexto(i: number) { this.a11y.setNivel(i); }

  // —— Biometría: activar / desactivar el ingreso con huella o Face ID ——
  // Para activar necesitamos la contraseña (no se guarda en la sesión): la pedimos
  // y la verificamos contra el backend antes de cifrarla en el dispositivo.
  async activarBiometria() {
    const email = (this.cuenta.email || '').trim();
    if (!email) { this.aviso('Tu cuenta no tiene un correo configurado', 'warning'); return; }
    const al = await this.alert.create({
      cssClass: 'portal-alert',
      header: 'Activar huella / Face ID',
      message: 'Confirma tu contraseña para guardar el acceso rápido de forma segura en este dispositivo.',
      inputs: [{ name: 'password', type: 'password', placeholder: 'Tu contraseña', cssClass: 'alert-input' }],
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        { text: 'Activar', cssClass: 'portal-alert-confirm', handler: (d) => { this.confirmarActivarBio(email, d?.password); } },
      ],
    });
    await al.present();
  }

  private confirmarActivarBio(email: string, password: string) {
    if (!password) { this.aviso('Ingresa tu contraseña', 'warning'); return; }
    if (this.bioProcesando) return;
    this.bioProcesando = true;
    // 1) Verificar credenciales con el backend (no guardamos una contraseña inválida).
    this.portal.login(email, password).pipe(takeUntil(this.destroy$)).subscribe({
      next: async () => {
        try {
          // 2) Confirmar identidad biométrica y cifrar las credenciales en el dispositivo.
          await this.bio.activar(email, password);
          this.bioActivado = true;
          this.aviso('Ingreso con huella / Face ID activado');
        } catch {
          this.aviso('No se pudo activar la biometría', 'danger');
        } finally {
          this.bioProcesando = false;
        }
      },
      error: () => { this.bioProcesando = false; this.aviso('Contraseña incorrecta', 'danger'); },
    });
  }

  async desactivarBiometria() {
    const al = await this.alert.create({
      cssClass: 'portal-alert',
      header: 'Desactivar ingreso rápido',
      message: 'Se borrará el acceso guardado en este dispositivo. Tendrás que ingresar con tu correo y contraseña.',
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        { text: 'Desactivar', role: 'destructive', cssClass: 'portal-alert-danger', handler: () => this.confirmarDesactivarBio() },
      ],
    });
    await al.present();
  }

  private async confirmarDesactivarBio() {
    if (this.bioProcesando) return;
    this.bioProcesando = true;
    await this.bio.desactivar();
    this.bioActivado = false;
    this.bioProcesando = false;
    this.aviso('Ingreso rápido desactivado');
  }

  // —— Preferencias de notificación ——
  // El ngModel ya cambió el valor; persistimos y revertimos si el guardado falla.
  // `revirtiendo` evita re-disparar el guardado cuando el revert vuelve a emitir ionChange.
  private revirtiendo = false;
  guardarNotif(clave: 'avances' | 'recordatorios') {
    if (this.revirtiendo) { this.revirtiendo = false; return; }
    this.guardandoNotif = true;
    this.portal.updatePreferenciasNotif({
      notif_avances: this.notif.avances,
      notif_recordatorios: this.notif.recordatorios,
    }).pipe(takeUntil(this.destroy$)).subscribe({
      next: () => { this.guardandoNotif = false; },
      error: () => {
        this.guardandoNotif = false;
        this.revirtiendo = true;
        this.notif[clave] = !this.notif[clave]; // revertir el toggle
        this.aviso('No se pudo guardar la preferencia', 'danger');
      },
    });
  }

  ngOnInit() {
    this.mq = window.matchMedia('(min-width: 1200px)');
    this.escritorio = this.mq.matches;
    this.mq.addEventListener('change', this.alCambiarAncho);
    this.route.queryParamMap.pipe(takeUntil(this.destroy$)).subscribe(q => {
      const v = q.get('ver');
      this.seccion = v && this.ids.includes(v) ? v : null;
    });
    this.cargar();
    this.cargarBio();
  }
  ionViewWillEnter() { this.cargar(); this.cargarBio(); }

  // Estado de la biometría (en web siempre queda oculto: disponible() devuelve false).
  async cargarBio() {
    this.bioDisponible = await this.bio.disponible();
    this.bioActivado = this.bioDisponible ? await this.bio.activado() : false;
  }

  cargar() {
    this.cargando = true;
    this.portal.getMiPerfil().pipe(takeUntil(this.destroy$)).subscribe({
      next: r => {
        this.perfil = r.data;
        this.cuenta = {
          nombre: r.data.nombre || '',
          apellido: r.data.apellido || '',
          telefono: r.data.telefono || '',
          email: r.data.email || '',
        };
        this.notif = {
          avances: r.data.notif_avances !== 0,
          recordatorios: r.data.notif_recordatorios !== 0,
        };
        this.cargando = false;
      },
      error: () => { this.cargando = false; this.aviso('No se pudo cargar el perfil', 'danger'); },
    });
  }

  get iniciales(): string {
    const n = (this.cuenta.nombre || '').trim()[0] || '';
    const a = (this.cuenta.apellido || '').trim()[0] || '';
    return (n + a).toUpperCase() || 'U';
  }

  // ¿Está tocando el correo? Es el único dato que necesita contraseña y confirmación.
  private get cambiaCorreo(): boolean {
    return this.cuenta.email.trim().toLowerCase() !== String(this.perfil?.email || '').toLowerCase();
  }

  async guardarCuenta() {
    if (!this.cuenta.nombre.trim() || !this.cuenta.apellido.trim()) { this.aviso('Nombre y apellido son requeridos', 'warning'); return; }
    if (!this.cuenta.telefono.trim()) { this.aviso('El teléfono es requerido: es como te avisamos que tu vehículo está listo', 'warning'); return; }
    if (!this.cuenta.email.trim()) { this.aviso('El correo es requerido', 'warning'); return; }

    // El correo es con lo que se entra y con lo que se recupera la cuenta: cambiarlo
    // exige la contraseña, así que una sesión abierta que quede en manos de otro no
    // alcanza para mudar la cuenta y dejar afuera al dueño.
    if (this.cambiaCorreo && !this.perfil?.tiene_password) {
      this.aviso('Para cambiar el correo primero crea una contraseña (Mi perfil → Contraseña).', 'warning');
      return;
    }
    if (this.cambiaCorreo) {
      const al = await this.alert.create({
        cssClass: 'portal-alert',
        header: 'Cambiar tu correo',
        message: `Te vamos a enviar un código a ${this.cuenta.email.trim()} para confirmar que es tuyo. Hasta entonces sigues entrando con el correo actual.`,
        inputs: [{ name: 'password', type: 'password', placeholder: 'Tu contraseña', cssClass: 'alert-input' }],
        buttons: [
          { text: 'Cancelar', role: 'cancel' },
          { text: 'Continuar', cssClass: 'portal-alert-confirm', handler: (d) => { this.enviarCuenta(d?.password); } },
        ],
      });
      await al.present();
      return;
    }
    this.enviarCuenta();
  }

  private enviarCuenta(password?: string) {
    if (this.cambiaCorreo && !password) { this.aviso('Ingresa tu contraseña', 'warning'); return; }
    this.guardando = true;
    this.portal.updateMiPerfil({
      nombre: this.cuenta.nombre.trim(),
      apellido: this.cuenta.apellido.trim(),
      telefono: this.cuenta.telefono.trim(),
      email: this.cuenta.email.trim(),
      ...(password ? { password } : {}),
    }).pipe(takeUntil(this.destroy$)).subscribe({
      next: r => {
        // Se conserva lo que la respuesta no trae (si tiene contraseña, si entra con Google).
        this.perfil = { ...this.perfil, ...r.data };
        // El correo del formulario vuelve al vigente: el nuevo todavía no manda.
        this.cuenta.email = r.data.email || '';
        // Refleja el nombre en el saludo del inicio.
        this.portal.actualizarClienteLocal({ nombre: r.data.nombre, apellido: r.data.apellido });
        this.guardando = false;
        if (r.cambio_correo_pendiente) {
          this.codigoCorreo = '';
          this.iniciarCooldown();
        }
        this.aviso(r.message || 'Perfil actualizado');
      },
      error: (e) => { this.guardando = false; this.aviso(e.error?.error || 'No se pudo actualizar', 'danger'); },
    });
  }

  // —— Confirmación del correo nuevo ——
  confirmarCorreo() {
    const codigo = this.codigoCorreo.trim();
    if (codigo.length < 6) { this.aviso('Ingresa el código de 6 dígitos', 'warning'); return; }
    this.confirmandoCorreo = true;
    this.portal.confirmarCambioCorreo(codigo).pipe(takeUntil(this.destroy$)).subscribe({
      next: r => {
        this.perfil = { ...this.perfil, ...r.data };
        this.cuenta.email = r.data.email || '';
        this.codigoCorreo = '';
        this.confirmandoCorreo = false;
        this.pararCooldown();
        this.aviso(r.message || 'Correo actualizado');
      },
      error: e => { this.confirmandoCorreo = false; this.aviso(e.error?.error || 'No se pudo confirmar', 'danger'); },
    });
  }

  reenviarCorreo() {
    if (this.cooldown > 0 || this.reenviandoCorreo) return;
    this.reenviandoCorreo = true;
    this.portal.reenviarCambioCorreo().pipe(takeUntil(this.destroy$)).subscribe({
      next: r => { this.reenviandoCorreo = false; this.iniciarCooldown(); this.aviso(r.message || 'Código reenviado'); },
      error: e => { this.reenviandoCorreo = false; this.aviso(e.error?.error || 'No se pudo reenviar', 'danger'); },
    });
  }

  async cancelarCorreo() {
    const al = await this.alert.create({
      cssClass: 'portal-alert',
      header: 'Cancelar el cambio',
      message: `Se descarta ${this.perfil?.email_pendiente}. Tu cuenta sigue con el correo de siempre.`,
      buttons: [
        { text: 'Seguir con el cambio', role: 'cancel' },
        { text: 'Cancelar el cambio', role: 'destructive', cssClass: 'portal-alert-danger', handler: () => this.confirmarCancelarCorreo() },
      ],
    });
    await al.present();
  }

  private confirmarCancelarCorreo() {
    this.portal.cancelarCambioCorreo().pipe(takeUntil(this.destroy$)).subscribe({
      next: () => {
        this.perfil = { ...this.perfil, email_pendiente: null };
        this.cuenta.email = this.perfil.email || '';
        this.codigoCorreo = '';
        this.pararCooldown();
        this.aviso('Cambio de correo cancelado');
      },
      error: e => this.aviso(e.error?.error || 'No se pudo cancelar', 'danger'),
    });
  }

  // El backend limita a 2 pedidos por minuto: el contador evita que el botón
  // dispare un 429 en vez de un código.
  private iniciarCooldown() {
    this.pararCooldown();
    this.cooldown = 45;
    this.timer = setInterval(() => {
      this.cooldown--;
      if (this.cooldown <= 0) this.pararCooldown();
    }, 1000);
  }

  private pararCooldown() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    this.cooldown = 0;
  }

  // —— Visor con zoom de la foto de perfil ——
  // Al tocar el avatar: si hay foto la abre en grande; si no, abre el selector.
  abrirAvatar(fileInput: HTMLInputElement) {
    if (this.perfil?.foto) this.abrirZoom();
    else fileInput.click();
  }
  abrirZoom() { this.zoomAbierto = true; this.zoomActivo = false; }
  cerrarZoom() { this.zoomAbierto = false; this.zoomActivo = false; }
  toggleZoom(ev: Event) { ev.stopPropagation(); this.zoomActivo = !this.zoomActivo; }

  // —— Foto de perfil ——
  async onFoto(ev: Event) {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ''; // permite re-elegir el mismo archivo
    if (!file) return;
    try {
      // Primero se encuadra (y sale ya en 400 px), como en el panel; cancelar no sube nada.
      const dataUrl = await recortarFoto(this.modal, file);
      if (!dataUrl) return;
      this.subiendoFoto = true;
      this.portal.actualizarFotoPerfil(dataUrl).pipe(takeUntil(this.destroy$)).subscribe({
        next: r => {
          this.perfil = { ...this.perfil, foto: r.data.foto };
          this.portal.actualizarClienteLocal({ foto: r.data.foto }); // refresca el avatar del header
          this.subiendoFoto = false;
          this.aviso('Foto actualizada');
        },
        error: e => { this.subiendoFoto = false; this.aviso(e.error?.error || 'No se pudo subir la foto', 'danger'); },
      });
    } catch (e: any) {
      this.subiendoFoto = false;
      this.aviso(e?.message || 'No se pudo procesar la imagen', 'danger');
    }
  }

  quitarFoto() {
    this.subiendoFoto = true;
    this.portal.actualizarFotoPerfil(null).pipe(takeUntil(this.destroy$)).subscribe({
      next: () => {
        this.perfil = { ...this.perfil, foto: null };
        this.portal.actualizarClienteLocal({ foto: null });
        this.subiendoFoto = false;
        this.aviso('Foto eliminada');
      },
      error: e => { this.subiendoFoto = false; this.aviso(e.error?.error || 'No se pudo quitar la foto', 'danger'); },
    });
  }

  async eliminarCuenta() {
    const al = await this.alert.create({
      cssClass: 'portal-alert',
      header: 'Eliminar cuenta',
      message: 'Se desactivará tu acceso al portal y se cerrará la sesión. Tu historial de servicios queda en el taller. ¿Quieres continuar?',
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        { text: 'Eliminar', role: 'destructive', cssClass: 'portal-alert-danger', handler: () => this.confirmarEliminar() },
      ],
    });
    await al.present();
  }

  private confirmarEliminar() {
    if (this.eliminando) return;
    this.eliminando = true;
    this.portal.eliminarCuenta().pipe(takeUntil(this.destroy$)).subscribe({
      next: async () => {
        await this.aviso('Tu cuenta fue eliminada');
        this.portal.logout();
        this.router.navigate(['/portal/login'], { replaceUrl: true });
      },
      error: (e) => { this.eliminando = false; this.aviso(e.error?.error || 'No se pudo eliminar la cuenta', 'danger'); },
    });
  }

  ngOnDestroy() {
    this.mq?.removeEventListener('change', this.alCambiarAncho);
    this.pararCooldown(); this.destroy$.next(); this.destroy$.complete();
  }

  logout() {
    this.portal.logout();
    this.router.navigate(['/portal/login'], { replaceUrl: true });
  }

  private async aviso(message: string, color = 'success') {
    const t = await this.toast.create({ message, duration: 1800, color });
    await t.present();
  }
}
