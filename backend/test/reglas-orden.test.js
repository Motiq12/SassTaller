const { test } = require('node:test');
const assert = require('node:assert');
const {
  estadosSiguientes, avisosDeCambio, necesitaReaprobacion, montoSinAprobar,
} = require('../src/utils/reglas-orden');

const tipos = (avisos) => avisos.map((a) => a.tipo);

test('siguientes: cancelar solo lo ve admin', () => {
  assert.deepEqual(estadosSiguientes('recepcion', 'tecnico'), ['diagnostico', 'en_reparacion']);
  assert.deepEqual(estadosSiguientes('recepcion', 'admin'), ['diagnostico', 'en_reparacion', 'cancelada']);
});

test('siguientes: salen de la misma tabla que valida el backend', () => {
  // Antes la pantalla tenía su propia lista y no ofrecía volver a reparación desde
  // "Lista para entrega" (si la prueba de manejo falla) aunque el backend lo permite.
  assert.deepEqual(estadosSiguientes('lista_entrega', 'tecnico'), ['en_reparacion']);
  assert.deepEqual(estadosSiguientes('en_reparacion', 'tecnico'), ['lista_entrega', 'esperando_repuestos']);
  assert.deepEqual(estadosSiguientes('entregada', 'admin'), []);
  assert.deepEqual(estadosSiguientes('inventado', 'admin'), []);
});

test('avisos: a reparación con repuestos que no han llegado', () => {
  const avisos = avisosDeCambio({
    desde: 'esperando_repuestos', hacia: 'en_reparacion', aprobacion: 'aprobado', fotosIngreso: 2,
    repuestos: [
      { nombre: 'Kit de arrastre', cantidad: 1, estado: 'disponible' },
      { nombre: 'Pastillas', cantidad: 2, estado: 'pedido_especial' },
      { nombre: 'Filtro', cantidad: 1, estado: 'solicitado' },
    ],
  });
  assert.deepEqual(tipos(avisos), ['repuestos_faltantes']);
  assert.equal(avisos[0].mensaje, 'Faltan 2 repuestos por llegar.');
  assert.deepEqual(avisos[0].detalle, ['Pastillas ×2 — Pedido especial', 'Filtro — Solicitado por el mecánico']);
});

test('avisos: todos los repuestos disponibles no avisa', () => {
  const avisos = avisosDeCambio({
    desde: 'esperando_repuestos', hacia: 'en_reparacion', aprobacion: 'aprobado', fotosIngreso: 1,
    repuestos: [{ nombre: 'Llanta', cantidad: 1, estado: 'disponible' }],
  });
  assert.deepEqual(avisos, []);
});

test('avisos: salir de recepción sin fotos de ingreso', () => {
  assert.deepEqual(tipos(avisosDeCambio({ desde: 'recepcion', hacia: 'diagnostico', fotosIngreso: 0 })), ['fotos_ingreso']);
  assert.deepEqual(avisosDeCambio({ desde: 'recepcion', hacia: 'diagnostico', fotosIngreso: 3 }), []);
  // Las fotos solo se piden al salir de recepción, no en cada paso.
  assert.deepEqual(avisosDeCambio({ desde: 'diagnostico', hacia: 'esperando_aprobacion', fotosIngreso: 0 }), []);
});

test('avisos: trabajar sin que el cliente apruebe', () => {
  const sinAprobar = avisosDeCambio({ desde: 'diagnostico', hacia: 'en_reparacion', aprobacion: 'pendiente', fotosIngreso: 1 });
  assert.deepEqual(tipos(sinAprobar), ['sin_aprobacion']);
  const rechazado = avisosDeCambio({ desde: 'esperando_aprobacion', hacia: 'esperando_repuestos', aprobacion: 'rechazado', fotosIngreso: 1 });
  assert.deepEqual(tipos(rechazado), ['sin_aprobacion']);
  assert.deepEqual(avisosDeCambio({ desde: 'diagnostico', hacia: 'en_reparacion', aprobacion: 'aprobado', fotosIngreso: 1 }), []);
});

test('avisos: cancelar nunca pregunta nada', () => {
  assert.deepEqual(avisosDeCambio({ desde: 'recepcion', hacia: 'cancelada', fotosIngreso: 0 }), []);
});

test('avisos: se juntan si hay varios', () => {
  const avisos = avisosDeCambio({
    desde: 'diagnostico', hacia: 'en_reparacion', aprobacion: 'pendiente', fotosIngreso: 0,
    repuestos: [{ nombre: 'Cadena', cantidad: 1, estado: 'pendiente' }],
  });
  assert.deepEqual(tipos(avisos), ['sin_aprobacion', 'repuestos_faltantes']);
});

const aprobada = { estado: 'en_reparacion', aprobacion: 'aprobado', totalAprobado: 50000 };

test('reaprobación: sube por encima de lo aprobado con el trabajo en marcha', () => {
  assert.equal(necesitaReaprobacion({ ...aprobada, totalAntes: 50000, totalDespues: 62000 }), true);
  assert.equal(necesitaReaprobacion({ ...aprobada, estado: 'esperando_repuestos', totalAntes: 50000, totalDespues: 51000 }), true);
  assert.equal(necesitaReaprobacion({ ...aprobada, estado: 'lista_entrega', totalAntes: 50000, totalDespues: 51000 }), true);
});

test('reaprobación: no si baja, se queda igual o no pasa lo aprobado', () => {
  assert.equal(necesitaReaprobacion({ ...aprobada, totalAntes: 50000, totalDespues: 50000 }), false);
  assert.equal(necesitaReaprobacion({ ...aprobada, totalAntes: 50000, totalDespues: 45000 }), false);
  // Quitó un repuesto y puso otro más barato: sube respecto de antes, pero no pasa lo aprobado.
  assert.equal(necesitaReaprobacion({ ...aprobada, totalAntes: 40000, totalDespues: 48000 }), false);
});

test('reaprobación: no repite si el cliente ya rechazó el adicional y se edita otra cosa', () => {
  // Total 62 000 sobre 50 000 aprobados; se marca un repuesto como disponible sin
  // cambiar precios: el total no sube con este cambio.
  assert.equal(necesitaReaprobacion({ ...aprobada, totalAntes: 62000, totalDespues: 62000 }), false);
});

test('reaprobación: solo cuando ya había aprobado y en estados de trabajo', () => {
  assert.equal(necesitaReaprobacion({ ...aprobada, aprobacion: 'pendiente', totalAntes: 0, totalDespues: 90000 }), false);
  assert.equal(necesitaReaprobacion({ ...aprobada, totalAprobado: null, totalAntes: 0, totalDespues: 90000 }), false);
  assert.equal(necesitaReaprobacion({ ...aprobada, estado: 'diagnostico', totalAntes: 50000, totalDespues: 90000 }), false);
  assert.equal(necesitaReaprobacion({ ...aprobada, estado: 'entregada', totalAntes: 50000, totalDespues: 90000 }), false);
});

test('monto sin aprobar', () => {
  assert.equal(montoSinAprobar(62000, 50000), 12000);
  assert.equal(montoSinAprobar(50000, 50000), 0);
  assert.equal(montoSinAprobar(40000, 50000), 0);
  assert.equal(montoSinAprobar(62000, null), 0);
  assert.equal(montoSinAprobar('50000.50', '50000.00'), 0.5);
});

test('editar repuesto: sin estado nuevo, respeta el que tenía', () => {
  const { estadoAlEditarRepuesto } = require('../src/utils/reglas-orden');
  // La pantalla de cotizaciones solo manda precio y cantidad: antes un repuesto que
  // ya había llegado volvía a "pendiente".
  assert.equal(estadoAlEditarRepuesto('disponible', undefined, 9000), 'disponible');
  assert.equal(estadoAlEditarRepuesto('pedido_especial', '', 9000), 'pedido_especial');
  assert.equal(estadoAlEditarRepuesto('solicitado', undefined, 9000), 'pendiente');
  assert.equal(estadoAlEditarRepuesto('solicitado', undefined, 0), 'solicitado');
  assert.equal(estadoAlEditarRepuesto('pendiente', 'disponible', 9000), 'disponible');
});
