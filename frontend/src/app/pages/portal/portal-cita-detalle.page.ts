import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ToastController, AlertController } from '@ionic/angular';
import { Subject, interval } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { PortalService } from '../../services/portal.service';
import { MarcaService } from '../../services/marca.service';
import { FLUJO_CITA, ESTADO_CITA_LABEL, ETAPAS_PORTAL } from '../../shared/utils/servicios.util';

@Component({
  standalone: false,
  selector: 'app-portal-cita-detalle',
  templateUrl: './portal-cita-detalle.page.html',
  styleUrls: ['../../../theme/panel/base.scss', '../../../theme/panel/contenidos.scss', '../../../theme/panel/agenda.scss', '../../../theme/panel/capsulas.scss', '../../../theme/panel/estandar.scss', '../../../theme/portal.scss', './portal-cita-detalle.page.scss'],
})
export class PortalCitaDetallePage implements OnInit, OnDestroy {
  // El comprobante lo imprime el cliente de CUALQUIER taller: el encabezado y el
  // pie salen de su marca, no de un nombre escrito en el cÃ³digo.
  private readonly marcaSvc = inject(MarcaService);

  private destroy$ = new Subject<void>();
  cita: any = null;
  orden: any = null;        // detalle de la orden vinculada (si hay)
  cargando = true;
  procesando = false;       // aprobar/rechazar en curso (deshabilita los CTA)

  readonly flujo = FLUJO_CITA;
  readonly estadoLabel = ESTADO_CITA_LABEL;

  // Etapas de la timeline (cockpit): los estados macro que ve el cliente, con su Ã­cono.
  // Compartidas con la vista de ejemplo de la landing (ver ETAPAS_PORTAL).
  private readonly etapasMeta = ETAPAS_PORTAL;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private portal: PortalService,
    private toast: ToastController,
    private alert: AlertController,
  ) {}

  // Cada etapa con su posiciÃ³n relativa al estado actual (pasado | activo | futuro).
  get etapas(): { key: string; label: string; icon: string; estado: 'pasado' | 'activo' | 'futuro' }[] {
    const iActual = this.flujo.indexOf(this.cita?.estado);
    return this.etapasMeta.map((e, i) => ({
      ...e,
      estado: iActual < 0 ? 'futuro' : i < iActual ? 'pasado' : i === iActual ? 'activo' : 'futuro',
    }));
  }

  get cancelada(): boolean { return this.cita?.estado === 'cancelado'; }

  get progPct(): number {
    const i = this.flujo.indexOf(this.cita?.estado);
    if (i < 0) return 0;
    return Math.round((i / (this.etapasMeta.length - 1)) * 100);
  }

  // Â¿La orden vinculada espera que el cliente apruebe el presupuesto?
  get esperandoAprobacion(): boolean {
    return this.cita?.orden_estado === 'esperando_aprobacion' && this.cita?.aprobacion_cliente === 'pendiente';
  }

  // Iniciales para el avatar del mecÃ¡nico (no hay foto de staff en la BD).
  iniciales(nombre?: string): string {
    const p = (nombre || '').trim().split(/\s+/);
    return ((p[0]?.[0] || '') + (p[1]?.[0] || '')).toUpperCase() || 'Â·';
  }

  private citaId = 0;

  ngOnInit() {
    this.citaId = Number(this.route.snapshot.paramMap.get('id'));
    if (this.citaId) {
      this.cargar(this.citaId);
      interval(20000).pipe(takeUntil(this.destroy$)).subscribe(() => this.refrescar());
    }
  }

  cargar(id: number) {
    this.cargando = true;
    this.portal.getCita(id).pipe(takeUntil(this.destroy$)).subscribe({
      next: r => {
        this.cita = r.data;
        this.cargando = false;
        if (this.cita?.orden_id) {
          this.portal.getOrden(this.cita.orden_id).pipe(takeUntil(this.destroy$)).subscribe({ next: o => this.orden = o.data, error: () => {} });
        }
      },
      error: () => { this.cargando = false; },
    });
  }

  private refrescar() {
    if (!this.citaId) return;
    this.portal.getCita(this.citaId).pipe(takeUntil(this.destroy$)).subscribe({
      next: r => {
        this.cita = r.data;
        if (this.cita?.orden_id) {
          this.portal.getOrden(this.cita.orden_id).pipe(takeUntil(this.destroy$)).subscribe({ next: o => this.orden = o.data });
        }
      },
    });
  }

  // â€”â€” Aprobar / rechazar el presupuesto SIN salir del cockpit (fricciÃ³n cero) â€”â€”
  // Reusa los mismos endpoints y el diÃ¡logo de confirmaciÃ³n que el flujo de Inicio.
  // Si ya habÃ­a aprobado antes, lo que se le pide ahora es un adicional.
  get esAdicional(): boolean {
    return this.orden?.total_aprobado !== null && this.orden?.total_aprobado !== undefined;
  }

  get montoAdicional(): number {
    return Math.max(0, this.total - Number(this.orden?.total_aprobado || 0));
  }

  async aprobar() {
    const al = await this.alert.create({
      cssClass: 'portal-alert',
      header: this.esAdicional ? 'Aprobar adicional' : 'Aprobar presupuesto',
      message: this.esAdicional
        ? `Â¿Apruebas el adicional de â‚¡${Number(this.montoAdicional || 0).toLocaleString('es-CR', { maximumFractionDigits: 0 })}? El nuevo total es â‚¡${Number(this.total || 0).toLocaleString('es-CR', { maximumFractionDigits: 0 })}.`
        : `Â¿Apruebas el presupuesto de la orden ${this.cita?.numero_orden}? El taller comenzarÃ¡ la reparaciÃ³n.`,
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        { text: 'Aprobar', cssClass: 'portal-alert-confirm', handler: () => this.enviarDecision('aprobar') },
      ],
    });
    await al.present();
  }

  async rechazar() {
    const al = await this.alert.create({
      cssClass: 'portal-alert',
      header: this.esAdicional ? 'Rechazar adicional' : 'Rechazar presupuesto',
      message: this.esAdicional
        ? 'Lo que ya aprobaste sigue en pie: el taller hace solo eso. CuÃ©ntanos por quÃ© no quieres el adicional (opcional).'
        : 'CuÃ©ntanos por quÃ© rechazas el presupuesto (opcional).',
      inputs: [{ name: 'motivo', type: 'textarea', placeholder: 'Motivo (opcional)' }],
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        { text: 'Rechazar', role: 'destructive', cssClass: 'portal-alert-danger', handler: (d) => this.enviarDecision('rechazar', d?.motivo) },
      ],
    });
    await al.present();
  }

  private enviarDecision(decision: 'aprobar' | 'rechazar', motivo?: string) {
    const ordenId = this.cita?.orden_id;
    if (this.procesando || !ordenId) return;
    this.procesando = true;
    const req = decision === 'aprobar' ? this.portal.aprobar(ordenId) : this.portal.rechazar(ordenId, motivo || '');
    req.pipe(takeUntil(this.destroy$)).subscribe({
      next: async () => {
        this.procesando = false;
        const t = await this.toast.create({
          message: decision === 'aprobar' ? 'Presupuesto aprobado âœ“' : 'Presupuesto rechazado',
          duration: 1800,
          color: decision === 'aprobar' ? 'success' : 'medium',
        });
        await t.present();
        this.cargar(this.cita.id); // recarga â†’ la timeline avanza al nuevo estado
      },
      error: async () => {
        this.procesando = false;
        const t = await this.toast.create({ message: 'No se pudo procesar, intenta de nuevo', duration: 2200, color: 'danger' });
        await t.present();
      },
    });
  }

  // Total: el de la orden vinculada si existe; si no, el monto de la cita.
  get total(): number {
    if (this.orden) return Number(this.orden.total || 0);
    return Number(this.cita?.monto || 0);
  }

  estrellas(n: number): string { return 'â˜…'.repeat(n) + 'â˜†'.repeat(5 - n); }

  // El cliente puede cancelar/editar solo mientras la cita sigue 'agendado' (sin orden).
  // La ventana mÃ­nima de horas la valida el backend (mensaje claro si es muy tarde).
  get puedeCancelar(): boolean {
    return this.cita?.estado === 'agendado' && !this.cita?.orden_id;
  }

  editar() { this.router.navigate(['/portal/cita', this.cita.id, 'editar']); }

  // Â¿Hay algo que valga la pena exportar? (orden vinculada o monto/entrega)
  get puedeDescargar(): boolean {
    return !!(this.orden || this.cita?.monto || this.cita?.estado === 'entregado');
  }

  // Genera un comprobante imprimible (â†’ "Guardar como PDF" desde el diÃ¡logo de impresiÃ³n).
  // Sin dependencias nuevas: abre una ventana con HTML formateado y lanza print().
  descargarComprobante() {
    const c = this.cita;
    const o = this.orden;
    const cli = this.portal.getCliente();
    // El nombre del taller que atendiÃ³, no el del software ni el de otro taller.
    const taller = this.marcaSvc.actual.nombre_taller;
    const money = (n: any) => 'â‚¡' + Number(n || 0).toLocaleString('es-CR', { maximumFractionDigits: 0 });
    const esc = (s: any) => String(s ?? '').replace(/[&<>]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' } as any)[m]);
    const fecha = c.fecha ? new Date(`${String(c.fecha).slice(0, 10)}T00:00:00`).toLocaleDateString('es-CR') : '';

    const filas: string[] = [];
    if (o?.repuestos?.length) {
      for (const r of o.repuestos) {
        const sub = (r.cantidad || 1) * (r.costo_unitario || 0);
        filas.push(`<tr><td>${esc(r.nombre)}${r.cantidad > 1 ? ' Ã—' + r.cantidad : ''}</td><td class="r">${money(sub)}</td></tr>`);
      }
    }
    if (o) {
      filas.push(`<tr><td>Mano de obra</td><td class="r">${money(o.costo_mano_obra)}</td></tr>`);
      if (o.descuento > 0) filas.push(`<tr><td>Descuento</td><td class="r">âˆ’ ${money(o.descuento)}</td></tr>`);
    }
    const total = o ? Number(o.total || 0) : Number(c.monto || 0);

    // El acento del comprobante sale del color del taller. Esta ventana es otro
    // documento, asÃ­ que las variables CSS de la app no llegan: hay que interpolar
    // el valor. Antes iba el rojo de MS Motos a fuego y el cliente de cualquier
    // taller recibÃ­a un comprobante con el color de otra empresa.
    const acento = getComputedStyle(document.documentElement)
      .getPropertyValue('--ion-color-primary').trim();
    const cr = /^#[0-9a-fA-F]{3,8}$/.test(acento) ? acento : '#1e3a5f';

    const html = `<!doctype html><html lang="es"><head><meta charset="utf-8">
      <title>Comprobante ${esc(c.numero_orden || c.id)}</title>
      <style>
        * { box-sizing: border-box; } body { font-family: -apple-system, 'Segoe UI', Roboto, sans-serif; color: #1a1a1a; margin: 0; padding: 28px; }
        .doc { max-width: 620px; margin: 0 auto; }
        .hd { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid ${cr}; padding-bottom: 14px; margin-bottom: 18px; }
        .hd h1 { font-size: 22px; margin: 0; color: ${cr}; letter-spacing: 0; }
        .hd .sub { font-size: 12px; color: #666; margin-top: 2px; }
        .hd .num { text-align: right; font-size: 12px; color: #444; }
        .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 16px; font-size: 13px; margin-bottom: 18px; }
        .grid .k { color: #888; } .grid .v { font-weight: 600; }
        table { width: 100%; border-collapse: collapse; font-size: 13px; margin-bottom: 8px; }
        td { padding: 8px 0; border-bottom: 1px solid #eee; } td.r { text-align: right; font-variant-numeric: tabular-nums; }
        .total { display: flex; justify-content: space-between; font-size: 17px; font-weight: 800; padding-top: 10px; }
        .diag { background: #f7f7f7; border-radius: 2px; padding: 12px; font-size: 12.5px; color: #444; margin-bottom: 16px; }
        .ft { margin-top: 24px; text-align: center; font-size: 11px; color: #999; }
        h3 { font-size: 12px; text-transform: uppercase; letter-spacing: .08em; color: #999; margin: 0 0 6px; }
      </style></head><body><div class="doc">
      <div class="hd">
        <div><h1>${esc(taller)}</h1><div class="sub">Comprobante de servicio</div></div>
        <div class="num"><strong>${esc(c.numero_orden || ('Cita #' + c.id))}</strong><br>${esc(fecha)}</div>
      </div>
      <div class="grid">
        <div><div class="k">Cliente</div><div class="v">${esc(cli ? cli.nombre + ' ' + cli.apellido : 'â€”')}</div></div>
        <div><div class="k">VehÃ­culo</div><div class="v">${esc(c.marca)} ${esc(c.modelo)}${c.placa ? ' Â· ' + esc(c.placa) : ''}</div></div>
        <div><div class="k">Servicio</div><div class="v">${esc(c.tipo_servicio || c.motivo || 'â€”')}</div></div>
        <div><div class="k">MecÃ¡nico</div><div class="v">${esc(c.tecnico_nombre || 'Por asignar')}</div></div>
      </div>
      ${o?.diagnostico ? `<div class="diag"><strong>DiagnÃ³stico:</strong> ${esc(o.diagnostico)}</div>` : ''}
      ${filas.length ? `<h3>Detalle</h3><table>${filas.join('')}</table>` : ''}
      <div class="total"><span>Total</span><span>${money(total)}</span></div>
      <div class="ft">Gracias por confiar en ${esc(taller)} Â· Documento generado el ${new Date().toLocaleDateString('es-CR')}</div>
      </div>
      <script>window.onload = function(){ window.print(); }</script>
      </body></html>`;

    const w = window.open('', '_blank');
    if (!w) {
      this.toast.create({ message: 'Permite las ventanas emergentes para descargar el comprobante.', duration: 3000, color: 'warning' }).then(t => t.present());
      return;
    }
    w.document.open();
    w.document.write(html);
    w.document.close();
  }

  async cancelar() {
    const al = await this.alert.create({
      cssClass: 'portal-alert',
      header: 'Cancelar cita',
      message: 'Esta acciÃ³n no se puede deshacer. Â¿Quieres cancelar esta cita?',
      buttons: [
        { text: 'No', role: 'cancel' },
        { text: 'SÃ­, cancelar', role: 'destructive', cssClass: 'portal-alert-danger', handler: () => this.confirmarCancelar() },
      ],
    });
    await al.present();
  }

  private confirmarCancelar() {
    this.portal.cancelarCita(this.cita.id).pipe(takeUntil(this.destroy$)).subscribe({
      next: async () => {
        this.cita.estado = 'cancelado';
        const t = await this.toast.create({ message: 'Cita cancelada', duration: 2000, color: 'medium' });
        await t.present();
      },
      error: async (e) => {
        const t = await this.toast.create({ message: e.error?.error || 'No se pudo cancelar', duration: 2400, color: 'danger' });
        await t.present();
      },
    });
  }

  async calificar() {
    const al = await this.alert.create({
      cssClass: 'portal-alert',
      header: 'Â¿CÃ³mo fue el servicio?',
      inputs: [1, 2, 3, 4, 5].map(n => ({ type: 'radio' as const, label: 'â˜…'.repeat(n) + ` (${n})`, value: n })),
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        { text: 'Enviar', handler: (n) => this.enviarCalif(n) },
      ],
    });
    await al.present();
  }

  private enviarCalif(n: number) {
    if (!n) return;
    this.portal.calificarCita(this.cita.id, n).pipe(takeUntil(this.destroy$)).subscribe({
      next: async () => {
        this.cita.calificacion = n;
        const t = await this.toast.create({ message: 'Â¡Gracias por tu opiniÃ³n!', duration: 2000, color: 'success' });
        await t.present();
      },
      error: async (err) => {
        const t = await this.toast.create({ message: err.error?.error || 'No se pudo calificar', duration: 2200, color: 'danger' });
        await t.present();
      },
    });
  }

  ngOnDestroy() { this.destroy$.next(); this.destroy$.complete(); }
}
