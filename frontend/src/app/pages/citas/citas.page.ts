import { Component, OnInit, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { AlertController, ToastController } from '@ionic/angular';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { CitasService } from '../../services/citas.service';
import { DashboardService } from '../../services/dashboard.service';
import { AuthService } from '../../services/auth.service';
import { Cita } from '../../models/cita.model';
import { hoyCR, sumarDias } from '../../utils/fecha-cita';

@Component({ standalone: false,
  selector: 'app-citas',
  templateUrl: './citas.page.html',
  styleUrls: ['./citas.page.scss'],
})
export class CitasPage implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  citas: Cita[] = [];
  tecnicos: any[] = [];
  cargando = true;
  filtroEstado = '';
  fechaHoy = hoyCR();

  readonly estadoLabel: Record<string, string> = {
    agendado: 'Agendado',
    en_revision: 'En revisión',
    en_mantenimiento: 'En mantenimiento',
    listo: 'Listo',
    entregado: 'Entregado',
    cancelado: 'Cancelado',
  };
  readonly estadoColor: Record<string, string> = {
    agendado: 'primary',
    en_revision: 'warning',
    en_mantenimiento: 'tertiary',
    listo: 'secondary',
    entregado: 'success',
    cancelado: 'danger',
  };

  busqueda = '';

  constructor(
    private citaSvc: CitasService,
    private dashSvc: DashboardService,
    public auth: AuthService,
    private router: Router,
    private alert: AlertController,
    private toast: ToastController
  ) {}

  get esAdmin(): boolean { return this.auth.tieneRol('admin'); }

  get citasFiltradas(): Cita[] {
    if (!this.busqueda.trim()) return this.citas;
    const q = this.busqueda.trim().toLowerCase();
    return this.citas.filter(c =>
      `${c.cliente_nombre} ${c.cliente_apellido} ${c.placa} ${c.marca} ${c.modelo}`.toLowerCase().includes(q)
    );
  }

  get citasPorFecha(): { fecha: string; etiqueta: string; citas: Cita[] }[] {
    const map = new Map<string, Cita[]>();
    for (const c of this.citasFiltradas) {
      const f = (c.fecha || '').slice(0, 10);
      if (!map.has(f)) map.set(f, []);
      map.get(f)!.push(c);
    }
    return [...map.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([fecha, citas]) => ({ fecha, etiqueta: this.etiquetaFecha(fecha), citas }));
  }

  private etiquetaFecha(fecha: string): string {
    if (!fecha) return '';
    const hoy = hoyCR();
    const manana = sumarDias(hoy, 1);
    const ayer = sumarDias(hoy, -1);
    if (fecha === hoy) return 'Hoy';
    if (fecha === manana) return 'Mañana';
    if (fecha === ayer) return 'Ayer';
    const d = new Date(fecha + 'T12:00:00Z');
    return d.toLocaleDateString('es-CR', { weekday: 'long', day: 'numeric', month: 'long' });
  }

  formatHora(h: string): string {
    return h ? h.slice(0, 5) : '';
  }

  ngOnInit() { this.cargar(); }
  ngOnDestroy() { this.destroy$.next(); this.destroy$.complete(); }
  ionViewWillEnter() { this.cargar(); }

  cargar() {
    this.cargando = true;
    const params: any = {};
    if (this.filtroEstado) params.estado = this.filtroEstado;
    this.citaSvc.getAll(params).pipe(takeUntil(this.destroy$)).subscribe({
      next: res => { this.citas = res.data; this.cargando = false; },
      error: () => { this.cargando = false; },
    });
    // Lista de técnicos para asignar (solo admin puede).
    if (this.auth.tieneRol('admin') && !this.tecnicos.length) {
      this.dashSvc.getTecnicos().pipe(takeUntil(this.destroy$)).subscribe({ next: res => this.tecnicos = res.data });
    }
  }

  nuevaCita() { this.router.navigate(['/cita-form']); }
  editarCita(id: number) { this.router.navigate(['/cita-form', id]); }

  async cambiarEstado(cita: Cita, estado: string) {
    this.citaSvc.cambiarEstado(cita.id!, estado).pipe(takeUntil(this.destroy$)).subscribe({
      next: async () => {
        cita.estado = estado as any;
        const t = await this.toast.create({ message: 'Estado actualizado', duration: 1500, color: 'success' });
        await t.present();
      },
    });
  }

  // El admin asigna la cita a un técnico (radio con los técnicos activos).
  async asignarTecnico(cita: Cita) {
    if (!this.tecnicos.length) {
      const t = await this.toast.create({ message: 'No hay técnicos disponibles', duration: 2000, color: 'warning' });
      return await t.present();
    }
    const al = await this.alert.create({
      header: 'Asignar técnico',
      inputs: this.tecnicos.map(tc => ({
        type: 'radio' as const, label: tc.nombre, value: tc.id, checked: cita.tecnico_id === tc.id,
      })),
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        { text: 'Asignar', handler: (id) => this.guardarAsignacion(cita, id) },
      ],
    });
    await al.present();
  }

  private guardarAsignacion(cita: Cita, tecnicoId: number) {
    if (!tecnicoId) return;
    this.citaSvc.asignar(cita.id!, tecnicoId).pipe(takeUntil(this.destroy$)).subscribe({
      next: async () => {
        cita.tecnico_id = tecnicoId;
        cita.tecnico_nombre = this.tecnicos.find(t => t.id === tecnicoId)?.nombre;
        const t = await this.toast.create({ message: 'Técnico asignado', duration: 1500, color: 'success' });
        await t.present();
      },
    });
  }
}
