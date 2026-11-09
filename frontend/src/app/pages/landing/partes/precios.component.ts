import { Component, EventEmitter, OnInit, Output, inject } from '@angular/core';
import { LimitesPlan, PlanesPublicos, TallerService } from '../../../services/taller.service';
import { crc } from './datos';

type Clave = 'trial' | 'gratis' | 'pro';

interface Columna {
  clave: Clave;
  nombre: string;
  precio: string;
  plazo: string;
  accion: string;
  destino: 'registro' | 'contacto';
}

interface Fila { rasgo: string; valores: Record<Clave, string>; }

/**
 * Planes, comparados lado a lado, y qué pasa a los 30 días dicho sin letra chica.
 *
 * Los topes NO se escriben acá: se leen de /api/onboarding/planes, que expone lo que
 * aplica backend/src/utils/limites.js (y lo que haya editado el panel de Motiq). Si
 * el pedido falla, se muestran los valores de fábrica de ese mismo archivo.
 */
@Component({
  selector: 'app-lp-precios',
  templateUrl: './precios.component.html',
  styleUrls: ['./precios.component.scss'],
  standalone: false,
})
export class PreciosComponent implements OnInit {
  private taller = inject(TallerService);
  @Output() hablar = new EventEmitter<void>();

  planes: PlanesPublicos = FABRICA;
  columnas: Columna[] = [];
  filas: Fila[] = [];

  ngOnInit() {
    this.armar();
    this.taller.planes().subscribe({
      next: (r) => { this.planes = r.data; this.armar(); },
      error: () => { /* quedan los valores de fábrica */ },
    });
  }

  private armar() {
    const p = this.planes;
    const pro = p.pro.precio_mensual;
    this.columnas = [
      { clave: 'trial', nombre: 'Prueba', precio: '₡0', plazo: `${p.dias_prueba} días, con todo`, accion: 'Empezar la prueba', destino: 'registro' },
      { clave: 'gratis', nombre: 'Gratis', precio: '₡0', plazo: 'para siempre', accion: 'Crear mi taller', destino: 'registro' },
      { clave: 'pro', nombre: 'Pro', precio: pro ? crc(pro) : 'A convenir', plazo: pro ? 'por mes' : 'según tu taller', accion: 'Hablemos del plan Pro', destino: 'contacto' },
    ];
    const cada = (f: (l: LimitesPlan, c: Clave) => string): Record<Clave, string> =>
      ({ trial: f(p.trial, 'trial'), gratis: f(p.gratis, 'gratis'), pro: f(p.pro, 'pro') });
    const tope = (n: number | null) => (n == null ? 'Sin límite' : String(n));
    this.filas = [
      { rasgo: 'Órdenes, clientes, vehículos y citas', valores: cada(() => 'Sin límite') },
      { rasgo: 'Portal de clientes', valores: cada(() => 'Incluido') },
      { rasgo: 'Usuarios del taller', valores: cada((l) => tope(l.usuarios)) },
      { rasgo: 'Sucursales', valores: cada((l) => tope(l.sucursales)) },
      { rasgo: 'Tu logo y tus colores en el portal', valores: cada((l) => (l.marca_propia ? 'Sí' : 'No')) },
      { rasgo: 'Reportes', valores: cada((l) => (l.reportes_dias == null ? 'Historial completo' : `Últimos ${l.reportes_dias} días`)) },
      { rasgo: 'Soporte', valores: cada((_, c) => (c === 'pro' ? 'Directo, y migración de tus datos' : 'Por el formulario de contacto')) },
    ];
  }

  /** "2 usuarios o 1 sucursal", con los topes vigentes del plan Gratis. */
  get topesGratis(): string {
    const g = this.planes.gratis;
    const partes: string[] = [];
    if (g.usuarios != null) partes.push(`${g.usuarios} ${g.usuarios === 1 ? 'usuario' : 'usuarios'}`);
    if (g.sucursales != null) partes.push(`${g.sucursales} ${g.sucursales === 1 ? 'sucursal' : 'sucursales'}`);
    return partes.join(' o ');
  }
}

/** Valores de fábrica de backend/src/utils/limites.js, por si el pedido falla. */
const FABRICA: PlanesPublicos = {
  dias_prueba: 30,
  trial:  { usuarios: null, sucursales: null, marca_propia: true,  reportes_dias: null, precio_mensual: null },
  gratis: { usuarios: 2,    sucursales: 1,    marca_propia: false, reportes_dias: 30,   precio_mensual: null },
  pro:    { usuarios: null, sucursales: null, marca_propia: true,  reportes_dias: null, precio_mensual: null },
};
