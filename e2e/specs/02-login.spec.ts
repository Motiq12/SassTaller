// Flujo 2 · Login unificado: la misma pantalla manda a cada quien a su panel
// (admin, recepción, mecánico, cliente) y rechaza claves incorrectas.
import { expect, type Browser, type Page } from '@playwright/test';
import { una } from '../helpers/db';
import { escribirInput } from '../helpers/ui';
import { test } from '../fixtures/taller';

async function entrarComo(browser: Browser, email: string, password: string): Promise<Page> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto('/portal/login');
  await expect(page).toHaveURL(/\/portal\/login/);
  await escribirInput(page, 'email', email);
  await escribirInput(page, 'password', password);
  await page.locator('ion-button', { hasText: 'Ingresar' }).first().click();
  return page;
}

test('02 · cada rol entra a su panel y las claves malas no pasan', async ({ taller, browser }) => {
  const recep = await taller.crearStaff('recepcion', 'Rosa Recepción');
  const tec = await taller.crearStaff('tecnico', 'Tomás Mecánico');
  const cliente = await taller.crearClientePortal('Clara', 'Cliente', `clara.${taller.sello}@prueba.test`);

  // 2B · Admin → /admin
  const admin = await entrarComo(browser, taller.adminEmail, taller.adminPassword);
  await expect(admin).toHaveURL(/\/admin/, { timeout: 20_000 });
  await admin.context().close();

  // 2C · Recepción → /recepcion
  const pRecep = await entrarComo(browser, recep.email, taller.adminPassword);
  await expect(pRecep).toHaveURL(/\/recepcion/, { timeout: 20_000 });
  await pRecep.context().close();

  // 2D · Técnico → /mecanico
  const pTec = await entrarComo(browser, tec.email, taller.adminPassword);
  await expect(pTec).toHaveURL(/\/mecanico/, { timeout: 20_000 });
  await pTec.context().close();

  // 2E · Cliente del portal → su inicio
  const pCliente = await entrarComo(browser, cliente.email, taller.adminPassword);
  await expect(pCliente).toHaveURL(/\/portal(\/|$)/, { timeout: 20_000 });
  await pCliente.context().close();

  // 2F · Clave incorrecta: se queda en la pantalla y avisa.
  const mala = await entrarComo(browser, taller.adminEmail, 'ClaveErronea999');
  await expect(mala).toHaveURL(/\/portal\/login/, { timeout: 20_000 });
  await expect(mala.locator('ion-toast')).toContainText(/credenciales incorrectas/i, { timeout: 15_000 });
  await mala.context().close();

  // En la base quedó el rastro de seguridad: el intento malo de ESTE correo
  // quedó como `login_fallido`, y cada login bueno del personal de este taller
  // abrió su sesión revocable.
  const fallo = await una(
    taller.db,
    "SELECT tipo FROM eventos_seguridad WHERE tipo = 'login_fallido' AND LOWER(email) = ? ORDER BY id DESC LIMIT 1",
    [taller.adminEmail.toLowerCase()]
  );
  expect(fallo, 'evento de seguridad login_fallido').toBeTruthy();
  for (const email of [taller.adminEmail, recep.email, tec.email]) {
    const sesion = await una(
      taller.db,
      'SELECT s.sid FROM sesiones_personal s JOIN usuarios u ON u.id = s.usuario_id WHERE s.tenant_id = ? AND LOWER(u.email) = ? ORDER BY s.id DESC LIMIT 1',
      [taller.tallerId, email.toLowerCase()]
    );
    expect(sesion, `sesión de personal abierta para ${email}`).toBeTruthy();
  }
});
