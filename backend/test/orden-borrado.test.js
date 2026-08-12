const { test } = require('node:test');
const assert = require('node:assert');
const { ordenarPorDependencias } = require('../src/utils/orden-borrado');

// Comprueba que ninguna tabla se borre antes que otra que la referencia.
function esOrdenValido(orden, grafo) {
  const posicion = new Map(orden.map((t, i) => [t, i]));
  for (const [hija, padres] of Object.entries(grafo)) {
    for (const padre of padres) {
      if (!posicion.has(padre)) continue;
      if (posicion.get(hija) > posicion.get(padre)) return `${hija} se borra después de ${padre}`;
    }
  }
  return null;
}

test('los hijos se borran antes que los padres', () => {
  const grafo = {
    clientes: [],
    vehiculos: ['clientes'],
    ordenes_trabajo: ['clientes', 'vehiculos'],
    orden_fotos: ['ordenes_trabajo'],
  };
  const orden = ordenarPorDependencias(grafo);
  assert.equal(esOrdenValido(orden, grafo), null);
  assert.equal(orden[0], 'orden_fotos');
  assert.equal(orden[orden.length - 1], 'clientes');
});

test('devuelve todas las tablas, ninguna de más ni de menos', () => {
  const grafo = { a: [], b: ['a'], c: ['b'], d: [] };
  const orden = ordenarPorDependencias(grafo);
  assert.deepEqual([...orden].sort(), ['a', 'b', 'c', 'd']);
});

test('una tabla suelta no estorba', () => {
  const grafo = { sola: [], padre: [], hija: ['padre'] };
  assert.equal(esOrdenValido(ordenarPorDependencias(grafo), grafo), null);
});

test('un ciclo de claves foráneas se avisa, no se resuelve a medias', () => {
  // Devolver un orden parcial sería peor que fallar: se descubriría con media base
  // borrada y la transacción abierta.
  assert.throws(
    () => ordenarPorDependencias({ a: ['b'], b: ['a'] }),
    /ciclo de claves foráneas/
  );
});

test('sirve para el grafo real del sistema', () => {
  // Recorte del esquema de Motiq, con los caminos que más profundidad tienen.
  const grafo = {
    clientes: [], usuarios: [], sucursales: [], servicios: [], configuracion: [],
    vehiculos: ['clientes'],
    ordenes_trabajo: ['clientes', 'vehiculos', 'usuarios', 'sucursales'],
    citas: ['clientes', 'vehiculos', 'usuarios', 'sucursales', 'ordenes_trabajo'],
    orden_fotos: ['ordenes_trabajo'],
    orden_tiempos: ['ordenes_trabajo'],
    garantias: ['ordenes_trabajo', 'usuarios'],
    garantia_fotos: ['garantias'],
    notificaciones: ['clientes', 'citas'],
    mensajes_internos: ['usuarios'],
    mensaje_lecturas: ['mensajes_internos', 'usuarios'],
  };
  const orden = ordenarPorDependencias(grafo);
  assert.equal(esOrdenValido(orden, grafo), null);
  // El caso que más lejos llega: foto -> garantía -> orden -> vehículo -> cliente.
  const pos = (t) => orden.indexOf(t);
  assert.ok(pos('garantia_fotos') < pos('garantias'));
  assert.ok(pos('garantias') < pos('ordenes_trabajo'));
  assert.ok(pos('ordenes_trabajo') < pos('vehiculos'));
  assert.ok(pos('vehiculos') < pos('clientes'));
});
