// Flujo 12 · Separación entre talleres: el mismo cliente, la misma cédula y la
// misma placa existen en los dos talleres y NADA cruza — ni listados, ni URLs
// forzadas, ni escrituras por API, ni el portal, ni la base.
import { expect } from '@playwright/test';
import { filas, una } from '../helpers/db';
import { inyectarSesionPortal, inyectarSesionStaff } from '../helpers/ui';
import { crearOrdenDeTaller, crearStaff, crearTallerApi, cotizar, loginClientePortal, registrarClientePortal, sello } from '../helpers/motiq';
import { test } from '../fixtures/taller';

test('12 · lo de un taller no existe para el otro', async ({ taller, page }) => {
  // ── Alfa: el taller del fixture, con su canario ──
  const alfaCliente = await taller.crearCliente({ nombre: 'Camila', apellido: 'Vega', email: `camila.${taller.sello}@prueba.test` });
  const alfaPlaca = `CA${taller.unico()}`;
  const alfaVehiculo = await taller.crearVehiculo(alfaCliente, { placa: alfaPlaca });
  const PROBLEMA_ALFA = `Canario Alfa ${taller.sello}: fuga de aceite`;
  const alfaOrden = await taller.crearOrden(alfaCliente, alfaVehiculo, PROBLEMA_ALFA);
  await cotizar(taller.api, taller.token, alfaOrden.id, [{ nombre: 'Empaque', cantidad: 1, costo_unitario: 9000 }], 6000);

  // ── Beta: otro taller con EXACTAMENTE los mismos datos ──
  const apiB = taller.api; // misma IP, misma base: los ids son lo que separa
  const slugB = `t${sello()}b`;
  const beta = await crearTallerApi(apiB, { slug: slugB, email: `${slugB}@prueba.test`, nombre: `Taller Beta ${slugB}` });
  const betaToken = beta.token;
  const betaDb = taller.db;
  const betaClienteId = await (async () => {
    const r = await apiB.post('/clientes', {
      token: betaToken,
      body: {
        nombre: 'Camila',
        apellido: 'Vega',
        telefono: '87654321',
        email: `camila.${taller.sello}@prueba.test`, // MISMO correo que en Alfa
        cedula: '115670890',                          // MISMA cédula
        tipo_cedula: 'fisica',
      },
    });
    expect(r.status, 'el mismo cliente puede existir en los dos talleres').toBeLessThan(300);
    return r.json.data.id || r.json.data.insertId;
  })();
  const betaVehiculo = await (async () => {
    const r = await apiB.post('/vehiculos', {
      token: betaToken,
      body: { cliente_id: betaClienteId, placa: alfaPlaca, marca: 'Toyota', modelo: 'Yaris', anio: 2022, tipo: 'auto' },
    });
    expect(r.status, 'la misma placa puede existir en los dos talleres').toBeLessThan(300);
    return r.json.data.id;
  })();
  const PROBLEMA_BETA = `Orden Beta ${slugB}: ruido de motor`;
  const betaOrden = await crearOrdenDeTaller(apiB, betaToken, betaDb, beta, { clienteId: betaClienteId, vehiculoId: betaVehiculo, problema: PROBLEMA_BETA });
  const betaRecep = await crearStaff(apiB, betaToken, { rol: 'recepcion', nombre: 'Recepción Beta', email: `recep.${slugB}@prueba.test`, sucursalId: await una(betaDb, 'SELECT id FROM sucursales WHERE tenant_id = ? ORDER BY id LIMIT 1', [beta.tallerId]).then((s) => s.id) });

  // ── Sin fugas en los listados ──
  await inyectarSesionStaff(page, { token: betaRecep.token, usuario: betaRecep.usuario, slug: slugB });
  await page.goto('/recepcion/ordenes');
  await expect(page.locator('body')).toContainText(PROBLEMA_BETA, { timeout: 20_000 });
  await expect(page.locator('body')).not.toContainText(`Canario Alfa ${taller.sello}`);
  await expect(page.locator('body')).not.toContainText(alfaOrden.numero);

  await page.goto('/recepcion/clientes');
  await expect(page.locator('body')).toContainText('Camila Vega', { timeout: 20_000 });
  const tarjetas = page.locator('.pg-item, article, .cd');
  expect(await tarjetas.filter({ hasText: alfaOrden.numero }).count()).toBe(0);

  // ── URL forzada de la orden ajena: la UI no muestra nada de Alfa ──
  await page.goto(`/detalle-orden/${alfaOrden.id}`);
  await expect(page.locator('body')).not.toContainText(`Canario Alfa ${taller.sello}`);
  await expect(page.locator('body')).not.toContainText(alfaPlaca);

  // ── API: leer y escribir lo de Alfa desde sesiones de Beta ──
  // Foto de todo lo de Alfa ANTES de los ataques (para comparar después).
  const fotoDeAlfa = async () => {
    const tablas = await filas(
      betaDb,
      "SELECT DISTINCT TABLE_NAME AS t FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = current_schema() AND COLUMN_NAME = 'tenant_id'"
    );
    const foto: Record<string, string> = {};
    for (const { t } of tablas) {
      if (/^motiq_/.test(t) || ['eventos_seguridad', 'sesiones', 'usuarios_sesiones'].includes(t)) continue;
      const filasDeA = await filas(betaDb, `SELECT * FROM "${t}" WHERE tenant_id = ? ORDER BY 1`, [taller.tallerId]);
      foto[t] = JSON.stringify(filasDeA);
    }
    return foto;
  };
  const antes = await fotoDeAlfa();

  const ataques: Array<[string, string, any]> = [
    ['GET', `/ordenes/${alfaOrden.id}`, undefined],
    ['GET', `/clientes/${alfaCliente}`, undefined],
    ['PATCH', `/ordenes/${alfaOrden.id}/estado`, { estado: 'entregada' }],
    ['PATCH', `/ordenes/${alfaOrden.id}/tecnico`, { tecnico_id: betaRecep.id }],
    ['POST', `/ordenes/${alfaOrden.id}/avances`, { descripcion: 'HACK' }],
    ['POST', `/recepcion/cotizaciones/${alfaOrden.id}/repuestos`, { nombre: 'HACK', cantidad: 1, costo_unitario: 1000 }],
    ['PUT', `/clientes/${alfaCliente}`, { nombre: 'Hackeado', apellido: 'x', telefono: '1' }],
  ];
  for (const [metodo, ruta, cuerpo] of ataques) {
    const r = await apiB.pedir(metodo, ruta, { token: betaToken, body: cuerpo });
    expect(r.status, `${metodo} ${ruta}`).toBeGreaterThanOrEqual(400);
    expect(r.status, `${metodo} ${ruta} no revienta con 500`).toBeLessThan(500);
    expect(r.texto, `${metodo} ${ruta} no fuga el canario`).not.toContain('Canario Alfa');
  }

  // ── Portal: el cliente de Beta no ve (ni puede decidir sobre) órdenes de Alfa ──
  await registrarClientePortal(apiB, betaDb, slugB, { nombre: 'Camila', apellido: 'Vega', email: `camila.beta.${taller.sello}@prueba.test` });
  const portalBeta = await loginClientePortal(apiB, slugB, `camila.beta.${taller.sello}@prueba.test`);
  const misOrdenes = await apiB.get('/portal/ordenes', { token: portalBeta.token });
  expect(misOrdenes.status).toBe(200);
  expect(misOrdenes.texto).not.toContain(alfaOrden.numero);
  const cruzada = await apiB.post(`/portal/ordenes/${alfaOrden.id}/aprobar`, { token: portalBeta.token, body: {} });
  expect([400, 404]).toContain(cruzada.status);

  // ── En la base: Alfa quedó IDÉNTICO y nada de Beta apunta a Alfa ──
  const despues = await fotoDeAlfa();
  const cambiadas = Object.keys(antes).filter((t) => antes[t] !== despues[t]);
  expect(cambiadas, `tablas de Alfa tocadas por Beta: ${cambiadas.join(', ')}`).toHaveLength(0);

  const cruzados = await filas(
    betaDb,
    `SELECT
       (SELECT COUNT(*)::int FROM orden_avances WHERE orden_id = ? AND tenant_id <> ?) AS avances,
       (SELECT COUNT(*)::int FROM orden_repuestos WHERE orden_id = ? AND tenant_id <> ?) AS repuestos,
       (SELECT COUNT(*)::int FROM ordenes_trabajo WHERE cliente_id = ? AND tenant_id <> ?) AS clientes`,
    [alfaOrden.id, taller.tallerId, alfaOrden.id, taller.tallerId, alfaCliente, taller.tallerId]
  );
  expect(cruzados[0].avances).toBe(0);
  expect(cruzados[0].repuestos).toBe(0);
  expect(cruzados[0].clientes).toBe(0);
});
