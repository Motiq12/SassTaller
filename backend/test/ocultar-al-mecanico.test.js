const { test } = require('node:test');
const assert = require('node:assert');
const ocultarAlMecanico = require('../src/middleware/ocultar-al-mecanico');
const { limpiar } = ocultarAlMecanico;

// Simula una respuesta: corre el middleware y devuelve lo que habría salido.
function responder(rol, url, body) {
  let enviado;
  const req = { usuario: rol ? { rol } : undefined, originalUrl: url };
  const res = { json: (b) => { enviado = b; return res; } };
  ocultarAlMecanico(req, res, () => {});
  res.json(body);
  return enviado;
}

const orden = {
  id: 8, numero_orden: 'OT-2026-0008', cliente_nombre: 'Pedro', cliente_telefono: '8711-2233',
  costo_mano_obra: '15000.00', costo_repuestos: '52500.00', descuento: '0.00', total: '67500.00',
  total_aprobado: '61000.00', monto_sin_aprobar: 6500, diagnostico: 'Cadena gastada',
};

test('al mecánico: la orden sale sin montos ni teléfono del cliente', () => {
  const r = responder('tecnico', '/api/ordenes/8', { data: orden });
  assert.deepEqual(r, { data: { id: 8, numero_orden: 'OT-2026-0008', cliente_nombre: 'Pedro', diagnostico: 'Cadena gastada' } });
});

test('a recepción y administración la respuesta no cambia', () => {
  assert.deepEqual(responder('recepcion', '/api/ordenes/8', { data: orden }), { data: orden });
  assert.deepEqual(responder('admin', '/api/ordenes/8', { data: orden }), { data: orden });
  assert.deepEqual(responder(undefined, '/api/marca', { data: orden }), { data: orden });
});

test('limpia en cualquier nivel: listas, repuestos y citas', () => {
  const r = limpiar({ data: [{ nombre: 'Cadena', cantidad: 1, costo_unitario: 30000 }, { id: 3, telefono: '8888-0000', monto: 9000 }] }, true);
  assert.deepEqual(r, { data: [{ nombre: 'Cadena', cantidad: 1 }, { id: 3 }] });
});

test('"total" como conteo se deja; como plata de una orden, no', () => {
  assert.deepEqual(limpiar({ promedio: 4.5, total: 12 }, true), { promedio: 4.5, total: 12 });
  assert.deepEqual(limpiar({ numero_orden: 'OT-1', total: 500 }, true), { numero_orden: 'OT-1' });
});

test('el teléfono del propio mecánico y el de recepción se dejan', () => {
  assert.deepEqual(responder('tecnico', '/api/mecanico/perfil', { data: { nombre: 'José', telefono: '8000-1111' } }), { data: { nombre: 'José', telefono: '8000-1111' } });
  assert.deepEqual(responder('tecnico', '/api/mecanico/recepcion-contacto', { data: [{ nombre: 'Ana', telefono: '2666-0000' }] }), { data: [{ nombre: 'Ana', telefono: '2666-0000' }] });
  assert.deepEqual(responder('tecnico', '/api/mecanico/citas', { data: [{ cliente_nombre: 'Pedro', telefono: '8711-2233' }] }), { data: [{ cliente_nombre: 'Pedro' }] });
});

test('las fechas no se rompen', () => {
  const d = new Date('2026-10-24T12:00:00Z');
  assert.deepEqual(limpiar({ created_at: d, monto: 5 }, true), { created_at: d });
});

test('al mecánico: tampoco pasan datos de plata con nombres nuevos (ingresos_*, facturacion_*)', () => {
  const perfil = { completadas: 12, citas_mes: 3, ingresos_generados: 450000, ingresos_mes: 90000, ingreso: 5000, facturacion_hoy: 1, ingresos: 2 };
  assert.deepEqual(responder('tecnico', '/api/mecanico/perfil', { data: perfil }), { data: { completadas: 12, citas_mes: 3 } });
  assert.deepEqual(responder('admin', '/api/mecanico/perfil', { data: perfil }), { data: perfil });
});
