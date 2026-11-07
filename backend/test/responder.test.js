const { test } = require('node:test');
const assert = require('node:assert');
const { fail, invalido } = require('../src/utils/responder');

// res falso que captura status() y json()
function fakeRes() {
  return {
    _status: null,
    _body: null,
    status(code) { this._status = code; return this; },
    json(body) { this._body = body; return this; },
  };
}

// Silencia el console.error que fail() emite a propósito.
function silenciandoErrores(fn) {
  const orig = console.error;
  console.error = () => {};
  try { fn(); } finally { console.error = orig; }
}

test('responde 500 con un código corto y no filtra el mensaje interno', () => {
  silenciandoErrores(() => {
    const res = fakeRes();
    fail(res, new Error('detalle interno con SQL secreto'));
    assert.equal(res._status, 500);
    assert.match(res._body.error, /^Falló el servidor \(código [0-9A-F]{4}\)\.$/);
    assert.equal(res._body.codigo_error, res._body.error.match(/código ([0-9A-F]{4})/)[1]);
    assert.ok(!JSON.stringify(res._body).includes('SQL secreto'), 'no debe filtrar el detalle');
  });
});

test('acepta un status personalizado', () => {
  silenciandoErrores(() => {
    const res = fakeRes();
    fail(res, new Error('x'), 503);
    assert.equal(res._status, 503);
  });
});

// Errores de MySQL que describen un dato inválido del cliente, no una falla del
// servidor. Devolverlos como 500 hacía que un formulario mal llenado se viera igual
// que una caída real, tanto para el cliente como en el monitoreo.
test('los errores de dato inválido salen como 400, no 500', () => {
  for (const code of ['ER_NO_REFERENCED_ROW_2', 'ER_DUP_ENTRY', 'ER_DATA_TOO_LONG', 'ER_BAD_NULL_ERROR']) {
    const res = fakeRes();
    const origWarn = console.warn; console.warn = () => {};
    try { fail(res, { code, message: 'x', sqlMessage: 'x' }); } finally { console.warn = origWarn; }
    assert.equal(res._status, 400, `${code} debería ser 400`);
    assert.ok(res._body.error && !res._body.error.startsWith('Falló el servidor'),
      `${code} debería explicar qué pasó`);
  }
});

test('un error inesperado sigue siendo 500 y no filtra el detalle', () => {
  const res = fakeRes();
  const origError = console.error; console.error = () => {};
  try { fail(res, new Error('SELECT secreto FROM interna')); } finally { console.error = origError; }
  assert.equal(res._status, 500);
  assert.ok(res._body.error.startsWith('Falló el servidor'));
  assert.ok(!JSON.stringify(res._body).includes('secreto'));
});

// Cuando MySQL dice la columna, la respuesta lleva el campo para marcarlo en pantalla.
test('dice el campo cuando MySQL lo nombra', () => {
  const casos = [
    [{ code: 'ER_DATA_TOO_LONG', sqlMessage: "Data too long for column 'nombre' at row 1" }, 'nombre', 'El nombre es demasiado largo'],
    [{ code: 'ER_BAD_NULL_ERROR', sqlMessage: "Column 'motivo' cannot be null" }, 'motivo', 'Falta el motivo'],
    [{ code: 'ER_DUP_ENTRY', sqlMessage: "Duplicate entry 'a@b.cr' for key 'usuarios.email'" }, 'email', 'Ese correo ya está registrado'],
    [{ code: 'ER_DUP_ENTRY', sqlMessage: "Duplicate entry 'ABC123' for key 'motos.uq_motos_placa_norm'" }, 'placa', 'Esa placa ya está registrada'],
  ];
  const origWarn = console.warn; console.warn = () => {};
  try {
    for (const [err, campo, mensaje] of casos) {
      const res = fakeRes();
      fail(res, err);
      assert.equal(res._status, 400);
      assert.deepEqual(res._body, { error: mensaje, campo });
    }
  } finally { console.warn = origWarn; }
});

test('invalido() responde 400 con el mensaje y el campo', () => {
  const res = fakeRes();
  invalido(res, 'email', 'El correo no tiene un formato válido');
  assert.equal(res._status, 400);
  assert.deepEqual(res._body, { error: 'El correo no tiene un formato válido', campo: 'email' });
});
