const { test } = require('node:test');
const assert = require('node:assert');
const {
  PLANES, DIAS_TRIAL, limitesDe, diasRestantes, finDeTrial, mensajeTope,
} = require('../src/utils/limites');

// 15 de enero de 2026, 02:00 UTC. En CR (offset -6) son las 20:00 del 14 → el día local
// es el 14. Es el mismo anclaje que usa fecha.test.js, y acá importa: el contador de
// días se calcula contra el día del taller, no contra el del servidor.
const AHORA = Date.parse('2026-01-15T02:00:00Z');

test('cada plan declarado tiene sus límites', () => {
  for (const plan of PLANES) {
    const l = limitesDe(plan);
    assert.ok(l, `el plan ${plan} no tiene límites definidos`);
    assert.equal(typeof l.marca_propia, 'boolean');
  }
});

test('el plan gratuito acota estructura, nunca operación', () => {
  const l = limitesDe('gratis');
  assert.equal(l.usuarios, 2);
  assert.equal(l.sucursales, 1);
  assert.equal(l.marca_propia, false);
  // La ausencia es la regla de fondo del modelo: si alguien agrega un tope de órdenes o
  // de clientes, este test tiene que fallar.
  assert.equal(l.ordenes, undefined);
  assert.equal(l.clientes, undefined);
  assert.equal(l.vehiculos, undefined);
});

test('la prueba y el plan pago no tienen topes', () => {
  for (const plan of ['trial', 'pro']) {
    const l = limitesDe(plan);
    assert.equal(l.usuarios, null);
    assert.equal(l.sucursales, null);
    assert.equal(l.marca_propia, true);
  }
});

test('un plan desconocido cae en el MÁS permisivo, no en el más estricto', () => {
  // Un valor raro solo puede venir de un error nuestro (los escribe el panel de Motiq).
  // Capar por eso la cuenta de alguien que paga es el peor de los dos desenlaces.
  for (const raro of ['enterprise', '', null, undefined]) {
    assert.equal(limitesDe(raro).usuarios, null);
    assert.equal(limitesDe(raro).marca_propia, true);
  }
});

test('diasRestantes cuenta contra el día local del taller', () => {
  // Día local: 2026-01-14.
  assert.equal(diasRestantes('2026-01-20', AHORA), 6);
  assert.equal(diasRestantes('2026-01-15', AHORA), 1);
  assert.equal(diasRestantes('2026-01-14', AHORA), 0);   // vence hoy: todavía le queda el día
  assert.equal(diasRestantes('2026-01-13', AHORA), -1);  // ya venció
});

test('diasRestantes tolera lo que no es una fecha', () => {
  assert.equal(diasRestantes(null, AHORA), null);
  assert.equal(diasRestantes('', AHORA), null);
  assert.equal(diasRestantes('cualquier cosa', AHORA), null);
});

test('diasRestantes acepta una fecha con hora (como la devolvería el driver)', () => {
  assert.equal(diasRestantes('2026-01-20T00:00:00.000Z', AHORA), 6);
});

test('finDeTrial cae exactamente a los 30 días del alta', () => {
  const fin = finDeTrial(AHORA);
  assert.equal(fin, '2026-02-13');                       // 14 de enero + 30
  assert.equal(diasRestantes(fin, AHORA), DIAS_TRIAL);
});

test('el mensaje del tope dice el número y ofrece la salida', () => {
  const m = mensajeTope('usuarios', 2);
  assert.match(m, /2 usuarios/);
  assert.match(m, /Pro/);
  // Nunca se lee como un problema de permisos: quien llegó al tope no hizo nada mal.
  assert.doesNotMatch(m, /permiso|autorizado|prohibido/i);
});

test('el mensaje concuerda en singular cuando el tope es uno', () => {
  assert.match(mensajeTope('sucursales', 1), /una sucursal\b/);
});
