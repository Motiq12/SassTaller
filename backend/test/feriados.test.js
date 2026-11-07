const { test } = require('node:test');
const assert = require('node:assert');

// Feriados que se repiten: fechas válidas, próxima vez que caen y que la agenda los
// bloquee enteros.
const { FERIADOS_CR, fechaValida, caeEn, proximaFecha } = require('../src/utils/feriados');
const { agendaRango } = require('../src/utils/agenda');

test('fechaValida acepta el 29 de febrero y rechaza lo que no existe', () => {
  assert.ok(fechaValida(2, 29));
  assert.ok(fechaValida(7, 25));
  assert.ok(!fechaValida(2, 30));
  assert.ok(!fechaValida(4, 31));
  assert.ok(!fechaValida(13, 1));
  assert.ok(!fechaValida(1, 0));
  assert.ok(!fechaValida(1.5, 2));
});

test('los feriados de ley son fechas válidas y sin repetir', () => {
  for (const f of FERIADOS_CR) assert.ok(fechaValida(f.mes, f.dia), f.nombre);
  assert.strictEqual(new Set(FERIADOS_CR.map((f) => `${f.mes}-${f.dia}`)).size, FERIADOS_CR.length);
});

test('caeEn compara mes y día, sin importar el año', () => {
  assert.ok(caeEn('2027-07-25', { mes: 7, dia: 25 }));
  assert.ok(caeEn('2031-01-01', { mes: 1, dia: 1 }));
  assert.ok(!caeEn('2027-07-26', { mes: 7, dia: 25 }));
});

test('proximaFecha: este año si no pasó, si no el siguiente; el 29-feb salta al bisiesto', () => {
  assert.strictEqual(proximaFecha(12, 25, '2026-10-24'), '2026-12-25');
  assert.strictEqual(proximaFecha(7, 25, '2026-10-24'), '2027-07-25');
  assert.strictEqual(proximaFecha(10, 24, '2026-10-24'), '2026-10-24');
  assert.strictEqual(proximaFecha(2, 29, '2026-10-24'), '2028-02-29');
});

// Una base falsa para agendaRango: sin citas ni bloqueos, con un feriado.
function baseCon(feriados) {
  const pedidos = [];
  return {
    pedidos,
    async query(sql, params) {
      pedidos.push({ sql, params });
      if (/FROM feriados/.test(sql)) {
        if (feriados instanceof Error) throw feriados;
        return [feriados];
      }
      return [[]];
    },
  };
}
const config = { horarios: [0, 1, 2, 3, 4, 5, 6].map((dia) => ({ dia, abre: '08:00', cierra: '12:00', activo: 1 })) };

test('la agenda bloquea el feriado entero, todos los años', async () => {
  const db = baseCon([{ mes: 7, dia: 25, nombre: 'Anexión del Partido de Nicoya' }]);
  const agenda = await agendaRango('2027-07-24', '2027-07-26', 1, config, { db });
  assert.deepStrictEqual(Object.keys(agenda['2027-07-25'].bloqueadas), ['08:00', '09:00', '10:00', '11:00']);
  assert.strictEqual(agenda['2027-07-25'].bloqueadas['08:00'], 'Feriado: Anexión del Partido de Nicoya');
  assert.deepStrictEqual(agenda['2027-07-24'].bloqueadas, {});
  assert.deepStrictEqual(agenda['2027-07-26'].bloqueadas, {});
  // Con sede: los de todas las sedes y los de esa.
  const q = db.pedidos.find((p) => /FROM feriados/.test(p.sql));
  assert.match(q.sql, /sucursal_id IS NULL OR sucursal_id = \?/);
  assert.deepStrictEqual(q.params, [1]);
});

test('si no se pueden leer los feriados, la agenda sigue funcionando', async () => {
  const original = console.error;
  console.error = () => {};
  try {
    const agenda = await agendaRango('2027-07-25', '2027-07-25', null, config, { db: baseCon(new Error('ER_NO_SUCH_TABLE')) });
    assert.deepStrictEqual(agenda['2027-07-25'].bloqueadas, {});
    assert.strictEqual(agenda['2027-07-25'].horas.length, 4);
  } finally {
    console.error = original;
  }
});
