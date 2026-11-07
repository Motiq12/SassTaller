import { Location } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { AuthService } from '../../services/auth.service';
import { AccesibilidadService } from '../../services/accesibilidad.service';
import { MiPerfilService } from '../../services/mi-perfil.service';
import { INICIOS } from './mis-preferencias.component';

export interface FilaPerfil { id: string; nombre: string; icono: string; }
export interface GrupoPerfil { titulo: string; items: FilaPerfil[]; }

// Desde este ancho se ven la lista y la sección lado a lado.
const ESCRITORIO = '(min-width: 1200px)';

// Lo común de Mi perfil en los tres roles (panel, recepción y taller): qué sección
// está abierta (va en la dirección, ?ver=<id>), si se ve lado a lado, el estado que
// muestra cada fila y la barrita de la contraseña. Cada página pone sus grupos y lo
// suyo (datos, foto, contraseña contra su propia ruta).
export abstract class PerfilListaBase {
  protected destroy$ = new Subject<void>();
  abstract readonly grupos: GrupoPerfil[];
  abstract readonly rol: 'admin' | 'recepcion' | 'tecnico';

  seccion: string | null = null;
  escritorio = false;
  private mq?: MediaQueryList;
  private alCambiarAncho = (e: MediaQueryListEvent) => { this.escritorio = e.matches; };
  private desdeLista = false;

  // Estado de las filas.
  firmaGuardada: boolean | null = null;
  dosfaActiva: boolean | null = null;
  equipos: number | null = null;
  inicio: string | null = null;
  // Política de contraseñas (Configuración → Seguridad).
  minimo = 8;
  pideVariedad = false;

  readonly nivelesTexto = [
    { i: 0, etiqueta: 'A', nombre: 'Normal' },
    { i: 1, etiqueta: 'A', nombre: 'Grande' },
    { i: 2, etiqueta: 'A', nombre: 'Muy grande' },
  ];

  constructor(
    protected route: ActivatedRoute,
    protected router: Router,
    protected location: Location,
    protected miPerfil: MiPerfilService,
    protected auth: AuthService,
    public a11y: AccesibilidadService,
  ) {}

  protected iniciarLista() {
    this.mq = window.matchMedia(ESCRITORIO);
    this.escritorio = this.mq.matches;
    this.mq.addEventListener('change', this.alCambiarAncho);
    this.route.queryParamMap.pipe(takeUntil(this.destroy$)).subscribe(q => {
      const v = q.get('ver');
      this.seccion = v && this.ids.includes(v) ? v : null;
      this.cargarResumen();
    });
  }

  protected terminarLista() {
    this.mq?.removeEventListener('change', this.alCambiarAncho);
    this.destroy$.next();
    this.destroy$.complete();
  }

  private get ids(): string[] { return this.grupos.reduce((ids: string[], g) => ids.concat(g.items.map(i => i.id)), []); }

  // En escritorio, sin ninguna elegida se muestra la primera.
  get vista(): string | null { return this.seccion || (this.escritorio ? this.grupos[0].items[0].id : null); }

  abrir(id: string) {
    this.desdeLista = true;
    this.router.navigate([], { relativeTo: this.route, queryParams: { ver: id } });
  }

  // En el celular, volver a la lista. Si se llegó desde ella, es "atrás" de verdad.
  volverALista() {
    if (this.desdeLista) { this.desdeLista = false; this.location.back(); return; }
    this.router.navigate([], { relativeTo: this.route, queryParams: {}, replaceUrl: true });
  }

  // Se relee al cambiar de sección: lo de adentro pudo cambiar.
  protected cargarResumen() {
    this.miPerfil.get().pipe(takeUntil(this.destroy$)).subscribe({
      next: r => {
        this.firmaGuardada = !!r.data.firma;
        this.inicio = r.data.preferencias?.inicio || null;
        if (r.data.politica) { this.minimo = r.data.politica.minimo || 8; this.pideVariedad = !!r.data.politica.variedad; }
      },
      error: () => {},
    });
    this.auth.estado2FA().pipe(takeUntil(this.destroy$)).subscribe({ next: r => this.dosfaActiva = r.data.activado, error: () => {} });
    this.miPerfil.sesiones().pipe(takeUntil(this.destroy$)).subscribe({ next: r => this.equipos = r.data.sesiones.length, error: () => {} });
  }

  // Lo que se ve a la derecha de cada fila. Cada página puede agregar los suyos.
  valor(id: string): string {
    switch (id) {
      case 'foto': return this.fotoActual ? 'Puesta' : 'Sin foto';
      case 'firma': return this.firmaGuardada === null ? '' : this.firmaGuardada ? 'Guardada' : 'Sin firma';
      case 'dosfa': return this.dosfaActiva === null ? '' : this.dosfaActiva ? 'Activada' : 'Desactivada';
      case 'sesiones': return this.equipos === null ? '' : `${this.equipos} equipo${this.equipos === 1 ? '' : 's'}`;
      case 'apariencia': return this.a11y.temas.find(t => t.id === this.a11y.tema)?.nombre || '';
      case 'inicio': {
        const lista = INICIOS[this.rol];
        return lista.find(i => i.ruta === this.inicio)?.nombre || lista[0].nombre;
      }
      default: return '';
    }
  }

  // Todos los valores de una vez, para la lista.
  get valores(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const g of this.grupos) for (const i of g.items) out[i.id] = this.valor(i.id);
    return out;
  }

  get estados(): Record<string, string> {
    return { dosfa: this.dosfaActiva === null ? '' : this.dosfaActiva ? 'ok' : 'aviso' };
  }

  protected abstract get fotoActual(): string | null;

  iconoTema(id: string): string { return id === 'claro' ? 'sunny-outline' : id === 'oscuro' ? 'moon-outline' : 'contrast-outline'; }
  setTexto(i: number) { this.a11y.setNivel(i); }

  // Qué tan buena es una contraseña nueva: solo orienta; la que manda es la del servidor.
  fuerzaDe(p: string): { nivel: number; texto: string } {
    p = p || '';
    if (p.length < this.minimo) return { nivel: 1, texto: `Le faltan ${this.minimo - p.length} caracteres` };
    if (this.pideVariedad && !(/[a-záéíóúñ]/i.test(p) && /\d/.test(p))) return { nivel: 1, texto: 'Tiene que tener letras y números' };
    const variedad = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter(r => r.test(p)).length;
    if (p.length >= 14 || (p.length >= 10 && variedad >= 3)) return { nivel: 3, texto: 'Fuerte' };
    return { nivel: 2, texto: 'Aceptable: más larga es más segura' };
  }

  inicialesDe(nombre: string, porDefecto = 'A'): string {
    const p = (nombre || porDefecto).trim().split(/\s+/);
    return ((p[0]?.[0] || '') + (p[1]?.[0] || '')).toUpperCase() || porDefecto[0];
  }

  fechaDesde(iso: string | null | undefined): string {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('es-CR', { month: 'long', year: 'numeric' });
  }
}
