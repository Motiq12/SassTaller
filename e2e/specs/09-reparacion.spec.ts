// Flujo 9 · Reparación: recepción recibe el repuesto ("Llegó"), el técnico
// anota el avance y marca la orden lista, y recepción llena el checklist de
// calidad desde la misma pantalla. Cada rol en su propio navegador.
import { expect } from '@playwright/test';
import { filas, una } from '../helpers/db';
import { confirmarAlerta, inyectarSesionStaff } from '../helpers/ui';
import { aprobarComoCliente, asignarTecnico, cotizar } from '../helpers/motiq';
import { test } from '../fixtures/taller';

test('09 · con el repuesto en mano y el checklist listo, la orden queda para entregar', async ({ taller, browser }) => {
  const tec = await taller.crearStaff('tecnico', 'Tomás Mecánico');
  const recep = await taller.crearStaff('recepcion', 'Rosa Recepción');
  // La orden debe ser del cliente del portal: es quien aprueba el presupuesto.
  const portal = await taller.crearClientePortal('Paola', 'Portal');
  const cliente = portal.clienteId;
  const vehiculo = await taller.crearVehiculo(cliente);

  const orden = await taller.crearOrden(cliente, vehiculo, 'Pastillas gastadas');
  await cotizar(taller.api, taller.token, orden.id, [{ nombre: 'Juego de pastillas', cantidad: 1, costo_unitario: 28000 }], 18000);
  await aprobarComoCliente(taller.api, portal.token, orden.id);
  await asignarTecnico(taller.api, taller.token, orden.id, tec.id);

  // La pieza de la cotización nace pendiente: aprobada, la orden espera el repuesto.
  const inicial = await una(taller.db, 'SELECT estado FROM ordenes_trabajo WHERE id = ?', [orden.id]);
  expect(inicial.estado).toBe('esperando_repuestos');

  // ── Recepción: el repuesto llega al taller ──
  const ctxRecep = await browser.newContext();
  const pRecep = await ctxRecep.newPage();
  await inyectarSesionStaff(pRecep, { token: recep.token, usuario: recep.usuario, slug: taller.slug });
  await pRecep.goto(`/detalle-orden/${orden.id}`);
  await expect(pRecep.locator('.ot-cab .bg').first()).toContainText(/esperando repuestos/i, { timeout: 20_000 });

  const fila = pRecep.locator('.ot-rep-fila', { hasText: 'Juego de pastillas' });
  await expect(fila).toBeVisible({ timeout: 20_000 });
  await fila.locator('button', { hasText: 'Llegó' }).click();
  await expect(fila.locator('.c-estado .bg')).toContainText(/disponible/i, { timeout: 15_000 });
  const pieza = await una(taller.db, "SELECT estado FROM orden_repuestos WHERE orden_id = ? AND nombre = 'Juego de pastillas'", [orden.id]);
  expect(pieza.estado).toBe('disponible');

  // ── Técnico: arranca la reparación, anota el avance y la deja lista ──
  const ctxTec = await browser.newContext();
  const pTec = await ctxTec.newPage();
  await inyectarSesionStaff(pTec, { token: tec.token, usuario: tec.usuario, slug: taller.slug });
  await pTec.goto(`/detalle-orden/${orden.id}`);
  await expect(pTec.locator('.ot-cab .bg').first()).toContainText(/esperando repuestos/i, { timeout: 20_000 });

  // Con el repuesto en mano, la acción principal pasa la orden a reparación.
  await pTec.locator('.ot-principal', { hasText: 'Llegaron: pasar a reparación' }).click();
  if (await pTec.locator('ion-alert').isVisible().catch(() => false)) await confirmarAlerta(pTec, ['Cambiar igual']);
  await expect(pTec.locator('.ot-cab .bg').first()).toContainText(/reparaci/i, { timeout: 20_000 });

  await pTec.locator('#ot-avance').fill('Instaladas pastillas cerámicas, purgado circuito con DOT4 y ajuste de freno de mano.');
  await pTec.locator('button', { hasText: 'Registrar' }).click();
  await expect(pTec.locator('.ot-avances li')).toContainText('Instaladas pastillas cerámicas', { timeout: 15_000 });

  await pTec.locator('.ot-principal', { hasText: 'Marcar lista para entrega' }).click();
  if (await pTec.locator('ion-alert').isVisible().catch(() => false)) await confirmarAlerta(pTec, ['Cambiar igual']);
  await expect(pTec.locator('.ot-cab .bg').first()).toContainText(/lista/i, { timeout: 20_000 });
  await ctxTec.close();

  // En la base: estado y cierre/apertura de etapas.
  const o = await una(taller.db, 'SELECT estado FROM ordenes_trabajo WHERE id = ?', [orden.id]);
  expect(o.estado).toBe('lista_entrega');
  const tiempos = await filas(taller.db, 'SELECT etapa, fin FROM orden_tiempos WHERE orden_id = ? ORDER BY id', [orden.id]);
  expect(tiempos.some((t) => t.etapa === 'en_reparacion' && t.fin), 'la etapa de reparación quedó cerrada').toBe(true);
  expect(tiempos.some((t) => t.etapa === 'lista_entrega' && !t.fin), 'la etapa de entrega está corriendo').toBe(true);

  // ── Recepción: checklist de control de calidad en la tarjeta de entrega ──
  await pRecep.reload();
  const entrega = pRecep.locator('section.ot-entrega');
  await expect(entrega).toBeVisible({ timeout: 20_000 });
  for (const item of ['Prueba de manejo', 'Calidad revisada']) {
    await entrega.locator('ion-checkbox', { hasText: item }).click();
    await expect(entrega.locator('.ot-nota')).toHaveText('Guardado', { timeout: 15_000 });
  }
  await expect(entrega).toContainText('Falta: lavado, factura lista');

  const cl = await una(
    taller.db,
    'SELECT prueba_realizada, calidad_revisada, lavado FROM orden_checklist WHERE orden_id = ? AND tenant_id = ?',
    [orden.id, taller.tallerId]
  );
  expect(cl, 'el checklist quedó guardado').toBeTruthy();
  expect(Number(cl.prueba_realizada)).toBe(1);
  expect(Number(cl.calidad_revisada)).toBe(1);
  expect(Number(cl.lavado)).toBe(0);
  await ctxRecep.close();
});
