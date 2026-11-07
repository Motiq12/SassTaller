import { Component, OnInit, OnDestroy } from '@angular/core';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { AdminService } from '../../services/admin.service';

// bg: el tinte; fg: el texto sobre el tinte (cambia con el tema); solido: el fondo de
// la bolita de iniciales y de la leyenda, con texto blanco encima (oscuro siempre).
interface Color { bg: string; fg: string; solido: string; }
interface MecDia { tecnico_id: number | null; nombre: string; iniciales: string; n: number; color: Color; }
interface DiaCal {
  dia: number | null;
  hoy: boolean;
  mecanicos: MecDia[];
  total: number;
  flujo: '' | 'bajo' | 'medio' | 'alto';
}

@Component({
  standalone: false,
  selector: 'app-admin-calendario',
  templateUrl: './admin-calendario.page.html',
  styleUrls: ['./admin-calendario.page.scss'],
})
export class AdminCalendarioPage implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  // Paleta de colores asignada por mecánico (cicla si hay más que colores).
  private readonly PALETA: Color[] = [
    // El texto usa el tono de cada color según el tema (variables --cal-*): los tonos
    // medios de antes daban 3,2 a 3,8:1 sobre su propio tinte.
    { bg: 'rgba(226, 35, 26, .15)', fg: 'var(--cal-1)', solido: '#c2201a' },
    { bg: 'rgba(99, 102, 241, .15)', fg: 'var(--cal-2)', solido: '#4f46e5' },
    { bg: 'rgba(16, 185, 129, .15)', fg: 'var(--cal-3)', solido: '#047857' },
    { bg: 'rgba(245, 158, 11, .15)', fg: 'var(--cal-4)', solido: '#b45309' },
    { bg: 'rgba(56, 189, 248, .15)', fg: 'var(--cal-5)', solido: '#0369a1' },
    { bg: 'rgba(168, 85, 247, .15)', fg: 'var(--cal-6)', solido: '#7e22ce' },
  ];
  private readonly NEUTRO: Color = { bg: 'rgba(163, 163, 163, .1)', fg: 'var(--cal-n)', solido: '#525252' };
  readonly dows = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
  readonly meses = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

  anio = new Date().getFullYear();
  mes = new Date().getMonth() + 1; // 1-12
  cargando = true;

  semanas: DiaCal[][] = [];
  leyenda: MecDia[] = [];
  resumenMes: MecDia[] = [];
  totalMes = 0;
  diaSel: DiaCal | null = null;

  private colorPorTec = new Map<number, Color>();

  constructor(private admin: AdminService) {}

  ngOnInit() { this.cargar(); }
  ngOnDestroy() { this.destroy$.next(); this.destroy$.complete(); }
  ionViewWillEnter() { this.cargar(); }

  get tituloMes(): string { return `${this.meses[this.mes - 1]} ${this.anio}`; }

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

  cargar() {
    this.cargando = true;
    this.admin.getCalendario(this.anio, this.mes).pipe(takeUntil(this.destroy$)).subscribe({
      next: r => { this.procesar(r.data.celdas || [], r.data.tecnicos || []); this.cargando = false; },
      error: () => { this.cargando = false; this.semanas = []; this.leyenda = []; this.resumenMes = []; },
    });
  }

  private iniciales(nombre: string): string {
    return (nombre || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0].toUpperCase()).join('') || '?';
  }

  private procesar(celdas: any[], tecnicos: any[]) {
    // Mapa de color por técnico: técnicos activos primero, luego cualquier id presente en las citas.
    this.colorPorTec = new Map();
    const ids: number[] = [];
    for (const t of tecnicos) if (!ids.includes(t.id)) ids.push(t.id);
    for (const c of celdas) if (c.tecnico_id != null && !ids.includes(c.tecnico_id)) ids.push(c.tecnico_id);
    ids.forEach((id, i) => this.colorPorTec.set(id, this.PALETA[i % this.PALETA.length]));

    // Citas por día.
    const porDia = new Map<number, MecDia[]>();
    const totalPorTec = new Map<string, MecDia>();
    let hayNull = false;
    for (const c of celdas) {
      const nombre = c.tecnico_nombre || 'Sin asignar';
      const color = c.tecnico_id != null ? (this.colorPorTec.get(c.tecnico_id) || this.NEUTRO) : this.NEUTRO;
      if (c.tecnico_id == null) hayNull = true;
      const md: MecDia = { tecnico_id: c.tecnico_id, nombre, iniciales: this.iniciales(nombre), n: Number(c.n), color };
      if (!porDia.has(c.dia)) porDia.set(c.dia, []);
      porDia.get(c.dia)!.push(md);
      // Acumulado del mes por técnico.
      const key = String(c.tecnico_id);
      if (!totalPorTec.has(key)) totalPorTec.set(key, { ...md, n: 0 });
      totalPorTec.get(key)!.n += Number(c.n);
    }

    // Leyenda: técnicos activos + "Sin asignar" si corresponde.
    this.leyenda = tecnicos.map(t => ({
      tecnico_id: t.id, nombre: t.nombre, iniciales: this.iniciales(t.nombre),
      n: 0, color: this.colorPorTec.get(t.id) || this.NEUTRO,
    }));
    if (hayNull) this.leyenda.push({ tecnico_id: null, nombre: 'Sin asignar', iniciales: '—', n: 0, color: this.NEUTRO });

    // Resumen del mes (por técnico, desc).
    this.resumenMes = [...totalPorTec.values()].sort((a, b) => b.n - a.n);
    this.totalMes = this.resumenMes.reduce((s, m) => s + m.n, 0);

    this.construirSemanas(porDia);
  }

  private construirSemanas(porDia: Map<number, MecDia[]>) {
    const hoy = new Date();
    const esMesActual = hoy.getFullYear() === this.anio && hoy.getMonth() + 1 === this.mes;
    const primerDow = new Date(Date.UTC(this.anio, this.mes - 1, 1)).getUTCDay(); // 0=Dom
    const offset = primerDow === 0 ? 6 : primerDow - 1; // arranca lunes
    const diasMes = new Date(Date.UTC(this.anio, this.mes, 0)).getUTCDate();

    const vacio = (): DiaCal => ({ dia: null, hoy: false, mecanicos: [], total: 0, flujo: '' });
    const dias: DiaCal[] = [];
    for (let i = 0; i < offset; i++) dias.push(vacio());

    let diaHoy: DiaCal | null = null;
    for (let d = 1; d <= diasMes; d++) {
      const mecanicos = porDia.get(d) || [];
      const total = mecanicos.reduce((s, m) => s + m.n, 0);
      const flujo = total === 0 ? '' : total <= 2 ? 'bajo' : total <= 5 ? 'medio' : 'alto';
      const cel: DiaCal = { dia: d, hoy: esMesActual && d === hoy.getDate(), mecanicos, total, flujo };
      if (cel.hoy) diaHoy = cel;
      dias.push(cel);
    }
    while (dias.length % 7 !== 0) dias.push(vacio());

    this.semanas = [];
    for (let i = 0; i < dias.length; i += 7) this.semanas.push(dias.slice(i, i + 7));

    // Selección inicial: hoy si está en el mes; si no, el primer día con citas.
    this.diaSel = diaHoy || dias.find(c => c.dia && c.total > 0) || dias.find(c => c.dia) || null;
  }

  selDia(c: DiaCal) { if (c.dia) this.diaSel = c; }

  detalleTitulo(): string {
    if (!this.diaSel || !this.diaSel.dia) return '';
    return `${this.diaSel.dia} de ${this.meses[this.mes - 1]}`;
  }
}
