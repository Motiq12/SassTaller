const { test } = require('node:test');
const assert = require('node:assert');
const { soloSucursal, sucursalParaGuardar } = require('../src/utils/alcance');
const { CATALOGO, TODOS, ROLES_FABRICA } = require('../src/utils/permisos');

test('quien ve las dos sucursales no tiene filtro', () => {
  assert.equal(soloSucursal({ sucursalAlcance: null }, 'o.sucursal_id'), '');
});

test('quien tiene una sucursal ve la suya y lo que no tiene sucursal', () => {
  assert.equal(soloSucursal({ sucursalAlcance: 2 }, 'o.sucursal_id'), ' AND (o.sucursal_id = 2 OR o.sucursal_id IS NULL)');
});

test('lo nuevo se guarda en la sucursal del empleado, aunque pida otra', () => {
  assert.equal(sucursalParaGuardar({ sucursalAlcance: 1 }, 2), 1);
  assert.equal(sucursalParaGuardar({ sucursalAlcance: null }, 2), 2);
  assert.equal(sucursalParaGuardar({ sucursalAlcance: null }, null), null);
});

test('el catálogo no repite casillas', () => {
  assert.equal(new Set(TODOS).size, TODOS.length);
  assert.ok(CATALOGO.every((g) => g.permisos.length > 0));
});

test('los roles de fábrica solo usan casillas que existen, y el administrador las tiene todas', () => {
  for (const r of ROLES_FABRICA) for (const p of r.permisos) assert.ok(TODOS.includes(p), `${r.clave}: ${p}`);
  assert.deepEqual(ROLES_FABRICA.find((r) => r.clave === 'admin').permisos, TODOS);
});

test('recepción no elimina órdenes ni toca la configuración; el mecánico no ve precios', () => {
  const rec = ROLES_FABRICA.find((r) => r.clave === 'recepcion').permisos;
  const mec = ROLES_FABRICA.find((r) => r.clave === 'tecnico').permisos;
  assert.ok(!rec.includes('ordenes.eliminar') && !rec.some((p) => p.startsWith('config.')));
  assert.ok(!mec.includes('ordenes.precios'));
});
