// Flujo 7 · Presupuesto: recepción arma la cotización (piezas + mano de obra),
// la guarda y la envía; la orden queda esperando la decisión del cliente.
import { expect } from '@playwright/test';
import { una } from '../helpers/db';
import { inyectarSesionStaff } from '../helpers/ui';
import { test } from '../fixtures/taller';

test('07 · la cotización se arma desde la web y se envía al portal', async ({ taller, page }) => {
  const recep = await taller.crearStaff('recepcion', 'Rosa Recepción');
  await inyectarSesionStaff(page, { token: recep.token, usuario: recep.usuario, slug: taller.slug });

  const cliente = await taller.crearCliente({ nombre: 'Paola', apellido: `Quesada ${taller.sello}` });
  const vehiculo = await taller.crearVehiculo(cliente, { placa: `PZ${taller.unico()}` });
  const orden = await taller.crearOrden(cliente, vehiculo, 'Frenos que chirrían');

  await page.goto('/recepcion/cotizaciones');
  await page.locator('button', { hasText: 'Nueva cotización' }).click();

  // Selector de cliente (modal con buscador).
  await page.locator('.rc-picker').first().click();
  await page.locator('.rc-pk input[type="search"]').fill(taller.sello);
  await page.locator('.rc-pk-fila', { hasText: `Quesada ${taller.sello}` }).first().click();

  // Selector de orden activa del cliente.
  await page.locator('.rc-picker').nth(1).click();
  await page.locator('.rc-pk-fila', { hasText: orden.numero }).first().click();

  // Piezas: la primera fila del formulario ya existe; se agrega la segunda.
  await page.locator('.rc-pieza input[aria-label="Nombre de la pieza"]').first().fill('Juego de pastillas de freno cerámicas');
  await page.locator('.rc-pieza .rc-monto').first().fill('28000');
  await page.locator('button', { hasText: 'Agregar pieza' }).click();
  await page.locator('.rc-pieza input[aria-label="Nombre de la pieza"]').nth(1).fill('Líquido de frenos DOT4 (500ml)');
  await page.locator('.rc-pieza .rc-monto').nth(1).fill('6500');
  await page.locator('.rc-form input[type="number"][placeholder="0"]').fill('18000');

  // Total en pantalla: 28000 + 6500 + 18000 = 52.500 (separador según locale).
  await expect(page.locator('.rc-form .rc-total strong')).toContainText(/52[.,]500/, { timeout: 15_000 });

  await page.locator('button', { hasText: 'Guardar cotización' }).click();

  // La card aparece en la lista; el botón Enviar mueve la cotización a Enviadas.
  const card = page.locator('.rc-card', { hasText: orden.numero });
  await expect(card).toBeVisible({ timeout: 20_000 });
  await expect(card).toContainText(/52[.,]500/);
  await card.locator('button', { hasText: 'Enviar' }).click();
  // El aviso de éxito y la orden esperando la decisión del cliente. La card sigue
  // en Pendientes: se mueve a Enviadas cuando el cliente aprueba o rechaza.
  await expect(page.locator('ion-toast', { hasText: 'Cotización enviada' })).toBeVisible({ timeout: 15_000 });

  // En la base: montos exactos y orden esperando aprobación del cliente.
  const o = await una(
    taller.db,
    'SELECT estado, aprobacion_cliente, costo_repuestos::float AS rep, costo_mano_obra::float AS mo, (costo_mano_obra + costo_repuestos)::float AS total FROM ordenes_trabajo WHERE id = ?',
    [orden.id]
  );
  expect(o.estado).toBe('esperando_aprobacion');
  expect(o.aprobacion_cliente).toBe('pendiente');
  expect(o.rep).toBe(34500);
  expect(o.mo).toBe(18000);
  expect(o.total).toBe(52500);
});
