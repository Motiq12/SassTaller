// Flujo 3 · Registro de un cliente desde /cliente-form, con la sesión de
// recepción inyectada (el login en UI ya lo cubre el flujo 2).
import { expect } from '@playwright/test';
import { una } from '../helpers/db';
import { inyectarSesionStaff } from '../helpers/ui';
import { test } from '../fixtures/taller';

test('03 · recepción registra a un cliente y queda en su taller', async ({ taller, page }) => {
  const recep = await taller.crearStaff('recepcion', 'Rosa Recepción');
  await inyectarSesionStaff(page, { token: recep.token, usuario: recep.usuario, slug: taller.slug });

  const s = taller.sello;
  await page.goto('/cliente-form');
  await expect(page.getByRole('heading', { name: /nuevo cliente/i })).toBeVisible();

  await page.locator('input[name="nombre"]').fill('Mariana');
  await page.locator('input[name="apellido"]').fill(`Campos ${s}`);
  await page.locator('input[name="telefono"]').fill('87654321');
  await page.locator('input[name="cedula"]').fill('115670890');
  await page.locator('input[name="email"]').fill(`mariana.${s}@prueba.test`);
  await page.locator('textarea[name="direccion"]').fill('Barrio El Carmen, 200m norte');

  await page.locator('button.cta', { hasText: 'Guardar' }).click();
  await expect(page.locator('ion-toast')).toContainText(/cliente/i, { timeout: 15_000 });
  // Al guardar, el formulario hace location.back(). Hay que esperar a que esa navegación
  // termine: si el goto de abajo sale mientras tanto, el navegador cancela uno de los dos
  // (net::ERR_ABORTED) y la página queda en blanco. Pasó en el CI del PR #48.
  await page.waitForURL(url => !url.pathname.startsWith('/cliente-form'), { timeout: 15_000 });

  // En la base: el cliente pertenece a ESTE taller, con los datos tal cual.
  const c = await una(
    taller.db,
    'SELECT tenant_id, nombre, apellido, telefono, cedula FROM clientes WHERE email = ? ORDER BY id DESC LIMIT 1',
    [`mariana.${s}@prueba.test`]
  );
  expect(c, 'el cliente quedó en la base').toBeTruthy();
  expect(c.tenant_id).toBe(taller.tallerId);
  expect(c.nombre).toBe('Mariana');
  expect(String(c.telefono)).toContain('87654321');
  expect(String(c.cedula)).toContain('115670890');

  // Aparece en la lista de clientes de recepción.
  await page.goto('/recepcion/clientes');
  await expect(page.locator('body')).toContainText(`Campos ${s}`, { timeout: 15_000 });
});
