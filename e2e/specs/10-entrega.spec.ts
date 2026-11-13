// Flujo 10 · Entrega y facturación con garantía: modal de entrega con forma de
// pago, garantía y apertura de la factura; la orden se cierra y sus costos
// quedan bloqueados.
import { expect } from '@playwright/test';
import { una } from '../helpers/db';
import { inyectarSesionStaff } from '../helpers/ui';
import { ordenListaParaEntrega } from '../helpers/motiq';
import { test } from '../fixtures/taller';

const PIEZAS = [
  { nombre: 'Juego de pastillas de freno cerámicas', cantidad: 1, costo_unitario: 28000 },
  { nombre: 'Líquido de frenos DOT4 (500ml)', cantidad: 1, costo_unitario: 6500 },
];

test('10 · entregar cobra, garantiza y factura; después nada se edita', async ({ taller, page }) => {
  const recep = await taller.crearStaff('recepcion', 'Rosa Recepción');
  await inyectarSesionStaff(page, { token: recep.token, usuario: recep.usuario, slug: taller.slug });

  // La orden es del cliente del portal: es quien aprueba el presupuesto.
  const portal = await taller.crearClientePortal('Paola', 'Portal');
  const cliente = portal.clienteId;
  const vehiculo = await taller.crearVehiculo(cliente, { placa: `EN${taller.unico()}` });
  const orden = await ordenListaParaEntrega(taller.api, taller.token, taller.db, taller, {
    clienteId: cliente,
    vehiculoId: vehiculo,
    problema: 'Frenos que chirrían',
    piezas: PIEZAS,
    manoObra: 18000,
    tokenCliente: portal.token,
  });

  await page.goto(`/detalle-orden/${orden.id}`);
  await expect(page.locator('.ot-cab .bg').first()).toContainText(/lista/i, { timeout: 20_000 });

  // Modal de entrega.
  await page.locator('button', { hasText: 'Entregar al cliente' }).first().click();
  const modal = page.locator('.ent');
  await expect(modal).toBeVisible({ timeout: 15_000 });

  // Forma de pago SINPE, garantía 30 días y abrir la factura al terminar.
  await modal.locator('.ent-pago-btn', { hasText: /sinpe/i }).click();
  await modal.locator('#ent-garantia').fill('30');
  // "Abrir la factura" viene marcado de fábrica; se asegura sin invertirlo.
  const abrirFactura = modal.locator('ion-checkbox.ent-factura');
  const casilla = abrirFactura.locator('input[type="checkbox"]');
  if (!(await casilla.isChecked())) await abrirFactura.click();
  await expect(casilla).toBeChecked();
  await modal.locator('button', { hasText: 'Entregar' }).last().click();

  // Navega a la factura con el desglose, la garantía y la marca del taller.
  await expect(page).toHaveURL(new RegExp(`/factura/${orden.id}`), { timeout: 20_000 });
  await expect(page.locator('.fac-header')).toContainText(taller.nombre, { timeout: 20_000 });
  await expect(page.locator('.fac-totales')).toContainText(/52[.,]500/, { timeout: 15_000 });
  await expect(page.locator('.fac-pie')).toContainText('Garantía: 30 días', { timeout: 15_000 });

  // En la base: entregada, con pago, garantía y cierre de tiempos.
  const o = await una(
    taller.db,
    "SELECT estado, metodo_pago, garantia_dias, fecha_entrega_real FROM ordenes_trabajo WHERE id = ?",
    [orden.id]
  );
  expect(o.estado).toBe('entregada');
  expect(o.metodo_pago).toBe('sinpe');
  expect(Number(o.garantia_dias)).toBe(30);
  expect(o.fecha_entrega_real).toBeTruthy();

  const abiertos = await una(
    taller.db,
    'SELECT COUNT(*)::int AS n FROM orden_tiempos WHERE orden_id = ? AND fin IS NULL',
    [orden.id]
  );
  expect(abiertos.n, 'todas las etapas quedaron cerradas').toBe(0);

  // Q-03: una orden entregada no acepta cambios de costos ni repuestos.
  const tarde = await taller.api.post(`/recepcion/cotizaciones/${orden.id}/repuestos`, {
    token: taller.token,
    body: { nombre: 'No debería entrar', cantidad: 1, costo_unitario: 1000 },
  });
  expect([400, 404, 409]).toContain(tarde.status);
});
