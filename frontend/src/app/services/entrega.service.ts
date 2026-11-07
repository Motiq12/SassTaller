import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { ActionSheetController, AlertController, ModalController, ToastController } from '@ionic/angular';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';
import { MarcaService } from './marca.service';
import { EntregarOrdenComponent } from '../shared/entregar-orden/entregar-orden.component';
import { rutaPanel } from '../shared/ruta-panel';

// Entregar una moto desde el mostrador. La entrega la marca quien está ahí cuando el
// cliente se la lleva (recepción o administración), con el mismo diálogo en todas las
// pantallas, sea una orden de trabajo o una cita sin orden (un servicio rápido).
//
// Si en el sistema todavía no estaba "lista", lo avisa y deja entregarla igual: pasa
// que el cliente se la lleva antes de que alguien actualice el estado.
//
//   Orden: un solo cuadro (EntregarOrdenComponent) con el total, la forma de pago,
//          la garantía (la de Configuración, editable) y lo que falte del checklist.
//   Cita sin orden: forma de pago y el monto cobrado, opcional (es lo que suman los
//          reportes).

export interface OrdenParaEntregar { id: number; numero_orden?: string | null; total?: number | null; estado?: string | null; }
export interface CitaParaEntregar { id: number; estado?: string | null; monto?: number | string | null; }

const ICONO_PAGO: Record<string, string> = {
  efectivo: 'cash-outline',
  tarjeta: 'card-outline',
  sinpe: 'phone-portrait-outline',
  transferencia: 'swap-horizontal-outline',
};

@Injectable({ providedIn: 'root' })
export class EntregaService {
  private api = environment.apiUrl;

  constructor(
    private http: HttpClient,
    private marca: MarcaService,
    private sheet: ActionSheetController,
    private alert: AlertController,
    private modal: ModalController,
    private toast: ToastController,
    private router: Router,
  ) {}

  // Devuelve true si quedó entregada.
  async entregarOrden(o: OrdenParaEntregar): Promise<boolean> {
    const marca = await firstValueFrom(this.marca.get());
    const m = await this.modal.create({
      component: EntregarOrdenComponent,
      componentProps: {
        ordenId: o.id,
        numeroOrden: o.numero_orden ?? null,
        total: o.total === undefined || o.total === null ? null : Number(o.total),
        estado: o.estado ?? null,
        metodos: marca.metodos_pago,
        garantiaDias: marca.garantia_dias || 30,
      },
      cssClass: ['adm-modal', 'adm-modal-auto'],
    });
    await m.present();
    const { role, data } = await m.onDidDismiss();
    if (role !== 'entregada') return false;
    await this.aviso(data?.cortesia ? 'Orden entregada. ¡El cliente ganó una cortesía!' : 'Orden entregada', 'success');
    if (data?.abrirFactura) this.router.navigate([rutaPanel(this.router, '/factura'), o.id]);
    return true;
  }

  async entregarCita(c: CitaParaEntregar): Promise<boolean> {
    let forzar = false;
    if (c.estado && c.estado !== 'listo') {
      if (!(await this.confirmarNoLista('cita'))) return false;
      forzar = true;
    }
    const marca = await firstValueFrom(this.marca.get());
    const metodo = await this.elegirMetodo(marca.metodos_pago, 'Entregar la moto', true);
    if (metodo === undefined) return false;
    const monto = await this.pedirMonto(c.monto);
    if (monto === undefined) return false;
    const body: Record<string, unknown> = { forzar };
    if (metodo) body['metodo_pago'] = metodo;
    if (monto !== null) body['monto'] = monto;
    const r = await this.enviar(`${this.api}/citas/${c.id}/entregar`, body, 'cita');
    if (!r) return false;
    await this.aviso('Moto entregada', 'success');
    return true;
  }

  // Si el servidor contesta que no estaba lista (alguien la vio con otro estado),
  // pregunta y reintenta con forzar.
  private async enviar(url: string, body: Record<string, unknown>, tipo: 'orden' | 'cita'): Promise<any | null> {
    try {
      return await firstValueFrom(this.http.post<any>(url, body));
    } catch (e: any) {
      if (e?.status === 409 && e.error?.requiere_confirmacion && !body['forzar']) {
        if (!(await this.confirmarNoLista(tipo))) return null;
        return this.enviar(url, { ...body, forzar: true }, tipo);
      }
      await this.aviso(e?.error?.error || 'No se pudo marcar la entrega', 'danger');
      return null;
    }
  }

  private async confirmarNoLista(tipo: 'orden' | 'cita'): Promise<boolean> {
    const a = await this.alert.create({
      header: 'Todavía no estaba lista',
      message: `En el sistema esta ${tipo} no estaba marcada como lista para entrega. ¿La entregas igual?`,
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        { text: 'Entregar igual', role: 'confirm' },
      ],
    });
    await a.present();
    const { role } = await a.onDidDismiss();
    return role === 'confirm';
  }

  // undefined = canceló; null = no registrar el pago (solo en citas).
  private async elegirMetodo(metodos: { valor: string; etiqueta: string }[], header: string, permitirOmitir: boolean): Promise<string | null | undefined> {
    let elegido: string | null | undefined;
    const s = await this.sheet.create({
      header,
      subHeader: 'Forma de pago',
      buttons: [
        ...metodos.map(m => ({ text: m.etiqueta, icon: ICONO_PAGO[m.valor] || 'wallet-outline', handler: () => { elegido = m.valor; } })),
        ...(permitirOmitir ? [{ text: 'No registrar el pago', icon: 'remove-circle-outline', handler: () => { elegido = null; } }] : []),
        { text: 'Cancelar', icon: 'close', role: 'cancel' },
      ],
    });
    await s.present();
    await s.onDidDismiss();
    return elegido;
  }

  // undefined = canceló; null = sin monto.
  private async pedirMonto(actual: number | string | null | undefined): Promise<number | null | undefined> {
    const previo = Number(actual || 0);
    const a = await this.alert.create({
      header: 'Monto cobrado',
      message: 'Opcional. Es lo que suman los reportes de ingresos.',
      inputs: [{ name: 'monto', type: 'number', min: 0, placeholder: '₡ 0', value: previo > 0 ? String(previo) : '' }],
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        { text: 'Entregar', role: 'confirm' },
      ],
    });
    await a.present();
    const { role, data } = await a.onDidDismiss();
    if (role !== 'confirm') return undefined;
    const v = data?.values?.monto;
    if (v === '' || v === null || v === undefined) return null;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : null;
  }

  private async aviso(message: string, color: string) {
    const t = await this.toast.create({ message, duration: 2600, color });
    await t.present();
  }
}
