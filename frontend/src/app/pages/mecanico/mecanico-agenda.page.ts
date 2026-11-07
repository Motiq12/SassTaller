import { Component, OnDestroy, OnInit } from '@angular/core';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { MecanicoService } from '../../services/mecanico.service';
import { hoyCR } from '../../utils/fecha-cita';

interface DiaCal {
  fecha: string;
  dia: number | null;
  hoy: boolean;
  total: number;
  agendadas: number;
  enProceso: number;
  completadas: number;
  flujo: '' | 'agendado' | 'proceso' | 'completo';
}

@Component({
  standalone: false,
  selector: 'app-mecanico-agenda',
  templateUrl: './mecanico-agenda.page.html',
  styleUrls: ['./mecanico-agenda.page.scss'],
})
export class MecanicoAgendaPage implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  readonly dows = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
  readonly meses = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  readonly diasLargos = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

  readonly estadoLabel: Record<string, string> = {
    agendado: 'Agendado', en_revision: 'En revisión', en_mantenimiento: 'En mantenimiento',
    listo: 'Listo', entregado: 'Entregado', cancelado: 'Cancelado',
  };
  readonly estadoPill: Record<string, string> = {
    agendado: 'indigo', en_revision: 'amber', en_mantenimiento: 'rose',
    listo: 'green', entregado: 'gris', cancelado: 'gris',
  };

  anio = new Date().getFullYear();
  mes = new Date().getMonth() + 1;
  cargando = true;

  citasMes: any[] = [];
  semanas: DiaCal[][] = [];
  diaSel: DiaCal | null = null;

  constructor(private mecanico: MecanicoService) {}

  ngOnInit() { this.cargar(); }
  ionViewWillEnter() { this.cargar(); }
  ngOnDestroy() { this.destroy$.next(); this.destroy$.complete(); }

  get tituloMes(): string { return `${this.meses[this.mes - 1]} ${this.anio}`; }

  get resumenMes(): { agendadas: number; enProceso: number; completadas: number } {
    let agendadas = 0, enProceso = 0, completadas = 0;
    for (const c of this.citasMes) {
      if (c.estado === 'agendado') agendadas++;
      else if (c.estado === 'entregado') completadas++;
      else if (c.estado !== 'cancelado') enProceso++;
    }
    return { agendadas, enProceso, completadas };
  }

  cambiarMes(dir: number) {
    if (dir === 0) {
      this.anio = new Date().getFullYear();
      this.mes = new Date().getMonth() + 1;
    } else {
      this.mes += dir;
      if (this.mes > 12) { this.mes = 1; this.anio++; }
      if (this.mes < 1) { this.mes = 12; this.anio--; }
    }
    this.cargar();
  }

  private pad(n: number): string { return String(n).padStart(2, '0'); }

  cargar(ev?: any) {
    this.cargando = true;
    const finDia = new Date(Date.UTC(this.anio, this.mes, 0)).getUTCDate();
    const desde = `${this.anio}-${this.pad(this.mes)}-01`;
    const hasta = `${this.anio}-${this.pad(this.mes)}-${this.pad(finDia)}`;
    this.mecanico.getAgenda(desde, hasta).pipe(takeUntil(this.destroy$)).subscribe({
      next: r => {
        this.citasMes = r.data || [];
        this.construir();
        this.cargando = false;
        if (ev) ev.target.complete();
      },
      error: () => { this.citasMes = []; this.semanas = []; this.cargando = false; if (ev) ev.target.complete(); },
    });
  }

  private construir() {
    const porDia = new Map<string, { total: number; agendadas: number; enProceso: number; completadas: number }>();
    for (const c of this.citasMes) {
      const f = c.fecha;
      if (!porDia.has(f)) porDia.set(f, { total: 0, agendadas: 0, enProceso: 0, completadas: 0 });
      const d = porDia.get(f)!;
      d.total++;
      if (c.estado === 'agendado') d.agendadas++;
      else if (c.estado === 'entregado') d.completadas++;
      else if (c.estado !== 'cancelado') d.enProceso++;
    }

    const hoyStr = hoyCR();
    const primerDow = new Date(Date.UTC(this.anio, this.mes - 1, 1)).getUTCDay();
    const offset = primerDow === 0 ? 6 : primerDow - 1;
    const diasMes = new Date(Date.UTC(this.anio, this.mes, 0)).getUTCDate();

    const vacio = (): DiaCal => ({ fecha: '', dia: null, hoy: false, total: 0, agendadas: 0, enProceso: 0, completadas: 0, flujo: '' });
    const dias: DiaCal[] = [];
    for (let i = 0; i < offset; i++) dias.push(vacio());

    let diaHoy: DiaCal | null = null;
    let primerConCitas: DiaCal | null = null;
    for (let d = 1; d <= diasMes; d++) {
      const fecha = `${this.anio}-${this.pad(this.mes)}-${this.pad(d)}`;
      const info = porDia.get(fecha) || { total: 0, agendadas: 0, enProceso: 0, completadas: 0 };
      let flujo: DiaCal['flujo'] = '';
      if (info.total > 0) {
        if (info.enProceso > 0) flujo = 'proceso';
        else if (info.agendadas > 0) flujo = 'agendado';
        else flujo = 'completo';
      }
      const cel: DiaCal = { fecha, dia: d, hoy: fecha === hoyStr, ...info, flujo };
      if (cel.hoy) diaHoy = cel;
      if (info.total > 0 && !primerConCitas) primerConCitas = cel;
      dias.push(cel);
    }
    while (dias.length % 7 !== 0) dias.push(vacio());

    this.semanas = [];
    for (let i = 0; i < dias.length; i += 7) this.semanas.push(dias.slice(i, i + 7));

    const prev = this.diaSel?.fecha;
    this.diaSel = (prev && dias.find(c => c.fecha === prev)) || diaHoy || primerConCitas || dias.find(c => c.dia) || null;
  }

  selDia(c: DiaCal) { if (c.dia) this.diaSel = c; }

  get citasDia(): any[] {
    if (!this.diaSel) return [];
    return this.citasMes.filter(c => c.fecha === this.diaSel!.fecha);
  }

  get esPasado(): boolean {
    if (!this.diaSel?.fecha) return false;
    return this.diaSel.fecha < hoyCR();
  }

  detalleTitulo(): string {
    if (!this.diaSel?.dia) return '';
    const d = new Date(Date.UTC(this.anio, this.mes - 1, this.diaSel.dia));
    return `${this.diasLargos[d.getUTCDay()]} ${this.diaSel.dia} de ${this.meses[this.mes - 1]}`;
  }
}
