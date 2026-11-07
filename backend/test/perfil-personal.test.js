const test = require('node:test');
const assert = require('node:assert');
const { describirAgente } = require('../src/utils/sesiones');
const { normalizarPreferencias, AVISOS } = require('../src/utils/preferencias');

test('describirAgente: nombra navegador y sistema', () => {
  assert.strictEqual(describirAgente('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 Edg/130.0'), 'Edge en Windows');
  assert.strictEqual(describirAgente('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'), 'Chrome en Windows');
  assert.strictEqual(describirAgente('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'), 'Safari en iPhone o iPad');
  assert.strictEqual(describirAgente('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0; rv:131.0) Gecko/20100101 Firefox/131.0'), 'Firefox en Mac');
});

test('describirAgente: la app de Android (WebView) y lo desconocido', () => {
  assert.strictEqual(describirAgente('Mozilla/5.0 (Linux; Android 14; SM-A145M Build/UP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0 Mobile Safari/537.36'), 'App de Android');
  assert.strictEqual(describirAgente(''), 'Dispositivo desconocido');
  assert.strictEqual(describirAgente(undefined), 'Dispositivo desconocido');
  assert.strictEqual(describirAgente('curl/8.0'), 'Navegador');
});

test('normalizarPreferencias: la pantalla de inicio tiene que ser del panel del rol', () => {
  assert.strictEqual(normalizarPreferencias({ inicio: '/admin/citas' }, 'admin').inicio, '/admin/citas');
  assert.strictEqual(normalizarPreferencias({ inicio: '/admin/citas' }, 'recepcion').inicio, null);
  assert.strictEqual(normalizarPreferencias({ inicio: '/mecanico/tareas' }, 'tecnico').inicio, '/mecanico/tareas');
  assert.strictEqual(normalizarPreferencias({ inicio: 'https://otro.sitio/admin/x' }, 'admin').inicio, null);
  assert.strictEqual(normalizarPreferencias({ inicio: '/admin/../portal' }, 'admin').inicio, null);
});

test('normalizarPreferencias: sede y avisos', () => {
  assert.strictEqual(normalizarPreferencias({ sede_id: '2' }, 'admin').sede_id, 2);
  assert.strictEqual(normalizarPreferencias({ sede_id: -1 }, 'admin').sede_id, null);
  assert.strictEqual(normalizarPreferencias({ sede_id: 'x' }, 'admin').sede_id, null);
  // Solo los avisos que existen para su rol, sin repetir.
  assert.deepStrictEqual(normalizarPreferencias({ avisos_off: ['foto', 'foto', 'mensaje', 'inventado'] }, 'recepcion').avisos_off, ['foto']);
  assert.deepStrictEqual(normalizarPreferencias({ avisos_off: ['mensaje'] }, 'tecnico').avisos_off, ['mensaje']);
  assert.deepStrictEqual(normalizarPreferencias({ avisos_off: ['foto'] }, 'admin').avisos_off, []);
  assert.deepStrictEqual(normalizarPreferencias(null, 'admin'), { inicio: null, sede_id: null, avisos_off: [] });
  assert.ok(AVISOS.recepcion.includes('cita_nueva'));
});
