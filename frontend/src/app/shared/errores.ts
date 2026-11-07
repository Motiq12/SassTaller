// Cómo se avisa un error del servidor, en todo el sistema (panel, mostrador, taller y
// portal). Lo usa ErrorInterceptor, que es el ÚNICO que muestra el aviso de un error
// del servidor; ver también AvisosSinRepetir (shared/avisos-sin-repetir.ts).
import { HttpErrorResponse } from '@angular/common/http';

// Cuándo se mostró el último aviso de error del servidor. Las pantallas suelen poner
// su propio aviso genérico ("No se pudo guardar") justo después del específico, y lo
// tapaban: durante este rato, los avisos de error de las pantallas no se muestran.
export const VENTANA_SIN_REPETIR_MS = 2500;
let ultimoAvisoServidor = 0;
export function registrarAvisoServidor() { ultimoAvisoServidor = Date.now(); }
export function hayAvisoReciente(): boolean { return Date.now() - ultimoAvisoServidor < VENTANA_SIN_REPETIR_MS; }

// El mensaje corto de un error: el que manda el servidor (ya dice qué pasó), o uno
// según el tipo de falla cuando no manda ninguno.
export function mensajeDeError(err: HttpErrorResponse): string {
  if (err.status === 0) return 'Sin conexión con el servidor. ¿Hay internet?';
  const delServidor = typeof err.error?.error === 'string' ? err.error.error.trim() : '';
  if (delServidor) return delServidor;
  if (err.status === 403) return 'Sin permiso para esto.';
  if (err.status === 404) return 'No se encontró: puede que ya no exista.';
  if (err.status === 413) return 'El archivo es demasiado pesado.';
  if (err.status === 429) return 'Demasiados intentos seguidos: hay que esperar un momento.';
  if (err.status >= 500) return 'Falló el servidor.';
  return `No se pudo completar (error ${err.status}).`;
}

// Baja hasta el campo del formulario con el problema, lo marca en rojo y pone el
// mensaje debajo. El campo se busca por su atributo `name`, o `data-campo` para lo que
// no es un campo de texto (como la grilla de horas del portal): el mismo nombre que
// manda el servidor en `campo`. Solo entre lo que se ve en pantalla: si hay un modal
// abierto, el del modal. La marca se va sola cuando la persona corrige el campo.
export function marcarCampo(campo: string, mensaje: string) {
  if (!campo || typeof document === 'undefined') return;
  // Espera a que la pantalla termine de dibujar (p. ej. un formulario que recién se abrió).
  setTimeout(() => {
    const escapado = (window as any).CSS?.escape ? CSS.escape(campo) : campo.replace(/"/g, '');
    const visibles = Array.from(document.querySelectorAll<HTMLElement>(`[name="${escapado}"]:not(ion-icon), [data-campo="${escapado}"]`))
      .filter(el => el.offsetParent !== null || el.getClientRects().length > 0);
    const el = visibles[visibles.length - 1];
    if (!el) return;
    const caja = (el.closest('.fg, ion-item, .ig, .campo') as HTMLElement) || el;
    caja.querySelectorAll(':scope > .campo-error-msg').forEach(n => n.remove());
    caja.classList.add('campo-error');
    const nota = document.createElement('div');
    nota.className = 'campo-error-msg';
    nota.setAttribute('role', 'alert');
    nota.textContent = mensaje;
    caja.appendChild(nota);
    caja.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const control = el.matches('input, select, textarea') ? el : el.querySelector<HTMLElement>('input, select, textarea');
    (control || el).focus?.({ preventScroll: true });
    const quitar = () => {
      caja.classList.remove('campo-error');
      nota.remove();
      el.removeEventListener('input', quitar);
      el.removeEventListener('change', quitar);
      el.removeEventListener('ionInput', quitar);
      el.removeEventListener('ionChange', quitar);
    };
    for (const ev of ['input', 'change', 'ionInput', 'ionChange']) el.addEventListener(ev, quitar);
  }, 60);
}
