import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { AlertController } from '@ionic/angular';
import { Subject, debounceTime, distinctUntilChanged } from 'rxjs';
import { MotiqService, ResumenPlataforma, TallerDelPanel } from '../../../services/motiq.service';
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

  filtroEstado = '';
  busqueda = '';
  private escribiendo$ = new Subject<string>();

  readonly PLANES = ['trial', 'basico', 'pro', 'enterprise'];

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
    this.cargarTalleres(ev);
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
