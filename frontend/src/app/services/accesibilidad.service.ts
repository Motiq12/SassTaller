import { Injectable } from '@angular/core';

export type Tema = 'auto' | 'claro' | 'oscuro';

// Preferencias de accesibilidad, guardadas en este dispositivo (localStorage) y
// aplicadas al arrancar:
//   - Tamaño de texto: un zoom global con la variable CSS --app-zoom (ver
//     global.scss). 3 niveles: Normal / Grande / Muy grande.
//   - Tema: Automático (sigue al dispositivo), Claro u Oscuro. Se aplica con una
//     clase en <html> (ver theme/variables.scss). index.html la pone antes de que
//     arranque Angular, con la misma clave, para que no parpadee.
@Injectable({ providedIn: 'root' })
export class AccesibilidadService {
  private readonly KEY = 'tallerms_text_scale';
  private readonly escalas = [1, 1.12, 1.25];
  private idx = 0;

  private readonly KEY_TEMA = 'tallerms_tema';
  readonly temas: { id: Tema; nombre: string }[] = [
    { id: 'auto', nombre: 'Automático' },
    { id: 'claro', nombre: 'Claro' },
    { id: 'oscuro', nombre: 'Oscuro' },
  ];
  private temaActual: Tema = 'auto';

  constructor() {
    const guardado = Number(localStorage.getItem(this.KEY));
    const i = this.escalas.indexOf(guardado);
    this.idx = i >= 0 ? i : 0;
    this.aplicar();

    const tema = localStorage.getItem(this.KEY_TEMA);
    this.temaActual = tema === 'claro' || tema === 'oscuro' ? tema : 'auto';
    this.aplicarTema();
  }

  get tema(): Tema { return this.temaActual; }
  /** Lo que se muestra debajo de "Tema": qué está eligiendo la persona. */
  get temaDetalle(): string {
    return this.temaActual === 'auto' ? 'Sigue el de este dispositivo' : this.temas.find(t => t.id === this.temaActual)!.nombre;
  }

  setTema(t: Tema) {
    this.temaActual = t;
    if (t === 'auto') localStorage.removeItem(this.KEY_TEMA);
    else localStorage.setItem(this.KEY_TEMA, t);
    this.aplicarTema();
  }

  private aplicarTema() {
    const clases = document.documentElement.classList;
    clases.toggle('tema-claro', this.temaActual === 'claro');
    clases.toggle('tema-oscuro', this.temaActual === 'oscuro');
  }

  /** Nivel actual: 0 = Normal, 1 = Grande, 2 = Muy grande. */
  get nivel(): number { return this.idx; }
  get niveles(): number { return this.escalas.length; }

  setNivel(i: number) {
    this.idx = Math.max(0, Math.min(this.escalas.length - 1, i));
    localStorage.setItem(this.KEY, String(this.escalas[this.idx]));
    this.aplicar();
  }

  private aplicar() {
    document.documentElement.style.setProperty('--app-zoom', String(this.escalas[this.idx]));
  }
}
