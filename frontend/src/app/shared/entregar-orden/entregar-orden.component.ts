import { Component, Input, OnInit } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { ModalController } from '@ionic/angular';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { OrdenChecklist, faltantesChecklist } from '../../models/orden.model';

// El cuadro para entregar una orden: el mismo desde la orden, desde Gestión de citas
// y desde el inicio de recepción (lo abre EntregaService.entregarOrden). Todo en un
// solo paso: total, forma de pago, garantía y observaciones, y avisa (sin impedir)
// si la orden no estaba marcada como lista o si al checklist le falta algo.
//
// Los datos de la orden los vuelve a pedir al abrir: la pantalla que lo abre puede
// tener el total o el estado viejos (o no tenerlos, como Gestión de citas).
// Cierra con role 'entregada' y { cortesia, abrirFactura } si se entregó.
@Component({
  standalone: false,
  selector: 'app-entregar-orden',
  templateUrl: './entregar-orden.component.html',
  styleUrls: ['./entregar-orden.component.scss'],
})
export class EntregarOrdenComponent implements OnInit {
  @Input() ordenId!: number;
  @Input() numeroOrden: string | null = null;
  @Input() total: number | null = null;
  @Input() estado: string | null = null;
  @Input() metodos: { valor: string; etiqueta: string }[] = [];
  @Input() garantiaDias = 30;

  metodo = '';
  observaciones = '';
  abrirFactura = true;
  moto = '';
  cliente = '';
  sinAprobar = 0;
  faltantes: string[] = [];
  enviando = false;
  // El servidor dijo que no estaba lista aunque al abrir sí lo estaba: alguien le
  // cambió el estado mientras tanto.
  cambioDeEstado = false;

  private api = environment.apiUrl;

  constructor(private http: HttpClient, private modalCtrl: ModalController) {}

  get noLista(): boolean { return !!this.estado && this.estado !== 'lista_entrega'; }

  ngOnInit() {
    this.metodo = this.metodos.find(m => m.valor === 'efectivo')?.valor || this.metodos[0]?.valor || '';
    this.cargar();
  }

  private async cargar() {
    try {
      const [o, ch] = await Promise.all([
        firstValueFrom(this.http.get<{ data: any }>(`${this.api}/ordenes/${this.ordenId}`)),
        firstValueFrom(this.http.get<{ data: OrdenChecklist | null }>(`${this.api}/ordenes/${this.ordenId}/checklist`)),
      ]);
      const d = o.data || {};
      this.numeroOrden = d.numero_orden || this.numeroOrden;
      this.total = Number(d.total) || 0;
      this.estado = d.estado || this.estado;
      this.sinAprobar = Number(d.monto_sin_aprobar) || 0;
      this.moto = [d.marca, d.modelo].filter(Boolean).join(' ');
      this.cliente = [d.cliente_nombre, d.cliente_apellido].filter(Boolean).join(' ');
      this.faltantes = faltantesChecklist(ch.data);
    } catch {
      // El ErrorInterceptor ya avisó; se puede entregar con lo que mandó la pantalla.
    }
  }

  cerrar() { this.modalCtrl.dismiss(null, 'cancel'); }

  async entregar() {
    if (this.enviando || !this.metodo) return;
    this.enviando = true;
    const garantia = Math.max(0, Math.round(Number(this.garantiaDias) || 0));
    try {
      const r = await firstValueFrom(this.http.post<any>(`${this.api}/recepcion/ordenes/${this.ordenId}/entregar`, {
        metodo_pago: this.metodo,
        garantia_dias: garantia,
        observaciones_finales: this.observaciones.trim() || null,
        forzar: this.noLista,
      }));
      await this.modalCtrl.dismiss({ cortesia: !!r?.cortesia_ganada, abrirFactura: this.abrirFactura }, 'entregada');
    } catch (e: any) {
      this.enviando = false;
      // No estaba lista (la cambiaron después de abrir el cuadro): se avisa acá mismo
      // y el siguiente toque la entrega igual. Los demás errores los muestra el
      // ErrorInterceptor.
      if (e?.status === 409 && e.error?.requiere_confirmacion) {
        this.estado = e.error.estado_actual || 'en_reparacion';
        this.cambioDeEstado = true;
      }
    }
  }
}
