// referenciaAjena: que cada id del cuerpo sea del taller (ver utils/referencias.js).
// Con una base falsa: alcanza con saber qué filas "existen" en este taller.
const test = require('node:test');
const assert = require('node:assert');
const { referenciaAjena } = require('../src/utils/referencias');

// Del taller: cliente 1 (con vehículo 10), cliente 2, mecánico 5, persona 6, orden 7, cita 8.
const db = {
  query: async (sql, [id]) => {
    if (/FROM clientes/.test(sql)) return [[[1, 2].includes(id) ? { id } : undefined]];
    if (/FROM usuarios/.test(sql) && /rol = 'tecnico'/.test(sql)) return [[id === 5 ? { id } : undefined]];
    if (/FROM usuarios/.test(sql)) return [[[5, 6].includes(id) ? { id } : undefined]];
    if (/FROM ordenes_trabajo/.test(sql)) return [[id === 7 ? { id } : undefined]];
    if (/FROM citas/.test(sql)) return [[id === 8 ? { id } : undefined]];
    if (/FROM vehiculos/.test(sql)) return [[id === 10 ? { cliente_id: 1 } : undefined]];
    throw new Error('consulta inesperada: ' + sql);
  },
};

test('ids del taller pasan; vacíos no se revisan', async () => {
  assert.strictEqual(await referenciaAjena(db, { cliente_id: 1, vehiculo_id: 10, tecnico_id: 5, destino_id: 6, orden_id: 7, cita_id: 8 }), null);
  assert.strictEqual(await referenciaAjena(db, { cliente_id: '', vehiculo_id: null, tecnico_id: undefined }), null);
});

test('un id de otro taller se rechaza con su campo', async () => {
  for (const [campo, valor] of [['cliente_id', 99], ['tecnico_id', 99], ['tecnico_id', 6], ['destino_id', 99], ['orden_id', 99], ['cita_id', 99], ['vehiculo_id', 99]]) {
    const r = await referenciaAjena(db, { [campo]: valor });
    assert.strictEqual(r && r.campo, campo, `${campo}=${valor}`);
  }
});

test('el vehículo tiene que ser del cliente', async () => {
  assert.strictEqual((await referenciaAjena(db, { cliente_id: 2, vehiculo_id: 10 })).campo, 'vehiculo_id');
});

test('un id que no es un número se rechaza sin consultar', async () => {
  for (const v of ['1 OR 1=1', -3, 'abc', 1.5]) assert.strictEqual((await referenciaAjena(db, { cliente_id: v })).campo, 'cliente_id');
});
