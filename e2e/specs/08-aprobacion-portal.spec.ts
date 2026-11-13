// Flujo 8 · Aprobación y rechazo desde el portal del cliente (la brecha crítica
// de la auditoría): aprobar presupuesto, rechazar presupuesto y rechazar un
// adicional sin perder lo ya aprobado.
import { expect } from '@playwright/test';
import { una } from '../helpers/db';
import { confirmarAlerta, inyectarSesionPortal } from '../helpers/ui';
import { cotizar, crearVehiculo, transicionar } from '../helpers/motiq';
import { test } from '../fixtures/taller';

test('08 · el cliente aprueba, rechaza y decide sobre un adicional desde su portal', async ({ taller, page }) => {
  const PIEZAS = [
    { nombre: 'Juego de pastillas de freno cerámicas', cantidad: 1, costo_unitario: 28000 },
    { nombre: 'Líquido de frenos DOT4 (500ml)', cantidad: 1, costo_unitario: 6500 },
  ];

  // El cliente del portal es el dueño del vehículo y de las órdenes que va a ver.
  const portal = await taller.crearClientePortal('Paola', 'Portal');
  const cliente = portal.clienteId;
  const vehiculo = await crearVehiculo(taller.api, taller.token, { clienteId: cliente, placa: `AP${taller.unico()}` });

  // ── 8A · Aprobar el presupuesto inicial ──
  const ordenA = await taller.crearOrden(cliente, vehiculo, 'Frenos que chirrían');
  await cotizar(taller.api, taller.token, ordenA.id, PIEZAS, 18000);

  await inyectarSesionPortal(page, { token: portal.token, cliente: portal.cliente, slug: taller.slug });
  await page.goto('/portal/inicio');

  const presuA = page.locator('.presu', { hasText: ordenA.numero });
  await expect(presuA).toBeVisible({ timeout: 20_000 });
  await presuA.locator('.presu-ver').click();
  await expect(presuA.locator('.presu-det')).toContainText(/52[.,]500/, { timeout: 15_000 });
  await presuA.locator('.btn-aprobar').click();
  await confirmarAlerta(page, ['Aprobar']);
  await expect(page.locator('ion-toast')).toContainText(/aprobado/i, { timeout: 15_000 });
  await expect(page.locator('.presu', { hasText: ordenA.numero })).toHaveCount(0, { timeout: 20_000 });

  const a = await una(
    taller.db,
    "SELECT aprobacion_cliente, total_aprobado::float AS total, aprobado_por_cliente, fecha_aprobacion, estado FROM ordenes_trabajo WHERE id = ?",
    [ordenA.id]
  );
  expect(a.aprobacion_cliente).toBe('aprobado');
  expect(a.total).toBe(52500);
  expect(Number(a.aprobado_por_cliente)).toBe(1);
  expect(a.fecha_aprobacion).toBeTruthy();
  expect(['en_reparacion', 'esperando_repuestos']).toContain(a.estado);

  // ── 8B · Rechazar otro presupuesto: la orden vuelve a diagnóstico ──
  const ordenB = await taller.crearOrden(cliente, vehiculo, 'Ruido en la suspensión');
  await cotizar(taller.api, taller.token, ordenB.id, PIEZAS, 15000);

  await page.reload();
  const presuB = page.locator('.presu', { hasText: ordenB.numero });
  await expect(presuB).toBeVisible({ timeout: 20_000 });
  await presuB.locator('.presu-ver').click();
  await presuB.locator('.btn-rechazar').click();
  const alerta = page.locator('ion-alert');
  await expect(alerta).toBeVisible();
  await alerta.locator('textarea, input').first().fill('Excede mi presupuesto disponible este mes');
  await alerta.locator('button', { hasText: 'Rechazar' }).click();
  await expect(page.locator('ion-toast')).toContainText(/rechazado/i, { timeout: 15_000 });

  const b = await una(
    taller.db,
    "SELECT aprobacion_cliente, motivo_rechazo, total_aprobado, estado FROM ordenes_trabajo WHERE id = ?",
    [ordenB.id]
  );
  expect(b.aprobacion_cliente).toBe('rechazado');
  expect(b.motivo_rechazo).toBe('Excede mi presupuesto disponible este mes');
  expect(b.total_aprobado).toBeNull();
  expect(b.estado).toBe('diagnostico');

  // ── 8C · Adicional: el taller suma un repuesto, el cliente lo rechaza y lo
  //          aprobado antes queda en pie ──
  await transicionar(taller.api, taller.token, ordenA.id, 'en_reparacion');
  const adicional = await taller.api.post(`/recepcion/cotizaciones/${ordenA.id}/repuestos`, {
    token: taller.token,
    body: { nombre: 'Retén de cigüeñal', cantidad: 1, costo_unitario: 12000 },
  });
  expect(adicional.status).toBeLessThan(300);

  await page.reload();
  const presuAd = page.locator('.presu', { hasText: ordenA.numero });
  await expect(presuAd).toBeVisible({ timeout: 20_000 });
  await expect(presuAd).toContainText('Trabajo adicional por aprobar');
  await presuAd.locator('.presu-ver').click();
  await presuAd.locator('.btn-rechazar').click(); // "No, gracias"
  const alerta2 = page.locator('ion-alert');
  await expect(alerta2).toBeVisible();
  await alerta2.locator('textarea, input').first().fill('Hacer solo lo previamente aprobado');
  await alerta2.locator('button', { hasText: 'Rechazar' }).click();
  await expect(page.locator('ion-toast')).toContainText(/rechazado/i, { timeout: 15_000 });

  const c = await una(
    taller.db,
    "SELECT aprobacion_cliente, motivo_rechazo, total_aprobado::float AS total, estado FROM ordenes_trabajo WHERE id = ?",
    [ordenA.id]
  );
  expect(c.aprobacion_cliente, 'lo aprobado original sigue en pie').toBe('aprobado');
  expect(c.motivo_rechazo).toBe('Hacer solo lo previamente aprobado');
  expect(c.total).toBe(52500);
  expect(c.estado).toBe('en_reparacion');
});
