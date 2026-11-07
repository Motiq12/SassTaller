import { Component, OnInit, OnDestroy } from '@angular/core';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { AdminService } from '../../services/admin.service';
import { UsuariosService } from '../../services/usuarios.service';
import { Usuario } from '../../models/usuario.model';
import { descargarCSV } from '../../shared/csv.util';
import { hoyCR } from '../../utils/fecha-cita';

@Component({
  standalone: false,
  selector: 'app-admin-reportes',
  templateUrl: './admin-reportes.page.html',
  styleUrls: ['./admin-reportes.page.scss'],
})
export class AdminReportesPage implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  data: any = null;
  cargando = true;
  periodo = 'mes';
  empleado: number | null = null;
  tecnicos: Usuario[] = [];

  readonly periodos = [
    { v: 'mes', l: 'Este mes' }, { v: 'mes_pasado', l: 'Mes pasado' }, { v: 'anio', l: 'Este año' },
  ];

  constructor(private admin: AdminService, private usuarios: UsuariosService) {}

  ngOnInit() {
    this.usuarios.getAll().pipe(takeUntil(this.destroy$)).subscribe({
      next: r => { this.tecnicos = (r.data || []).filter(u => u.rol === 'tecnico'); },
    });
    this.cargar();
  }
  ngOnDestroy() { this.destroy$.next(); this.destroy$.complete(); }
  ionViewWillEnter() { this.cargar(); }

  cargar(ev?: any) {
    this.cargando = true;
    this.admin.getReportes({ periodo: this.periodo, empleado: this.empleado }).pipe(takeUntil(this.destroy$)).subscribe({
      next: r => { this.data = r.data; this.cargando = false; if (ev) ev.target.complete(); },
      error: () => { this.cargando = false; if (ev) ev.target.complete(); },
    });
  }

  setPeriodo(v: string) { this.periodo = v; this.cargar(); }

  // Escala del gráfico de barras (máximo de citas en la serie).
  get maxSerie(): number {
    return Math.max(1, ...(this.data?.serie || []).map((s: any) => Number(s.citas)));
  }
  get totalIngresoServicio(): number {
    return (this.data?.ingresos_por_servicio || []).reduce((a: number, r: any) => a + Number(r.ingreso || 0), 0);
  }

  pct(parte: any, total: any): number {
    const t = Number(total) || 0;
    return t ? Math.round((Number(parte) / t) * 100) : 0;
  }
  tasa(r: any): number {
    const cerr = Number(r.entregadas) + Number(r.canceladas);
    return cerr ? Math.round((Number(r.entregadas) / cerr) * 100) : 0;
  }
  // Muestra etiquetas espaciadas en vistas por día (1 y múltiplos de 5); todas por mes.
  verLabel(i: number): boolean {
    return this.periodo === 'anio' || i === 0 || (i + 1) % 5 === 0;
  }
  tiempoFmt(min: any): string {
    const m = Math.round(Number(min) || 0);
    if (!m) return '—';
    if (m < 60) return `${m} min`;
    return `${Math.floor(m / 60)}h ${m % 60}m`;
  }
  calFmt(c: any): string {
    const n = Number(c) || 0;
    return n ? `${n.toFixed(1)} ★` : '—';
  }

  exportar() {
    if (!this.data?.rendimiento?.length) return;
    descargarCSV(`rendimiento_${this.periodo}_${hoyCR()}`, [
      { key: 'nombre', label: 'Mecánico' }, { key: 'citas', label: 'Citas' },
      { key: 'entregadas', label: 'Entregadas' }, { key: 'canceladas', label: 'Canceladas' },
      { key: 'tasa', label: 'Tasa éxito %' }, { key: 'ingresos', label: 'Ingresos' },
      { key: 'tiempo', label: 'Tiempo prom.' }, { key: 'calificacion', label: 'Calificación' },
    ], this.data.rendimiento.map((r: any) => ({
      nombre: r.nombre,
      citas: r.citas,
      entregadas: r.entregadas,
      canceladas: r.canceladas,
      tasa: this.tasa(r),
      ingresos: Number(r.ingresos || 0),
      tiempo: this.tiempoFmt(r.tiempo_prom_min),
      calificacion: r.calificacion ? Number(r.calificacion).toFixed(1) : '',
    })));
  }
}
