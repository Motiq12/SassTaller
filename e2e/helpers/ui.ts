// Utilidades de UI para Ionic: escribir en ion-input/ion-textarea (el input real
// vive en el shadow/light DOM interno) y sesiones inyectadas en localStorage.
import type { Page } from '@playwright/test';

export async function escribirInput(page: Page, nombre: string, valor: string): Promise<void> {
  // ion-input/ion-textarea renderizan su input/textarea interno: llenarlo
  // dispara los eventos que Angular escucha (ngModel).
  const ion = page.locator(`ion-input[name="${nombre}"], ion-textarea[name="${nombre}"]`).first();
  const interno = ion.locator('input, textarea').first();
  await interno.waitFor({ state: 'attached' });
  await interno.fill(valor);
}

// Sesión de staff lista en localStorage: los specs que no prueban el login en sí
// (ese lo cubre el flujo 2) arrancan directo en su pantalla, sin pasar por el form.
export async function inyectarSesionStaff(
  page: Page,
  sesion: { token: string; usuario: any; slug: string }
): Promise<void> {
  await page.addInitScript(
    ({ token, usuario, slug }) => {
      localStorage.setItem('tallerms_token', token);
      localStorage.setItem('tallerms_usuario', JSON.stringify(usuario));
      localStorage.setItem('tallerms_taller', slug);
    },
    { token: sesion.token, usuario: sesion.usuario, slug: sesion.slug }
  );
}

export async function inyectarSesionPortal(
  page: Page,
  sesion: { token: string; cliente: any; slug: string }
): Promise<void> {
  await page.addInitScript(
    ({ token, cliente, slug }) => {
      localStorage.setItem('tallerms_portal_token', token);
      localStorage.setItem('tallerms_portal_cliente', JSON.stringify(cliente));
      localStorage.setItem('tallerms_taller', slug);
      // El tour de bienvenida del portal se salta: cubre su contenido el flujo 3.
      localStorage.setItem(`tallerms_onboarding_visto_${cliente.id ?? 'anon'}`, '1');
    },
    { token: sesion.token, cliente: sesion.cliente, slug: sesion.slug }
  );
}

// Confirmar cualquier cuadro de Ionic (avisos de cambio de estado, envío de
// presupuesto): busca dentro del ion-alert, no en la página de fondo.
export async function confirmarAlerta(page: Page, textos: string[]): Promise<void> {
  const alerta = page.locator('ion-alert');
  await alerta.waitFor({ state: 'visible' });
  for (const t of textos) {
    const boton = alerta.locator('button', { hasText: t }).last();
    if (await boton.count()) { await boton.click(); return; }
  }
  throw new Error(`Ningún botón de la alerta coincide con: ${textos.join(' | ')}`);
}
