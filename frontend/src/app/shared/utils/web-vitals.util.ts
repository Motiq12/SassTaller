// Core Web Vitals medidos en el navegador de quien usa la app, y enviados al backend.
//
// Por qué existe: Lighthouse mide en laboratorio y no interactúa con la página, así
// que nunca puede dar INP —el tiempo que tarda la interfaz en responder a un toque—.
// Esa métrica solo aparece con una persona real usando la aplicación.
//
// El costo es despreciable: la librería pesa ~2 KB, observa de forma pasiva y no
// interviene en el renderizado. Si algo falla, se ignora en silencio: una métrica
// perdida no puede romperle la pantalla a nadie.

import { onLCP, onCLS, onINP, onFCP, onTTFB, type Metric } from 'web-vitals';
import { environment } from '../../../environments/environment';

// En la app nativa el origen es capacitor://localhost y las rutas relativas no
// resuelven; se usa la URL absoluta que ya conoce el resto de la app.
const nativo = !!(window as any).Capacitor?.isNativePlatform?.();
const URL_METRICAS = `${nativo ? environment.nativeApiUrl : ''}${environment.apiUrl}/metricas/web-vitals`;
// Las páginas públicas de Motiq (landing, registro, login sin taller) van a su propia
// tabla: no son de ningún taller. Solo estas rutas; el servidor descarta el resto.
const URL_PUBLICA = `${URL_METRICAS}-publico`;
const RUTAS_PUBLICAS = ['/', '/registro-taller', '/portal/login', '/portal/recuperar', '/portal/registro'];

// El taller al que atribuir la medición. El endpoint es público —las métricas que más
// importan son las del login y el registro, donde todavía no hay sesión— así que el
// taller no puede salir de un token: viaja en la dirección, igual que en el resto de
// las rutas públicas del portal. Sin esto la fila no tiene a qué taller pertenecer y el
// servidor la descarta.
//
// Devuelve null cuando no hay ningún taller del que pueda ser la medición: la landing
// de motiq12.com (el dominio del producto) no es de nadie. Esas visitas van a
// URL_PUBLICA (ver enviar()). Con subdominio de taller
// (msmotors.motiq12.com) el servidor lo resuelve solo, aunque acá no haya slug; es la
// misma regla de services/taller.service.ts.
function urlConTaller(): string | null {
  try {
    const enUrl = new URLSearchParams(window.location.search).get('taller');
    const slug = enUrl || localStorage.getItem('tallerms_taller');
    if (slug) return `${URL_METRICAS}?taller=${encodeURIComponent(slug)}`;
  } catch { /* modo privado o sin window: se decide por el subdominio */ }
  const host = (window.location.hostname || '').toLowerCase();
  const haySubdominio = host.split('.').length >= 3 && !/^www\./.test(host)
    && !host.endsWith('.railway.app') && !/^[\d.]+$/.test(host);
  return haySubdominio ? URL_METRICAS : null;
}

function enviar(m: Metric) {
  const cuerpo = JSON.stringify({
    metrica: m.name,
    // CLS es un índice sin unidad y llega con muchos decimales; el resto son ms.
    valor: m.name === 'CLS' ? Number(m.value.toFixed(4)) : Math.round(m.value),
    calificacion: m.rating,              // 'good' | 'needs-improvement' | 'poor'
    ruta: location.pathname,             // sin querystring: puede traer datos
    movil: window.innerWidth < 768,
    // Qué mostró la portada (disco 3D o imagen fija): la marca hero.component.ts.
    variante: (window as Window & { __motiqPortada?: string }).__motiqPortada || 'ninguna',
  });

  const url = urlConTaller() ?? (RUTAS_PUBLICAS.includes(location.pathname) ? URL_PUBLICA : null);
  if (!url) return;
  try {
    // sendBeacon es el único que sobrevive al cierre de la pestaña, que es
    // justamente cuando se conocen los valores definitivos de CLS e INP.
    if (navigator.sendBeacon) {
      navigator.sendBeacon(url, new Blob([cuerpo], { type: 'application/json' }));
      return;
    }
    // keepalive cumple el mismo papel donde no hay sendBeacon (Safari viejo).
    fetch(url, {
      method: 'POST', body: cuerpo, keepalive: true,
      headers: { 'Content-Type': 'application/json' },
    }).catch(() => {});
  } catch {
    /* medir nunca debe romper la app */
  }
}

// Se llama una sola vez, al arrancar. Cada `on*` dispara cuando su métrica queda
// firme: LCP y CLS al ocultarse la página, INP tras las interacciones reales.
export function iniciarWebVitals() {
  try {
    onLCP(enviar);
    onCLS(enviar);
    onINP(enviar);
    onFCP(enviar);
    onTTFB(enviar);
  } catch {
    /* navegador sin soporte: se sigue sin métricas */
  }
}
