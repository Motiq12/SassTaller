// Flujo 11 · Historial del vehículo, por los dos ojos: el taller (ficha con
// montos) y el cliente del portal (bitácora de servicios).
import { expect } from '@playwright/test';
import { inyectarSesionPortal, inyectarSesionStaff } from '../helpers/ui';
import { ordenListaParaEntrega } from '../helpers/motiq';
import { test } from '../fixtures/taller';

const PIEZAS = [{ nombre: 'Juego de pastillas', cantidad: 1, costo_unitario: 28000 }];

test('11 · el historial muestra el servicio entregado en ambos lados', async ({ taller, page }) => {
  const recep = await taller.crearStaff('recepcion', 'Rosa Recepción');
  await inyectarSesionStaff(page, { token: recep.token, usuario: recep.usuario, slug: taller.slug });

  // El vehículo y la orden son del cliente del portal: aprueba y después mira su historial.
  const portal = await taller.crearClientePortal('Paola', 'Portal');
  const cliente = portal.clienteId;
  const placa = `HI${taller.unico()}`;
  const vehiculo = await taller.crearVehiculo(cliente, { placa });
  const orden = await ordenListaParaEntrega(taller.api, taller.token, taller.db, taller, {
    clienteId: cliente,
    vehiculoId: vehiculo,
    problema: 'Frenos que chirrían',
    piezas: PIEZAS,
    manoObra: 18000,
    tokenCliente: portal.token,
  });
  // El flujo 10 prueba la entrega desde la UI; acá se entrega por la misma API
  // de recepción para que quede como historial cerrado.
  const entrega = await taller.api.post(`/recepcion/ordenes/${orden.id}/entregar`, {
    token: taller.token,
    body: { metodo_pago: 'sinpe', garantia_dias: 30 },
  });
  if (entrega.status >= 300) throw new Error(`la entrega directa falló: ${entrega.texto.slice(0, 200)}`);

  // ── Vista taller: /moto-historial ──
  await page.goto(`/moto-historial/${vehiculo}`);
  await expect(page.locator('.mh-page')).toBeVisible({ timeout: 20_000 });
  const ficha = page.locator('.mh-orden', { hasText: orden.numero });
  await expect(ficha).toBeVisible({ timeout: 20_000 });
  await expect(ficha).toContainText(/₡46[.,]000/); // 28000 + 18000

  // ── Vista cliente: /portal/motos → /portal/moto/:id/historial ──
  await inyectarSesionPortal(page, { token: portal.token, cliente: portal.cliente, slug: taller.slug });
  await page.goto('/portal/motos');
  const moto = page.locator('.mc', { hasText: placa });
  await expect(moto).toBeVisible({ timeout: 20_000 });
  await moto.click();
  await expect(page).toHaveURL(new RegExp(`/portal/moto/${vehiculo}/historial`), { timeout: 20_000 });
  await expect(page.locator('.tl-card', { hasText: 'Bitácora de servicios' })).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.timeline')).toContainText(orden.numero, { timeout: 15_000 });
});
