// Flujo 5 · Asistente de orden nueva de tres pasos: buscar cliente, elegir
// vehículo, recepción. Termina en el detalle de la orden, en Recepción.
import { expect } from '@playwright/test';
import { filas, una } from '../helpers/db';
import { inyectarSesionStaff } from '../helpers/ui';
import { test } from '../fixtures/taller';

test('05 · la orden se abre en recepción y abre su reloj de etapas', async ({ taller, page }) => {
  // La ruta /nueva-orden es del rol admin (app-routing: roles: ['admin']);
  // recepción abre órdenes por /recepcion/recibir, otro flujo.
  await inyectarSesionStaff(page, { token: taller.token, usuario: taller.usuario, slug: taller.slug });

  const cliente = await taller.crearCliente({ nombre: 'Melissa', apellido: `Arias ${taller.sello}` });
  const vehiculo = await taller.crearVehiculo(cliente);

  await page.goto('/nueva-orden');
  await expect(page.getByRole('heading', { name: 'Nueva orden de trabajo' })).toBeVisible();

  // Paso 1: buscar y elegir cliente (el buscador tiene 400 ms de espera).
  await page.locator('input[type="search"]').fill(taller.sello);
  await page.locator('.pg-item', { hasText: `Arias ${taller.sello}` }).first().click();

  // Paso 2: elegir el vehículo (auto-avance al paso 3).
  await expect(page.getByText('Vehículo', { exact: false }).first()).toBeVisible();
  await page.locator('.pg-item', { hasText: /Toyota Yaris/i }).first().click();

  // Paso 3: recepción.
  await page.locator('#no-problema').fill('Chirrido agudo al frenar y luz de mantenimiento encendida');
  await page.locator('#no-km').fill('28550');
  await page.locator('button.chip-filtro', { hasText: '1/2' }).click();
  await page.locator('button', { hasText: 'Crear orden' }).click();

  await expect(page).toHaveURL(/\/detalle-orden\/\d+/, { timeout: 25_000 });
  await expect(page.locator('.ot-cab .bg').first()).toContainText(/recepci/i, { timeout: 20_000 });

  // En la base: la orden, su número correlativo y el tiempo abierto de la etapa.
  const detalle = page.url().match(/\/detalle-orden\/(\d+)/)!;
  const ordenId = Number(detalle[1]);
  const o = await una(
    taller.db,
    'SELECT estado, numero_orden, kilometraje_ingreso, nivel_combustible FROM ordenes_trabajo WHERE id = ? AND tenant_id = ?',
    [ordenId, taller.tallerId]
  );
  expect(o, 'la orden quedó en la base de ESTE taller').toBeTruthy();
  expect(o.estado).toBe('recepcion');
  expect(String(o.numero_orden)).toMatch(/^OT-/);
  expect(Number(o.kilometraje_ingreso)).toBe(28550);

  const tiempos = await filas(
    taller.db,
    "SELECT etapa, inicio, fin FROM orden_tiempos WHERE orden_id = ? AND tenant_id = ?",
    [ordenId, taller.tallerId]
  );
  expect(tiempos.some((t) => t.etapa === 'recepcion' && t.inicio && !t.fin), 'la etapa de recepción está corriendo').toBe(true);
});
