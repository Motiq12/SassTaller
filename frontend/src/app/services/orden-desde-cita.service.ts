import { Injectable } from '@angular/core';
import { ActionSheetController, AlertController, ToastController } from '@ionic/angular';
import { firstValueFrom } from 'rxjs';
import { RecepcionService } from './recepcion.service';
import { VehiculosService } from './vehiculos.service';

// Abrir la orden de trabajo de una cita, con el mismo paso a paso en recepción
// (Inicio → citas de hoy) y en administración (Gestión de citas → Citas):
//
//   1. Si la cita es para otro día, pregunta antes (puede ser un error de dedo).
//   2. Si la cita se agendó sin moto, pide una: una de las motos del cliente o una
//      que se registra en el momento. Sin esto el servidor no podía abrir la orden.
//   3. Abre la orden (queda ligada a la cita; la cita pasa a "En revisión" y al
//      cliente le llega el aviso).
//
// Los errores del servidor los avisa ErrorInterceptor.

export interface CitaParaOrden {
  id: number;
  cliente_id: number;
  fecha?: string | null;
  vehiculo_id?: number | null;
  cliente_nombre?: string | null;
}
export interface OrdenCreada { orden_id: number; numero_orden: string; }

@Injectable({ providedIn: 'root' })
export class OrdenDesdeCitaService {
  constructor(
    private rec: RecepcionService,
    private motos: VehiculosService,
    private alert: AlertController,
    private sheet: ActionSheetController,
    private toast: ToastController,
  ) {}

  // La orden creada (o la que la cita ya tenía), o null si se canceló o falló.
  async crear(c: CitaParaOrden): Promise<OrdenCreada | null> {
    const fecha = String(c.fecha || '').slice(0, 10);
    if (fecha && fecha > this.hoy()) {
      const ok = await this.confirmar('La cita es para otro día',
        `Esta cita es para el ${fecha.slice(8, 10)}/${fecha.slice(5, 7)}. ¿Abrir la orden ya?`, 'Abrir la orden');
      if (!ok) return null;
    }
    let motoId = c.vehiculo_id || null;
    if (!motoId) {
      motoId = await this.elegirMoto(c.cliente_id, c.cliente_nombre || '');
      if (!motoId) return null;
    }
    try {
      const r = await firstValueFrom(this.rec.crearOrdenDesdeCita(c.id, motoId));
      await this.aviso(`Orden ${r.data.numero_orden} abierta`);
      return r.data;
    } catch {
      return null;
    }
  }

  // Fecha de hoy en la hora de este dispositivo (el del taller).
  private hoy(): string {
    const d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 10);
  }

  private async confirmar(header: string, message: string, si: string): Promise<boolean> {
    const a = await this.alert.create({
      header, message,
      buttons: [{ text: 'Cancelar', role: 'cancel' }, { text: si, role: 'confirm' }],
    });
    await a.present();
    const { role } = await a.onDidDismiss();
    return role === 'confirm';
  }

  // Una moto del cliente, o una nueva. null = canceló.
  private async elegirMoto(clienteId: number, nombre: string): Promise<number | null> {
    const motos = (await firstValueFrom(this.rec.getMotos(clienteId)).catch(() => ({ data: [] as any[] }))).data || [];
    let elegida: number | 'nueva' | null = null;
    const s = await this.sheet.create({
      header: 'La cita no tiene vehículo',
      subHeader: motos.length ? `Elegí el vehículo${nombre ? ' de ' + nombre : ''} para la orden` : 'Registrá el vehículo para abrir la orden',
      buttons: [
        ...motos.map((m: any) => ({
          text: `${m.marca} ${m.modelo}${m.placa ? ' · ' + m.placa : ''}`,
          icon: 'car-outline',
          handler: () => { elegida = m.id; },
        })),
        { text: 'Registrar vehículo nuevo', icon: 'add-circle-outline', handler: () => { elegida = 'nueva'; } },
        { text: 'Cancelar', icon: 'close', role: 'cancel' },
      ],
    });
    await s.present();
    await s.onDidDismiss();
    if (elegida === 'nueva') return this.registrarMoto(clienteId);
    return elegida;
  }

  private async registrarMoto(clienteId: number): Promise<number | null> {
    const a = await this.alert.create({
      header: 'Registrar vehículo',
      inputs: [
        { name: 'marca', placeholder: 'Marca * (Freedom, Hero, KYMCO…)' },
        { name: 'modelo', placeholder: 'Modelo *' },
        { name: 'placa', placeholder: 'Placa (opcional)' },
      ],
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Registrar',
          role: 'confirm',
          handler: (v: { marca?: string; modelo?: string }) => {
            if (!v.marca?.trim() || !v.modelo?.trim()) {
              this.aviso('Falta la marca o el modelo', 'warning');
              return false; // el cuadro se queda abierto
            }
            return true;
          },
        },
      ],
    });
    await a.present();
    const { role, data } = await a.onDidDismiss();
    if (role !== 'confirm') return null;
    const v = data?.values || {};
    try {
      const r = await firstValueFrom(this.motos.create({
        cliente_id: clienteId, marca: String(v.marca).trim(), modelo: String(v.modelo).trim(),
        placa: String(v.placa || '').trim() || null,
      }));
      return r.data.id ?? null;
    } catch {
      return null;
    }
  }

  private async aviso(message: string, color = 'success') {
    const t = await this.toast.create({ message, duration: 2000, color });
    await t.present();
  }
}
