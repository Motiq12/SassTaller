const { test } = require('node:test');
const assert = require('node:assert');

// Roles propios (Equipo → Roles): las casillas que se eligen, lo que se descarta y
// que el servidor las respete sin quitarle nada a los roles de fábrica.

// Base falsa para el middleware: usuarios y roles en memoria. Se pone en la caché de
// módulos antes de cargarlo, para que no abra una conexión de verdad.
const db = { usuarios: [], roles: [] };
const pool = {
  async query(sql, params = []) {
    if (/FROM usuarios WHERE id = \?/.test(sql)) return [db.usuarios.filter((u) => u.id === params[0])];
    if (/FROM roles WHERE tenant_id = \? AND \(id = \? OR clave = \?\)/.test(sql)) {
      return [db.roles.filter((r) => r.id === params[1] || r.clave === params[2])];
    }
    throw new Error('Consulta no prevista en la prueba: ' + sql);
  },
};
require.cache[require.resolve('../src/db/pool')] = { id: 'pool', filename: 'pool', loaded: true, exports: { pool } };

const {
  ROLES_FABRICA, TODOS, FIJAS, ajustables, techo, permisosEfectivos, puede, validarRolPropio,
} = require('../src/utils/permisos');
const { exigirPermiso, permisosDeUsuario } = require('../src/middleware/permisos');

const fabrica = (clave) => ROLES_FABRICA.find((r) => r.clave === clave);

test('las ajustables de cada base son su techo menos las fijas', () => {
  for (const base of ['mostrador', 'taller']) {
    for (const p of ajustables(base)) {
      assert.ok(techo(base).includes(p), `${p} está en el techo de ${base}`);
      assert.ok(!FIJAS[base].includes(p), `${p} no es fija en ${base}`);
    }
  }
  assert.ok(ajustables('mostrador').includes('ordenes.entregar'));
  assert.ok(!ajustables('mostrador').includes('ordenes.facturar'), 'facturar queda fija');
  assert.deepStrictEqual(ajustables('administracion'), []);
  assert.deepStrictEqual(ajustables('web'), []);
});

test('los roles de fábrica, con sus casillas de siempre, pueden todo lo que podían', () => {
  for (const clave of ['recepcion', 'tecnico']) {
    const efectivos = permisosEfectivos(clave, { base: clave === 'recepcion' ? 'mostrador' : 'taller', permisos: fabrica(clave).permisos });
    for (const p of TODOS) {
      assert.strictEqual(puede(clave, efectivos, p), true, `${clave} sigue pudiendo ${p}`);
    }
  }
});

test('administración puede todo, aunque le llegue un rol con menos', () => {
  assert.deepStrictEqual(permisosEfectivos('admin', { base: 'mostrador', permisos: [] }).sort(), [...TODOS].sort());
  assert.strictEqual(puede('admin', [], 'ordenes.eliminar'), true);
});

test('un rol propio quita lo ajustable, pero las fijas quedan siempre', () => {
  const efectivos = permisosEfectivos('recepcion', { base: 'mostrador', permisos: ['citas.agendar'] });
  assert.strictEqual(puede('recepcion', efectivos, 'citas.agendar'), true);
  assert.strictEqual(puede('recepcion', efectivos, 'ordenes.entregar'), false);
  assert.strictEqual(puede('recepcion', efectivos, 'clientes.eliminar'), false);
  for (const fija of FIJAS.mostrador) assert.ok(efectivos.includes(fija), `${fija} queda`);
});

test('nada pasa del techo: lo que no es de la base se descarta', () => {
  // Alguien metió a mano casillas de administración en un rol de Mostrador.
  const efectivos = permisosEfectivos('recepcion', { base: 'mostrador', permisos: ['ordenes.eliminar', 'equipo.empleados'] });
  assert.ok(!efectivos.includes('ordenes.eliminar'));
  assert.ok(!efectivos.includes('equipo.empleados'));
});

test('un rol de otra base no se aplica: vale el de fábrica', () => {
  // Un mecánico con un rol de Mostrador asignado (no debería pasar): se ignora.
  const efectivos = permisosEfectivos('tecnico', { base: 'mostrador', permisos: [] });
  assert.deepStrictEqual(efectivos.sort(), permisosEfectivos('tecnico', null).sort());
  assert.ok(efectivos.includes('taller.repuestos'));
});

test('una casilla que no es ajustable para la base no se revisa', () => {
  // Al mecánico no se le eligen costos: decide la ruta, como antes.
  const efectivos = permisosEfectivos('tecnico', { base: 'taller', permisos: [] });
  assert.strictEqual(puede('tecnico', efectivos, 'ordenes.costos'), true);
  assert.strictEqual(puede('tecnico', efectivos, 'taller.repuestos'), false);
});

test('validar un rol propio', () => {
  assert.strictEqual(validarRolPropio({ nombre: 'A', base: 'mostrador' }).campo, 'nombre');
  assert.strictEqual(validarRolPropio({ nombre: 'Atención', base: 'administracion' }).campo, 'base');
  assert.strictEqual(validarRolPropio({ nombre: 'Atención', base: 'mostrador', permisos: 'todo' }).campo, 'permisos');
  assert.strictEqual(validarRolPropio({ nombre: 'Atención', base: 'mostrador', permisos: ['inventado'] }).campo, 'permisos');
  const deMas = validarRolPropio({ nombre: 'Atención', base: 'mostrador', permisos: ['ordenes.eliminar'] });
  assert.strictEqual(deMas.campo, 'permisos');
  assert.match(deMas.error, /Eliminar órdenes/);
  assert.match(validarRolPropio({ nombre: 'x'.repeat(61), base: 'taller' }).error, /60/);

  const ok = validarRolPropio({ nombre: '  Atención al cliente ', base: 'mostrador', permisos: ['citas.agendar', 'citas.ver', 'citas.agendar'] });
  assert.deepStrictEqual(ok.datos, { nombre: 'Atención al cliente', base: 'mostrador', descripcion: null, permisos: ['citas.agendar'] });
  // Al editar, la base es la del rol aunque venga otra.
  assert.strictEqual(validarRolPropio({ nombre: 'Aprendiz', base: 'mostrador' }, { baseFija: 'taller' }).datos.base, 'taller');
});

// ── El middleware, contra la base falsa ──
function preparar() {
  db.roles = [
    { id: 1, clave: 'admin', nombre: 'Administrador', base: 'administracion', permisos: JSON.stringify(fabrica('admin').permisos) },
    { id: 2, clave: 'recepcion', nombre: 'Recepción', base: 'mostrador', permisos: JSON.stringify(fabrica('recepcion').permisos) },
    { id: 3, clave: 'tecnico', nombre: 'Mecánico', base: 'taller', permisos: JSON.stringify(fabrica('tecnico').permisos) },
    { id: 10, clave: null, nombre: 'Atención al cliente', base: 'mostrador', permisos: JSON.stringify(['citas.agendar']) },
    { id: 11, clave: null, nombre: 'Aprendiz', base: 'taller', permisos: JSON.stringify([]) },
  ];
  db.usuarios = [
    { id: 1, rol: 'admin', rol_id: null },
    { id: 2, rol: 'recepcion', rol_id: null },
    { id: 3, rol: 'recepcion', rol_id: 10 },
    { id: 4, rol: 'tecnico', rol_id: 11 },
    { id: 5, rol: 'recepcion', rol_id: 99 }, // su rol se borró
    { id: 6, rol: 'tecnico', rol_id: 10 }, // rol de otra base
  ];
}

function llamar(mw, usuarioId, body = {}) {
  return new Promise((resolve) => {
    const req = { usuario: { id: usuarioId }, body };
    const res = { status(c) { this.codigo = c; return this; }, json(j) { resolve({ codigo: this.codigo, cuerpo: j }); } };
    mw(req, res, (err) => resolve({ siguio: !err, err }));
  });
}

test('exigirPermiso deja pasar o responde 403 con la casilla', async () => {
  preparar();
  assert.deepStrictEqual(await llamar(exigirPermiso('ordenes.entregar'), 2), { siguio: true, err: undefined });
  const negado = await llamar(exigirPermiso('ordenes.entregar'), 3);
  assert.strictEqual(negado.codigo, 403);
  assert.strictEqual(negado.cuerpo.codigo, 'sin_permiso');
  assert.strictEqual(negado.cuerpo.permiso, 'ordenes.entregar');
  assert.match(negado.cuerpo.error, /entregar y cobrar/);
  assert.strictEqual((await llamar(exigirPermiso('citas.agendar'), 3)).siguio, true);
  assert.strictEqual((await llamar(exigirPermiso('ordenes.eliminar'), 1)).siguio, true);
});

test('exigirPermiso elige la casilla según la petición', async () => {
  preparar();
  const mw = exigirPermiso((req) => (req.body.estado === 'cancelado' ? 'citas.cancelar' : 'citas.agendar'));
  assert.strictEqual((await llamar(mw, 3, { estado: 'en_revision' })).siguio, true);
  assert.strictEqual((await llamar(mw, 3, { estado: 'cancelado' })).codigo, 403);
});

test('un mecánico con un rol propio sin repuestos no los puede pedir, y sigue trabajando', async () => {
  preparar();
  assert.strictEqual((await llamar(exigirPermiso('taller.repuestos'), 4)).codigo, 403);
  assert.strictEqual((await llamar(exigirPermiso('ordenes.estado'), 4)).siguio, true);
});

test('si el rol propio se borró o es de otra base, vale el de fábrica', async () => {
  preparar();
  const borrado = await permisosDeUsuario(5);
  assert.strictEqual(borrado.rolId, null);
  assert.strictEqual(borrado.rolNombre, 'Recepción');
  assert.ok(borrado.permisos.includes('ordenes.entregar'));
  const otraBase = await permisosDeUsuario(6);
  assert.strictEqual(otraBase.rolId, null);
  assert.ok(otraBase.permisos.includes('taller.repuestos'));
});

test('el panel recibe las ajustables para esconder botones', async () => {
  preparar();
  assert.deepStrictEqual((await permisosDeUsuario(1)).ajustables, []);
  const atencion = await permisosDeUsuario(3);
  assert.strictEqual(atencion.rolNombre, 'Atención al cliente');
  assert.ok(atencion.ajustables.includes('ordenes.entregar'));
  assert.ok(!atencion.permisos.includes('ordenes.entregar'));
});
