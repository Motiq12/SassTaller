import { Component, OnInit, OnDestroy } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { AlertController, ToastController } from '@ionic/angular';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { AdminService, EstadoCorreo, EstadoRespaldos } from '../../services/admin.service';
import { MarcaService } from '../../services/marca.service';
import { PLANTILLAS_WA, PlantillaWa, NOMBRE_DATO, DatosMensaje, rellenar } from '../../shared/whatsapp.util';
import { DOCS_LEGALES, mesYAnio } from '../../shared/textos-legales';

interface HorarioVista { dia: number; label: string; abre: string; cierra: string; activo: boolean; }

@Component({
  standalone: false,
  selector: 'app-admin-config',
  templateUrl: './admin-config.page.html',
  styleUrls: ['./admin-config.page.scss'],
})
export class AdminConfigPage implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  config: any = null;
  cargando = true;
  guardando = false;
  horariosVista: HorarioVista[] = [];

  // Sucursales (locales del taller).
  sucursales: any[] = [];
  nuevaSucursal = { nombre: '', direccion: '', telefono: '' };
  guardandoSucursal = false;

  // Qué parte de la configuración se muestra (la elige el menú: /admin/config/:seccion).
  readonly secciones: Record<string, string> = {
    taller: 'Información del taller',
    horario: 'Horario y capacidad',
    bloqueos: 'Bloquear horario',
    sucursales: 'Sucursales',
    entrega: 'Entrega y cobro',
    notificaciones: 'Notificaciones',
    mensajes: 'Mensajes al cliente',
    portal: 'Textos del portal',
    correo: 'Correo de envío',
    respaldos: 'Respaldos',
    seguridad: 'Seguridad del personal',
  };
  seccion = 'taller';
  get tituloSeccion(): string { return this.secciones[this.seccion]; }

  // La línea que va debajo del título de cada parte.
  readonly descripciones: Record<string, string> = {
    taller: 'El nombre, el logo y el contacto del negocio.',
    horario: 'Cuándo se puede agendar y cuántas citas entran por hora.',
    bloqueos: 'Horas o días en que no se agenda: un feriado, una capacitación, un trabajo grande. El portal no los ofrece y recepción no puede agendar ahí. Las citas que ya estaban no se cancelan.',
    sucursales: 'Locales donde el cliente puede agendar. El horario es compartido; el cupo se cuenta por sucursal.',
    entrega: 'Lo que llega precargado al cerrar y cobrar una orden.',
    notificaciones: 'Qué avisos recibe el cliente sobre sus citas y su moto.',
    portal: 'Lo que lee el cliente en el portal: un aviso arriba del inicio y las condiciones del servicio.',
    mensajes: 'El texto de los WhatsApp que manda recepción y de los correos de moto lista y entregada. Al cliente se le habla de tú.',
    correo: 'Desde qué dirección salen los correos del sistema y si les llegan a los clientes.',
    respaldos: 'La copia de la base de datos que el sistema guarda sola todas las noches a las 2:30 a. m.',
    seguridad: 'Qué contraseñas acepta el sistema para el personal, y cerrar sesiones si se pierde un celular o se va alguien.',
  };

  // Seguridad (GET /api/admin/seguridad): se pide solo al entrar a esa parte.
  personal: any[] | null = null;
  readonly nombreRol: Record<string, string> = { admin: 'Administración', recepcion: 'Recepción', tecnico: 'Mecánico', contenido: 'Sitio web' };

  // Respaldos (GET /api/admin/respaldos): se pide solo al entrar a esa parte.
  respaldos: EstadoRespaldos | null = null;
  errorRespaldos = false;
  respaldando = false;

  // Mensajes al cliente: lo que se edita, partiendo de lo guardado o de lo de fábrica.
  // Se guardan solo los distintos de fábrica (configuracion.plantillas).
  readonly gruposWa: { titulo: string; icono: string; plantillas: PlantillaWa[] }[] = [
    { titulo: 'WhatsApp de la orden', icono: 'construct-outline', plantillas: PLANTILLAS_WA.filter(p => p.grupo === 'orden') },
    { titulo: 'WhatsApp de la cita', icono: 'calendar-outline', plantillas: PLANTILLAS_WA.filter(p => p.grupo === 'cita') },
    { titulo: 'WhatsApp del portal', icono: 'phone-portrait-outline', plantillas: PLANTILLAS_WA.filter(p => p.grupo === 'portal') },
  ];
  readonly nombreDato = NOMBRE_DATO;
  textosWa: Record<string, string> = {};
  textosCorreo: Record<string, { titulo: string; mensaje: string }> = {};
  correoFabrica: Record<string, { titulo: string; mensaje: string }> = {};
  readonly correosHito = [{ clave: 'listo', label: 'Moto lista para retirar' }, { clave: 'entregado', label: 'Moto entregada' }];
  private readonly ejemplo: DatosMensaje = {
    nombre: 'Ana', moto: 'Freedom 150', orden: 'OT-2026-00012', total: '₡45 000', portal: 'enlace del portal',
    hora: '10:00', nota: 'Cambiamos la cadena y el piñón.', usuario: 'ana@correo.com', contrasena: '(contraseña nueva)',
  };

  // Textos del portal (configuracion.portal_textos): el aviso del inicio y las
  // condiciones. Si las condiciones quedan iguales a las de fábrica, se guardan vacías.
  bienvenida = { titulo: '', texto: '' };
  condiciones: { titulo: string; texto: string }[] = [];
  condicionesActualizado: string | null = null;
  private readonly condicionesFabrica = DOCS_LEGALES['terminos'].secciones.map(s => ({ titulo: s.titulo, texto: s.parrafos.join('\n\n') }));

  // Correo de envío (GET /api/admin/correo): se pide solo al entrar a esa parte,
  // porque consulta a Resend.
  correo: EstadoCorreo | null = null;
  errorCorreo = false;
  cargandoCorreo = false;
  probando = false;
  resultadoPrueba = '';
  pruebaOk = true;

  // Avisos al cliente: qué hace cada uno lo deciden notificaciones.js (estado y correo),
  // recepcion.routes.js (presupuesto) y jobs/recordatorios.js.
  readonly avisos = [
    { campo: 'notif_estado', icono: 'swap-horizontal-outline', titulo: 'Cambios de estado',
      detalle: 'Un aviso en el portal cada vez que su cita cambia de estado.', necesita: '' },
    { campo: 'notif_cotizacion', icono: 'receipt-outline', titulo: 'Presupuesto listo',
      detalle: 'Un aviso en el portal cuando el presupuesto está listo para aprobar.', necesita: '' },
    { campo: 'notif_recordatorio', icono: 'alarm-outline', titulo: 'Recordatorio de la cita',
      detalle: 'El día antes de la cita, en el portal y por correo.', necesita: '' },
    { campo: 'notif_email_entrega', icono: 'mail-outline', titulo: 'Correo cuando la moto está lista',
      detalle: 'Un correo cuando la moto queda lista y cuando se entrega.', necesita: 'notif_estado' },
  ];

  // Feriados que se repiten (GET /api/admin/feriados): los marcados y los de ley que faltan.
  feriados: any[] = [];
  sugeridos: { mes: number; dia: number; nombre: string; proxima: string; elegido?: boolean }[] = [];
  nuevoFeriado = { dia: null as number | null, mes: 1, nombre: '', sucursal_id: null as number | null };
  guardandoFeriado = false;
  readonly meses = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'setiembre', 'octubre', 'noviembre', 'diciembre'];

  // Bloquear horario: horas o días en que no se agenda.
  bloqueos: any[] = [];
  nuevoBloqueo = this.bloqueoVacio();
  guardandoBloqueo = false;
  readonly hoy = (() => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); })();

  // Orden de presentación: lunes → domingo.
  private readonly diasOrden = [
    { dia: 1, l: 'Lunes' }, { dia: 2, l: 'Martes' }, { dia: 3, l: 'Miércoles' },
    { dia: 4, l: 'Jueves' }, { dia: 5, l: 'Viernes' }, { dia: 6, l: 'Sábado' }, { dia: 0, l: 'Domingo' },
  ];

  constructor(
    private admin: AdminService, private toast: ToastController,
    private marcaSvc: MarcaService, private alert: AlertController,
    private route: ActivatedRoute,
  ) {}

  ngOnInit() {
    // La misma pantalla sirve las seis partes: al cambiar de opción en el menú solo
    // cambia el parámetro, así que se escucha (no basta con leerlo una vez).
    this.route.paramMap.pipe(takeUntil(this.destroy$)).subscribe(p => {
      const s = p.get('seccion') || 'taller';
      this.seccion = this.secciones[s] ? s : 'taller';
      if (this.seccion === 'correo' && !this.correo) this.cargarCorreo();
      if (this.seccion === 'respaldos') this.cargarRespaldos();
      if (this.seccion === 'seguridad') this.cargarSeguridad();
    });
    this.cargar();
    this.cargarSucursales();
    this.cargarBloqueos();
    this.cargarFeriados();
  }

  // —— Feriados que se repiten ——
  cargarFeriados() {
    this.admin.getFeriados().pipe(takeUntil(this.destroy$)).subscribe({
      next: r => { this.feriados = r.data.feriados || []; this.sugeridos = r.data.sugeridos || []; },
    });
  }

  get sugeridosElegidos() { return this.sugeridos.filter(s => s.elegido); }

  marcarSugeridos() { this.guardarFeriados(this.sugeridosElegidos.map(s => ({ mes: s.mes, dia: s.dia, nombre: s.nombre }))); }

  agregarFeriado() {
    const f = this.nuevoFeriado;
    if (!f.dia) { this.aviso('Elegí el día', 'warning'); return; }
    if (f.nombre.trim().length < 3) { this.aviso('Escribí el nombre del feriado', 'warning'); return; }
    this.guardarFeriados([{ mes: Number(f.mes), dia: Number(f.dia), nombre: f.nombre.trim(), sucursal_id: f.sucursal_id }],
      () => this.nuevoFeriado = { dia: null, mes: 1, nombre: '', sucursal_id: null });
  }

  private guardarFeriados(lista: any[], luego?: () => void) {
    if (!lista.length) return;
    this.guardandoFeriado = true;
    this.admin.crearFeriados(lista).pipe(takeUntil(this.destroy$)).subscribe({
      next: r => { this.guardandoFeriado = false; luego?.(); this.aviso(r.message); this.cargarFeriados(); },
      error: (e) => { this.guardandoFeriado = false; this.aviso(e.error?.error || 'No se pudo guardar', 'danger'); },
    });
  }

  async quitarFeriado(f: any) {
    const a = await this.alert.create({
      cssClass: 'alert-light',
      header: 'Quitar feriado',
      message: `«${f.nombre}» deja de bloquearse: ese día se vuelve a ofrecer para agendar, este año y los siguientes.`,
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        { text: 'Quitar', handler: () => {
          this.admin.quitarFeriado(f.id).pipe(takeUntil(this.destroy$)).subscribe({
            next: r => { this.aviso(r.message); this.cargarFeriados(); },
            error: (e) => this.aviso(e.error?.error || 'No se pudo quitar', 'danger'),
          });
        } },
      ],
    });
    await a.present();
  }

  // "25 de julio"
  diaYMes(f: { mes: number; dia: number }): string { return `${f.dia} de ${this.meses[f.mes - 1]}`; }
  // "sáb 25/7/2027"
  fechaCorta(x: string | null): string {
    return x ? new Date(`${x}T12:00:00Z`).toLocaleDateString('es-CR', { weekday: 'short', day: 'numeric', month: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '';
  }

  // —— Bloquear horario ——
  private bloqueoVacio() {
    return { sucursal_id: null as number | null, fecha_desde: '', fecha_hasta: '', todo_el_dia: true, hora_desde: '13:00', hora_hasta: '17:00', motivo: '' };
  }

  cargarBloqueos() {
    this.admin.getBloqueos().pipe(takeUntil(this.destroy$)).subscribe({ next: r => this.bloqueos = r.data || [] });
  }

  crearBloqueo() {
    const b = this.nuevoBloqueo;
    if (!b.fecha_desde) { this.aviso('Elegí desde qué día', 'warning'); return; }
    if (b.motivo.trim().length < 3) { this.aviso('Escribí el motivo (lo ve el equipo)', 'warning'); return; }
    this.guardandoBloqueo = true;
    this.admin.crearBloqueo({ ...b, fecha_hasta: b.fecha_hasta || b.fecha_desde, motivo: b.motivo.trim() })
      .pipe(takeUntil(this.destroy$)).subscribe({
        next: async r => {
          this.guardandoBloqueo = false;
          this.nuevoBloqueo = this.bloqueoVacio();
          this.cargarBloqueos();
          const n = r.data?.citas_afectadas || 0;
          if (!n) { this.aviso('Horario bloqueado'); return; }
          // Las citas que ya estaban no se cancelan solas: hay que avisarle a la persona.
          const a = await this.alert.create({
            cssClass: 'alert-light',
            header: 'Horario bloqueado',
            message: `Ojo: ya hay ${n} cita${n === 1 ? '' : 's'} agendada${n === 1 ? '' : 's'} en ese horario. No se cancelan solas: reprogramalas o avisale al cliente desde Gestión de citas.`,
            buttons: ['Entendido'],
          });
          await a.present();
        },
        error: (e) => { this.guardandoBloqueo = false; this.aviso(e.error?.error || 'No se pudo bloquear', 'danger'); },
      });
  }

  async quitarBloqueo(b: any) {
    const a = await this.alert.create({
      cssClass: 'alert-light',
      header: 'Quitar bloqueo',
      message: `«${b.motivo}»: esas horas se vuelven a ofrecer para agendar.`,
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Quitar',
          handler: () => {
            this.admin.quitarBloqueo(b.id).pipe(takeUntil(this.destroy$)).subscribe({
              next: () => { this.bloqueos = this.bloqueos.filter(x => x.id !== b.id); this.aviso('Bloqueo quitado'); },
              error: (e) => this.aviso(e.error?.error || 'No se pudo quitar', 'danger'),
            });
          },
        },
      ],
    });
    await a.present();
  }

  // "sáb 25/10" o "sáb 25/10 al lun 27/10".
  textoFechas(b: any): string {
    const f = (x: string) => new Date(`${x}T12:00:00Z`).toLocaleDateString('es-CR', { weekday: 'short', day: '2-digit', month: '2-digit', timeZone: 'UTC' });
    return b.fecha_desde === b.fecha_hasta ? f(b.fecha_desde) : `${f(b.fecha_desde)} al ${f(b.fecha_hasta)}`;
  }

  // La hojita de calendario de cada bloqueo: "OCT" y "25".
  mesCorto(x: string): string {
    return new Date(`${x}T12:00:00Z`).toLocaleDateString('es-CR', { month: 'short', timeZone: 'UTC' }).replace('.', '');
  }
  diaDelMes(x: string): string { return x.slice(8, 10); }

  // Horas para agendar en un día: una por cada hora entera entre que abre y cierra,
  // igual que horasDisponibles() en el servidor (abre 8:30 y cierra 17:00 = 9).
  horasDe(h: HorarioVista): number {
    const abre = parseInt(h.abre, 10), cierra = parseInt(h.cierra, 10);
    return Number.isFinite(abre) && Number.isFinite(cierra) ? Math.max(0, cierra - abre) : 0;
  }

  get resumenHorario() {
    const abiertos = this.horariosVista.filter(h => h.activo);
    const horas = abiertos.reduce((n, h) => n + this.horasDe(h), 0);
    return { dias: abiertos.length, horas, lugares: horas * (Number(this.config?.max_citas_hora) || 0) };
  }

  // —— Correo de envío ——
  cargarCorreo() {
    this.cargandoCorreo = true;
    this.errorCorreo = false;
    this.admin.getCorreo().pipe(takeUntil(this.destroy$)).subscribe({
      next: r => { this.correo = r.data; this.cargandoCorreo = false; },
      error: () => { this.errorCorreo = !this.correo; this.cargandoCorreo = false; },
    });
  }

  get estadoCorreo(): { etiqueta: string; clase: string; texto: string } {
    const c = this.correo;
    const dom = c?.dominio || 'el dominio';
    if (!c) return { etiqueta: '', clase: '', texto: '' };
    if (!c.configurado) return { etiqueta: 'Sin configurar', clase: 'mal',
      texto: 'El servidor no tiene la clave de Resend: no sale ningún correo. Así funciona en una computadora de prueba, no en producción.' };
    if (c.de_prueba) return { etiqueta: 'Remitente de prueba', clase: 'mal',
      texto: 'Con el remitente de prueba de Resend, los correos solo le llegan al dueño de la cuenta de Resend. A los clientes no les llega nada, ni el código para registrarse.' };
    switch (c.verificacion) {
      case 'verificado': return { etiqueta: 'Verificado', clase: 'on',
        texto: `El dominio ${dom} está verificado en Resend: los correos pueden llegar a cualquier dirección.` };
      case 'pendiente': return { etiqueta: 'Sin verificar', clase: 'medio',
        texto: `${dom} está en Resend, pero todavía no se verificaron sus registros DNS. Hasta entonces, a los clientes no les llega nada.` };
      case 'fallido': return { etiqueta: 'Falló la verificación', clase: 'mal',
        texto: `Resend no encontró los registros DNS de ${dom}. Hay que revisarlos con quien maneja el dominio.` };
      case 'no_agregado': return { etiqueta: 'Dominio no agregado', clase: 'mal',
        texto: `${dom} no está en la cuenta de Resend: hay que agregarlo y verificarlo.` };
      case 'sin_permiso': return { etiqueta: 'No se puede revisar', clase: 'medio',
        texto: `La clave de Resend solo permite enviar, así que desde acá no se ve si ${dom} está verificado. Revisalo en resend.com → Domains, o mandate un correo de prueba.` };
      default: return { etiqueta: 'Sin respuesta', clase: 'medio',
        texto: 'No se pudo consultar a Resend. Probá otra vez en un rato.' };
    }
  }

  probarCorreo() {
    this.probando = true;
    this.resultadoPrueba = '';
    this.admin.probarCorreo().pipe(takeUntil(this.destroy$)).subscribe({
      next: r => {
        this.probando = false;
        this.pruebaOk = r.data.enviado;
        this.resultadoPrueba = r.data.enviado
          ? `Salió hacia ${r.data.email}. Revisá la bandeja de entrada (y la de spam). Si no llega en unos minutos, el dominio no está listo.`
          : r.message;
      },
      error: (e) => { this.probando = false; this.pruebaOk = false; this.resultadoPrueba = e.error?.error || 'No se pudo mandar la prueba'; },
    });
  }

  // —— Seguridad del personal ——
  cargarSeguridad() {
    this.admin.getSeguridad().pipe(takeUntil(this.destroy$)).subscribe({ next: r => this.personal = r.data.personal });
  }

  get activosConDosPasos(): number { return (this.personal || []).filter(p => p.activo && p.totp_activado).length; }
  get activos(): number { return (this.personal || []).filter(p => p.activo).length; }

  async cerrarSesion(p: any | null) {
    const a = await this.alert.create({
      cssClass: 'alert-light',
      header: p ? `Cerrar la sesión de ${p.nombre}` : 'Cerrar las sesiones de todo el personal',
      message: (p ? 'Si tiene el sistema abierto en algún celular o computadora, lo saca y tiene que volver a entrar.'
                  : 'Todos, menos vos, tienen que volver a entrar en cada celular y computadora.')
        + ' No cambia la contraseña: quien la sepa puede volver a entrar.',
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        { text: 'Cerrar sesión', role: 'destructive', handler: () => {
          this.admin.cerrarSesiones(p ? { usuario_id: p.id } : { todos: true }).pipe(takeUntil(this.destroy$)).subscribe({
            next: r => { this.aviso(r.message); this.cargarSeguridad(); },
            error: (e) => this.aviso(e.error?.error || 'No se pudo cerrar', 'danger'),
          });
        } },
      ],
    });
    await a.present();
  }

  // —— Respaldos ——
  cargarRespaldos() {
    this.errorRespaldos = false;
    this.admin.getRespaldos().pipe(takeUntil(this.destroy$)).subscribe({
      next: r => this.respaldos = r.data,
      error: () => this.errorRespaldos = !this.respaldos,
    });
  }

  get estadoRespaldos(): { etiqueta: string; clase: string; titulo: string } {
    const r = this.respaldos;
    const cuando = r?.ultimo_ok ? this.haceCuanto(r.ultimo_ok) : '';
    switch (r?.estado) {
      case 'al_dia': return { etiqueta: 'Al día', clase: 'on', titulo: `Último respaldo ${cuando}` };
      case 'atrasado': return { etiqueta: 'Atrasado', clase: 'medio', titulo: `El último respaldo bueno fue ${cuando}: anoche no se hizo` };
      case 'fallo': return { etiqueta: 'Falló', clase: 'mal', titulo: 'El último respaldo falló' + (cuando ? ` · el último bueno fue ${cuando}` : '') };
      case 'sin_configurar': return { etiqueta: 'Sin configurar', clase: 'mal', titulo: 'La base no se está respaldando' };
      default: return { etiqueta: 'Sin datos', clase: 'medio', titulo: 'Todavía no hay ningún respaldo' };
    }
  }

  get ultimoRegistroOk() { return this.respaldos?.registro.find(x => x.ok) || null; }
  get ultimoError() { const x = this.respaldos?.registro[0]; return x && !x.ok ? x : null; }

  // "hace 6 h", "hace 2 días"
  haceCuanto(iso: string): string {
    const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (min < 1) return 'hace un momento';
    if (min < 60) return `hace ${min} min`;
    const h = Math.round(min / 60);
    if (h < 48) return `hace ${h} h`;
    return `hace ${Math.round(h / 24)} días`;
  }
  megas(bytes: number | null): string {
    if (bytes == null) return '—';
    return bytes < 1024 * 1024 ? Math.max(1, Math.round(bytes / 1024)) + ' KB' : (bytes / 1024 / 1024).toFixed(1) + ' MB';
  }
  // "sáb 24/10, 4:02 p. m." o, con año, "sábado 24/10/2026, 4:02 p. m." (la app no registra
  // el idioma de Angular, así que el pipe date sale en inglés).
  fechaHora(iso: string, largo = false): string {
    return new Date(iso).toLocaleString('es-CR', {
      weekday: largo ? 'long' : 'short', day: 'numeric', month: 'numeric', ...(largo ? { year: 'numeric' } : {}),
      hour: 'numeric', minute: '2-digit',
    });
  }

  async respaldarAhora() {
    const a = await this.alert.create({
      cssClass: 'alert-light',
      header: 'Respaldar ahora',
      message: 'Se hace una copia de la base ya, además de la de la noche. Tarda unos segundos y el sistema sigue funcionando. Se guardan las últimas ' + (this.respaldos?.configuracion.conservar || 14) + ': la más vieja se borra.',
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        { text: 'Respaldar', handler: () => this.hacerRespaldo() },
      ],
    });
    await a.present();
  }

  private hacerRespaldo() {
    this.respaldando = true;
    this.admin.respaldarAhora().pipe(takeUntil(this.destroy$)).subscribe({
      next: r => { this.respaldando = false; this.aviso(r.message || 'Respaldo hecho'); this.cargarRespaldos(); },
      error: (e) => { this.respaldando = false; this.aviso(e.error?.error || 'No se pudo respaldar', 'danger'); this.cargarRespaldos(); },
    });
  }

  // —— Textos del portal ——
  private prepararPortal() {
    const t = this.config?.portal_textos || {};
    this.bienvenida = { titulo: t.bienvenida?.titulo || '', texto: t.bienvenida?.texto || '' };
    const propias = Array.isArray(t.condiciones) ? t.condiciones : [];
    this.condiciones = (propias.length ? propias : this.condicionesFabrica).map((s: any) => ({ titulo: s.titulo, texto: s.texto }));
    this.condicionesActualizado = t.condiciones_actualizado || null;
  }

  get condicionesDeFabrica(): boolean {
    const limpias = this.condiciones.map(s => ({ titulo: s.titulo.trim(), texto: s.texto.trim() })).filter(s => s.titulo && s.texto);
    return JSON.stringify(limpias) === JSON.stringify(this.condicionesFabrica);
  }
  get textoActualizado(): string { return this.condicionesActualizado ? mesYAnio(this.condicionesActualizado) : ''; }
  agregarCondicion() { this.condiciones = [...this.condiciones, { titulo: '', texto: '' }]; }
  quitarCondicion(i: number) { this.condiciones = this.condiciones.filter((_, x) => x !== i); }
  moverCondicion(i: number, d: -1 | 1) {
    const j = i + d;
    if (j < 0 || j >= this.condiciones.length) return;
    const c = [...this.condiciones];
    [c[i], c[j]] = [c[j], c[i]];
    this.condiciones = c;
  }
  condicionesAFabrica() { this.condiciones = this.condicionesFabrica.map(s => ({ ...s })); }
  parrafosDe(texto: string): string[] { return texto.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean); }

  guardarPortal() {
    const condiciones = this.condicionesDeFabrica ? []
      : this.condiciones.map(s => ({ titulo: s.titulo.trim(), texto: s.texto.trim() })).filter(s => s.titulo && s.texto);
    this.config.portal_textos = { bienvenida: { titulo: this.bienvenida.titulo.trim(), texto: this.bienvenida.texto.trim() }, condiciones };
    this.guardarConfig();
  }

  // —— Mensajes al cliente ——
  private prepararMensajes() {
    const propias = this.config?.plantillas || { whatsapp: {}, correo: {} };
    if (this.config?.plantillas_fabrica?.correo) this.correoFabrica = this.config.plantillas_fabrica.correo;
    this.textosWa = {};
    for (const p of PLANTILLAS_WA) this.textosWa[p.clave] = propias.whatsapp?.[p.clave] || p.fabrica;
    this.textosCorreo = {};
    for (const c of this.correosHito) {
      this.textosCorreo[c.clave] = {
        titulo: propias.correo?.[c.clave]?.titulo || this.correoFabrica[c.clave]?.titulo || '',
        mensaje: propias.correo?.[c.clave]?.mensaje || this.correoFabrica[c.clave]?.mensaje || '',
      };
    }
  }

  cambiadoWa(p: PlantillaWa): boolean { return (this.textosWa[p.clave] || '').trim() !== p.fabrica; }
  deFabricaWa(p: PlantillaWa) { this.textosWa[p.clave] = p.fabrica; }
  muestraWa(p: PlantillaWa): string { return rellenar(this.textosWa[p.clave] || p.fabrica, this.ejemplo); }
  cambiadoCorreo(c: string): boolean {
    const f = this.correoFabrica[c]; const t = this.textosCorreo[c];
    return !!f && !!t && (t.titulo.trim() !== f.titulo || t.mensaje.trim() !== f.mensaje);
  }
  deFabricaCorreo(c: string) { this.textosCorreo[c] = { ...this.correoFabrica[c] }; }
  muestraCorreo(texto: string): string { return rellenar(texto, this.ejemplo); }

  guardarMensajes() {
    const whatsapp: Record<string, string> = {};
    for (const p of PLANTILLAS_WA) {
      const t = (this.textosWa[p.clave] || '').trim();
      if (t && t !== p.fabrica) whatsapp[p.clave] = t;
    }
    const correo: Record<string, { titulo?: string; mensaje?: string }> = {};
    for (const c of this.correosHito) {
      const f = this.correoFabrica[c.clave]; const t = this.textosCorreo[c.clave];
      if (!f || !t) continue;
      const titulo = t.titulo.trim(); const mensaje = t.mensaje.trim();
      const propio = { ...(titulo && titulo !== f.titulo ? { titulo } : {}), ...(mensaje && mensaje !== f.mensaje ? { mensaje } : {}) };
      if (Object.keys(propio).length) correo[c.clave] = propio;
    }
    this.config.plantillas = { whatsapp, correo };
    this.guardarConfig();
  }

  cargar() {
    this.cargando = true;
    this.admin.getConfig().pipe(takeUntil(this.destroy$)).subscribe({
      next: r => { this.config = r.data; this.normalizarHorarios(); this.normalizarMetodos(); this.prepararMensajes(); this.prepararPortal(); this.cargando = false; },
      error: () => { this.cargando = false; this.aviso('No se pudo cargar la configuración', 'danger'); },
    });
  }

  cargarSucursales() {
    this.admin.getSucursales().pipe(takeUntil(this.destroy$)).subscribe({ next: r => this.sucursales = r.data || [] });
  }

  agregarSucursal() {
    const nombre = this.nuevaSucursal.nombre.trim();
    if (!nombre) { this.aviso('Escribí el nombre de la sucursal', 'warning'); return; }
    this.guardandoSucursal = true;
    this.admin.createSucursal({
      nombre,
      direccion: this.nuevaSucursal.direccion.trim() || undefined,
      telefono: this.nuevaSucursal.telefono.trim() || undefined,
    }).pipe(takeUntil(this.destroy$)).subscribe({
      next: () => {
        this.guardandoSucursal = false;
        this.nuevaSucursal = { nombre: '', direccion: '', telefono: '' };
        this.cargarSucursales();
        this.aviso('Sucursal creada');
      },
      error: (e) => { this.guardandoSucursal = false; this.aviso(e.error?.error || 'No se pudo crear', 'danger'); },
    });
  }

  guardarSucursal(s: any) {
    if (!s.nombre?.trim()) { this.aviso('La sucursal necesita un nombre', 'warning'); return; }
    this.admin.updateSucursal(s.id, { nombre: s.nombre.trim(), direccion: s.direccion?.trim() || undefined, telefono: s.telefono?.trim() || undefined }).pipe(takeUntil(this.destroy$)).subscribe({
      next: () => this.aviso('Sucursal actualizada'),
      error: (e) => this.aviso(e.error?.error || 'No se pudo guardar', 'danger'),
    });
  }

  // Llega como 1/0 (o true/false después de cambiarla acá).
  activa(s: any): boolean { return !!Number(s.activa); }

  toggleSucursal(s: any) {
    const activa = !Number(s.activa);
    this.admin.toggleSucursal(s.id, activa).pipe(takeUntil(this.destroy$)).subscribe({
      next: () => { s.activa = activa ? 1 : 0; },
      error: (e) => this.aviso(e.error?.error || 'No se pudo cambiar', 'danger'),
    });
  }

  private normalizarHorarios() {
    const src: any[] = Array.isArray(this.config?.horarios) ? this.config.horarios : [];
    this.horariosVista = this.diasOrden.map(d => {
      const h = src.find(x => Number(x.dia) === d.dia);
      return {
        dia: d.dia, label: d.l,
        abre: h?.abre || '08:00',
        cierra: h?.cierra || '17:00',
        activo: h ? !!Number(h.activo) : d.dia !== 0,
      };
    });
  }

  onLogoFile(ev: any) {
    const file = ev.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { this.config.logo = reader.result as string; };
    reader.readAsDataURL(file);
  }
  quitarLogo() { this.config.logo = null; }

  guardarConfig() {
    this.guardando = true;
    const payload = {
      ...this.config,
      horarios: this.horariosVista.map(h => ({ dia: h.dia, abre: h.abre, cierra: h.cierra, activo: h.activo ? 1 : 0 })),
    };
    this.admin.updateConfig(payload).pipe(takeUntil(this.destroy$)).subscribe({
      next: r => {
        // El PUT no trae los correos de fábrica: se conservan los que ya estaban.
        this.config = { ...r.data, plantillas_fabrica: this.config?.plantillas_fabrica };
        this.normalizarHorarios();
        this.normalizarMetodos();
        this.prepararMensajes();
        this.prepararPortal();
        // El logo y el nombre viajan a la factura y al PDF por MarcaService, que cachea:
        // sin esto habria que recargar la app para ver el cambio.
        this.marcaSvc.invalidar();
        this.guardando = false;
        this.aviso('Configuración guardada');
      },
      error: (e) => { this.guardando = false; this.aviso(e.error?.error || 'No se pudo guardar', 'danger'); },
    });
  }

  // Siempre al menos una forma de pago: sin ninguna, el cierre de orden se queda sin
  // opciones y no se puede entregar nada.
  private normalizarMetodos() {
    if (!Array.isArray(this.config?.metodos_pago) || !this.config.metodos_pago.length) {
      this.config.metodos_pago = [{ valor: 'efectivo', etiqueta: 'Efectivo' }];
    }
  }

  agregarMetodoPago() {
    this.config.metodos_pago = [...(this.config.metodos_pago || []), { valor: '', etiqueta: '' }];
  }

  // El identificador interno de los existentes NO se toca: es lo que quedó escrito en
  // las órdenes ya cobradas. Para los nuevos lo deriva el backend de la etiqueta.
  quitarMetodoPago(i: number) {
    if (this.config.metodos_pago.length <= 1) return;
    this.config.metodos_pago = this.config.metodos_pago.filter((_: any, x: number) => x !== i);
  }

  ngOnDestroy() { this.destroy$.next(); this.destroy$.complete(); }

  private async aviso(message: string, color = 'success') {
    const t = await this.toast.create({ message, duration: 1800, color });
    await t.present();
  }
}
