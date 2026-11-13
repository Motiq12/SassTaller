// Flujo 6 · Diagnóstico técnico: el mecánico pasa la orden de recepción a
// diagnóstico y registra avances desde su pantalla.
// Hallazgo de esta suite: NO existe UI para redactar el diagnóstico técnico
// (PUT /api/ordenes/:id lo acepta pero ningún componente lo edita), así que el
// texto del diagnóstico se pone por API y la UI se valida con él cargado.
import { expect } from '@playwright/test';
import { filas, una } from '../helpers/db';
import { inyectarSesionStaff } from '../helpers/ui';
import { asignarTecnico } from '../helpers/motiq';
import { test } from '../fixtures/taller';

const DIAGNOSTICO = 'Discos con ceja pronunciada y pastillas delanteras al 10%. Fuga menor en amortiguador trasero derecho.';

test('06 · el técnico diagnostica, anota avances y el reloj marca la etapa', async ({ taller, page }) => {
  const tec = await taller.crearStaff('tecnico', 'Tomás Mecánico');
  const cliente = await taller.crearCliente();
  const vehiculo = await taller.crearVehiculo(cliente);
  const orden = await taller.crearOrden(cliente, vehiculo, 'Chirrido al frenar');
  await asignarTecnico(taller.api, taller.token, orden.id, tec.id);

  await inyectarSesionStaff(page, { token: tec.token, usuario: tec.usuario, slug: taller.slug });
  await page.goto(`/detalle-orden/${orden.id}`);
  await expect(page.locator('.ot-cab .bg').first()).toContainText(/recepci/i, { timeout: 20_000 });

  // Cambio de estado: recepción → diagnóstico. Como el vehículo no tiene fotos
  // de ingreso, el backend pide confirmación (409) y la UI abre el aviso.
  await page.locator('.ot-principal', { hasText: 'Pasar a diagnóstico' }).click();
  await expect(page.locator('ion-alert')).toContainText('¿Querés cambiar el estado igual?', { timeout: 15_000 });
  await page.locator('ion-alert button', { hasText: 'Cambiar igual' }).click();
  await expect(page.locator('.ot-cab .bg').first()).toContainText(/diagn/i, { timeout: 20_000 });

  // El diagnóstico del taller no se escribe desde ninguna pantalla: se registra
  // por la misma API que usaría el panel (documentado en el reporte).
  const puesto = await taller.api.put(`/ordenes/${orden.id}`, {
    token: taller.token,
    body: { diagnostico: DIAGNOSTICO },
  });
  expect(puesto.status, 'la API acepta el diagnóstico').toBeLessThan(300);

  await page.reload();
  await expect(page.locator('body')).toContainText(DIAGNOSTICO, { timeout: 20_000 });

  // Avance del trabajo (lo ve el cliente en el portal).
  await page.locator('#ot-avance').fill('Revisión en fosa completada con calibrador de desgaste.');
  await page.locator('button', { hasText: 'Registrar' }).click();
  await expect(page.locator('.ot-avances li')).toContainText('Revisión en fosa completada', { timeout: 15_000 });

  // En la base: estado, cierre de la etapa previa, etapa abierta y el avance.
  const o = await una(taller.db, 'SELECT estado FROM ordenes_trabajo WHERE id = ?', [orden.id]);
  expect(o.estado).toBe('diagnostico');

  const tiempos = await filas(
    taller.db,
    'SELECT etapa, fin FROM orden_tiempos WHERE orden_id = ? ORDER BY id',
    [orden.id]
  );
  expect(tiempos.some((t) => t.etapa === 'recepcion' && t.fin)).toBe(true);
  expect(tiempos.some((t) => t.etapa === 'diagnostico' && !t.fin)).toBe(true);

  const avance = await una(
    taller.db,
    'SELECT a.descripcion, u.nombre AS usuario_nombre FROM orden_avances a JOIN usuarios u ON u.id = a.usuario_id WHERE a.orden_id = ? ORDER BY a.id DESC LIMIT 1',
    [orden.id]
  );
  expect(String(avance.descripcion)).toContain('Revisión en fosa');
  expect(String(avance.usuario_nombre).length).toBeGreaterThan(0);
});
