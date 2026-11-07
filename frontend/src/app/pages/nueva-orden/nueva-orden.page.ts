import { Component, OnInit, OnDestroy } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { enPanel, rutaPanel } from '../../shared/ruta-panel';
import { AlertController, LoadingController, ToastController } from '@ionic/angular';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { ClientesService } from '../../services/clientes.service';
import { MotosService } from '../../services/motos.service';
import { OrdenesService } from '../../services/ordenes.service';
import { AuthService } from '../../services/auth.service';
import { Cliente } from '../../models/cliente.model';
import { Moto } from '../../models/moto.model';

@Component({ standalone: false,
  selector: 'app-nueva-orden',
  templateUrl: './nueva-orden.page.html',
  styleUrls: ['./nueva-orden.page.scss'],
})
export class NuevaOrdenPage implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  paso = 1; // 1=cliente, 2=moto, 3=recepcion

  // Paso 1
  busquedaCliente = '';
  clientes: Cliente[] = [];
  clienteSeleccionado: Cliente | null = null;

  // Paso 2
  motos: Moto[] = [];
  motoSeleccionada: Moto | null = null;

  // Paso 3
  form = {
    problema_reportado: '',
    kilometraje_ingreso: null as number | null,
    nivel_combustible: 'cuarto',
    accesorios_entregados: '',
    estado_fisico: '',
    prioridad: 'normal',
    categoria: 'diagnostico',
    fecha_estimada_entrega: '',
  };

  constructor(
    private clienteSvc: ClientesService,
    private motoSvc: MotosService,
    private ordenSvc: OrdenesService,
    private router: Router,
    private route: ActivatedRoute,
    private loading: LoadingController,
    private toast: ToastController,
    private alert: AlertController,
    private auth: AuthService,
  ) {}

  // Desde la ficha de una moto se llega con ?cliente_id=…&moto_id=…: el cliente y la
  // moto quedan elegidos y se pasa directo a describir el problema.
  ngOnInit() {
    const q = this.route.snapshot.queryParamMap;
    const clienteId = Number(q.get('cliente_id'));
    if (!clienteId) return;
    const motoId = Number(q.get('moto_id')) || null;
    this.clienteSvc.getById(clienteId).pipe(takeUntil(this.destroy$)).subscribe({
      next: res => this.seleccionarCliente(res.data, motoId),
      error: () => {},
    });
  }
  ngOnDestroy() { clearTimeout(this.espera); this.destroy$.next(); this.destroy$.complete(); }

  readonly niveles = [
    { valor: 'vacio', label: 'Vacío' }, { valor: 'cuarto', label: '1/4' }, { valor: 'mitad', label: '1/2' },
    { valor: 'tres_cuartos', label: '3/4' }, { valor: 'lleno', label: 'Lleno' },
  ];
  readonly prioridades = [
    { valor: 'normal', label: 'Normal' }, { valor: 'urgente', label: 'Urgente' },
    { valor: 'emergencia', label: 'Emergencia' }, { valor: 'garantia', label: 'Garantía' },
  ];

  // Espera a que se deje de escribir antes de buscar (lo que hacía el debounce del ion-searchbar).
  private espera?: ReturnType<typeof setTimeout>;
  buscarConEspera() {
    clearTimeout(this.espera);
    this.espera = setTimeout(() => this.buscarClientes(), 400);
  }

  buscarClientes() {
    if (!this.busquedaCliente.trim()) { this.clientes = []; return; }
    this.clienteSvc.getAll(this.busquedaCliente).pipe(takeUntil(this.destroy$)).subscribe(res => this.clientes = res.data);
  }

  seleccionarCliente(c: Cliente, motoId: number | null = null) {
    this.clienteSeleccionado = c;
    this.clientes = [];
    this.busquedaCliente = `${c.nombre} ${c.apellido}`;
    this.motoSvc.getAll({ cliente_id: c.id }).pipe(takeUntil(this.destroy$)).subscribe(res => {
      this.motos = res.data;
      const m = motoId ? this.motos.find(x => x.id === motoId) : null;
      if (m) this.seleccionarMoto(m);
    });
    this.paso = 2;
  }

  seleccionarMoto(m: Moto) {
    this.motoSeleccionada = m;
    this.paso = 3;
  }

  async guardar() {
    if (!this.form.problema_reportado.trim()) {
      const a = await this.alert.create({ header: 'Error', message: 'Ingrese el problema reportado', buttons: ['OK'] });
      return a.present();
    }
    const l = await this.loading.create({ message: 'Creando orden...' });
    await l.present();
    this.ordenSvc.create({
      moto_id: this.motoSeleccionada!.id!,
      cliente_id: this.clienteSeleccionado!.id!,
      ...this.form,
    }).pipe(takeUntil(this.destroy$)).subscribe({
      next: async (res) => {
        await l.dismiss();
        const t = await this.toast.create({ message: `Orden ${res.data.numero_orden} creada`, duration: 2500, color: 'success' });
        await t.present();
        this.router.navigate([rutaPanel(this.router, '/detalle-orden'), res.data.id], { replaceUrl: true });
      },
      error: async (err) => {
        await l.dismiss();
        const a = await this.alert.create({ header: 'Error', message: err.error?.error || 'Error al crear la orden', buttons: ['OK'] });
        await a.present();
      },
    });
  }

  volver() { this.router.navigate([this.listaOrdenes]); }

  // A dónde vuelve la flecha si no hay historial: la lista de órdenes de cada rol (antes,
  // fuera del panel, iba a /tabs/ordenes, la pantalla vieja).
  get listaOrdenes(): string {
    if (enPanel(this.router)) return '/admin/citas';
    const rol = this.auth.getUsuario()?.rol;
    return rol === 'recepcion' ? '/recepcion/ordenes' : rol === 'tecnico' ? '/mecanico/inicio' : '/admin/citas';
  }
  // Formularios de cliente y moto: dentro del panel si se viene de ahí.
  ruta(r: string): string { return rutaPanel(this.router, r); }
  pasoAnterior() { if (this.paso > 1) this.paso--; }
  // Los pasos de arriba: se vuelve a uno ya hecho, pero no se salta uno sin completar.
  irAPaso(p: number) {
    if (p === 2 && !this.clienteSeleccionado) return;
    if (p === 3 && !this.motoSeleccionada) return;
    this.paso = p;
  }
}
