// Cloudflare Turnstile (captcha anti-bot invisible) para los formularios públicos.
// Degradación segura: si el servidor no entrega clave pública (/onboarding/captcha)
// o estamos en la app nativa, NO se carga nada y los formularios funcionan igual que
// siempre — el token viaja vacío y el backend (que también degrada sin secret) lo omite.

import { Capacitor } from '@capacitor/core';
import { environment } from '../../environments/environment';

let SITE_KEY = '';
let clavePromise: Promise<string> | null = null;

// La clave la da el servidor, para poder activar el captcha desde Railway sin recompilar.
// Se pide recién cuando un formulario la necesita, y una sola vez: antes se esperaba al
// arrancar la app, y eso frenaba el primer pintado de todas las páginas, la landing
// incluida, aunque no tuvieran captcha.
// Va con fetch y no con HttpClient: un fallo acá no debe mostrarle un aviso rojo a nadie.
function claveCaptcha(): Promise<string> {
  if (clavePromise) return clavePromise;
  clavePromise = (async () => {
    if (Capacitor.isNativePlatform()) return '';
    const control = new AbortController();
    const corte = setTimeout(() => control.abort(), 4000);
    try {
      const r = await fetch(`${environment.apiUrl}/onboarding/captcha`, { signal: control.signal });
      if (r.ok) SITE_KEY = (await r.json())?.data?.siteKey || '';
    } catch { /* sin clave: los formularios siguen sin captcha */ }
    clearTimeout(corte);
    return SITE_KEY;
  })();
  return clavePromise;
}
const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js';

// Turnstile es web-first; en el WebView nativo es poco fiable, así que solo se activa
// en la web y cuando hay site key. Los demás casos quedan cubiertos por honeypot + rate limit.
// Cada formulario lo pregunta al crearse y muestra el cuadro del captcha cuando responde.
export async function captchaActivo(): Promise<boolean> {
  return !!(await claveCaptcha()) && !Capacitor.isNativePlatform();
}

let scriptPromise: Promise<void> | null = null;
function cargarScript(): Promise<void> {
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise<void>((resolve, reject) => {
    if ((window as any).turnstile) return resolve();
    const s = document.createElement('script');
    s.src = SCRIPT_URL;
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('No se pudo cargar Turnstile'));
    document.head.appendChild(s);
  });
  return scriptPromise;
}

export interface TurnstileWidget {
  token(): string;
  /** Espera a que haya token: tras un reset, o si el formulario se envía muy rápido. */
  listo(ms?: number): Promise<string>;
  reset(): void;
  destroy(): void;
}

// Monta el widget dentro del contenedor y va guardando el último token emitido.
// Si Turnstile no está habilitado o falla la carga, devuelve un widget "vacío" cuyo
// token() es '' (el flujo sigue igual). Nunca lanza.
export async function montarTurnstile(container: HTMLElement): Promise<TurnstileWidget> {
  const vacio: TurnstileWidget = { token: () => '', listo: async () => '', reset: () => {}, destroy: () => {} };
  if (!container || !(await captchaActivo())) return vacio;
  try {
    await cargarScript();
    const ts = (window as any).turnstile;
    if (!ts) return vacio;
    let tokenActual = '';
    const id = ts.render(container, {
      sitekey: SITE_KEY,
      callback: (t: string) => { tokenActual = t; },
      'error-callback': () => { tokenActual = ''; },
      'expired-callback': () => { tokenActual = ''; },
    });
    return {
      token: () => tokenActual,
      listo: async (ms = 8000) => {
        const limite = Date.now() + ms;
        while (!tokenActual && Date.now() < limite) await new Promise(r => setTimeout(r, 150));
        return tokenActual;
      },
      reset: () => { try { ts.reset(id); tokenActual = ''; } catch { /* noop */ } },
      destroy: () => { try { ts.remove(id); } catch { /* noop */ } },
    };
  } catch {
    return vacio;
  }
}
