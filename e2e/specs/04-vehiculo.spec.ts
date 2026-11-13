// Flujo 4 · Registro del vehículo de un cliente en /moto-form.
import { expect } from '@playwright/test';
import { una } from '../helpers/db';
import { inyectarSesionStaff } from '../helpers/ui';
import { test } from '../fixtures/taller';

test('04 · el vehículo queda ligado al cliente con su placa normalizada', async ({ taller, page }) => {
  const recep = await taller.crearStaff('recepcion', 'Rosa Recepción');
  await inyectarSesionStaff(page, { token: recep.token, usuario: recep.usuario, slug: taller.slug });

  const cliente = await taller.crearCliente({ nombre: 'Mariana', apellido: `Vega ${taller.sello}` });
  const placa = `V${taller.unico()}`;   // placaValida: 4-10 alfanum.

  await page.goto(`/moto-form?cliente_id=${cliente}`);
  await expect(page.getByRole('heading', { name: /registrar/i })).toBeVisible();

  // El taller atiende solo autos: no hay selector de tipo (aparece con >1 tipo).
  await expect(page.locator('#tipo-vehiculo')).toHaveCount(0);

  await page.locator('input[name="marca"]').fill('Toyota');
  await page.locator('input[name="modelo"]').fill('Yaris');
  await page.locator('input[name="anio"]').fill('2022');
  await page.locator('input[name="placa"]').fill(placa);
  await page.locator('input[name="color"]').fill('Azul Metálico');
  await page.locator('input[name="kilometraje_actual"]').fill('28500');

  await page.locator('button.cta', { hasText: 'Guardar' }).click();
  await expect(page.locator('ion-toast')).toContainText(/guardado|veh/i, { timeout: 15_000 });

  const v = await una(
    taller.db,
    'SELECT tenant_id, cliente_id, marca, modelo, anio, placa, placa_norm, kilometraje_actual FROM vehiculos WHERE cliente_id = ? ORDER BY id DESC LIMIT 1',
    [cliente]
  );
  expect(v, 'el vehículo quedó en la base').toBeTruthy();
  expect(v.tenant_id).toBe(taller.tallerId);
  expect(v.cliente_id).toBe(cliente);
  expect(v.marca).toBe('Toyota');
  expect(String(v.placa_norm || v.placa).replace(/[^A-Z0-9]/gi, '')).toBe(placa);
  expect(Number(v.kilometraje_actual)).toBe(28500);
});
