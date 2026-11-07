// Varias promociones del inicio: el sitio muestra una a la vez.
const test = require('node:test');
const assert = require('node:assert');
const { validarPromos, promoDeHoy, armarContenido, diferencias, MAX_PROMOS } = require('../src/utils/contenido-web');

const promo = (titulo, extra = {}) => ({ activa: true, titulo, destacado: '', comoParticipar: '', letraChica: '', imagen: '', imagenAlt: '', desde: '', hasta: '', verCada: 'dia', cta: null, ...extra });
const SUC = [{ id: 1, nombre: 'Liberia' }];

test('se guardan varias, en el orden en que vienen', () => {
  const { datos, error } = validarPromos({ promos: [promo('Feria de octubre'), promo('Navidad', { activa: false })] });
  assert.equal(error, undefined);
  assert.deepEqual(datos.promos.map((p) => p.titulo), ['Feria de octubre', 'Navidad']);
});

test('dos con el mismo título no comparten id (el sitio recuerda «ya la vi» por id)', () => {
  const { datos } = validarPromos({ promos: [promo('Feria'), promo('Feria'), promo('Feria')] });
  assert.deepEqual(datos.promos.map((p) => p.id), ['feria', 'feria-2', 'feria-3']);
});

test('un error dice en cuál promoción está', () => {
  const r = validarPromos({ promos: [promo('Buena'), promo('Mala', { desde: '2026-12-20', hasta: '2026-12-01' })] });
  assert.match(r.error, /Promoción 2 \(«Mala»\)/);
  assert.match(r.error, /posterior/);
});

test('hay un tope, y la lista vacía vale (sin promociones)', () => {
  assert.ok(validarPromos({ promos: Array.from({ length: MAX_PROMOS + 1 }, (_, i) => promo('P' + i)) }).error);
  assert.deepEqual(validarPromos({ promos: [] }).datos.promos, []);
  assert.ok(validarPromos({}).error);
});

test('sale la primera encendida cuyas fechas incluyen hoy', () => {
  const lista = [
    promo('Apagada', { activa: false }),
    promo('Vencida', { hasta: '2026-09-30' }),
    promo('Programada', { desde: '2026-12-01' }),
    promo('Octubre', { desde: '2026-10-01', hasta: '2026-10-31' }),
    promo('Todo el año'),
  ];
  assert.equal(promoDeHoy(lista, '2026-10-07').titulo, 'Octubre', 'la de más arriba que toca: tapa a «Todo el año»');
  assert.equal(promoDeHoy(lista, '2026-11-15').titulo, 'Todo el año', 'pasado octubre, sale la siguiente');
  assert.equal(promoDeHoy(lista, '2026-12-05').titulo, 'Programada', 'llegado diciembre, la programada (está más arriba)');
  assert.equal(promoDeHoy([promo('X', { activa: false })], '2026-10-07'), null);
});

test('se publican todas las encendidas, en orden, y `promo` es la de hoy', () => {
  const c = armarContenido({
    filasMotos: [], sucursales: SUC, hoy: '2026-10-07',
    promos: [promo('Navidad', { desde: '2026-12-01' }), promo('Apagada', { activa: false }), promo('Octubre', { hasta: '2026-10-31' })],
  });
  assert.deepEqual(c.promos.map((p) => p.titulo), ['Navidad', 'Octubre'], 'las apagadas no se publican');
  assert.equal(c.promo.titulo, 'Octubre', 'para un sitio viejo, la que toca hoy');
});

test('una publicación de antes (una sola promo) sigue funcionando', () => {
  const c = armarContenido({ filasMotos: [], sucursales: SUC, promo: promo('Vieja'), hoy: '2026-10-07' });
  assert.deepEqual(c.promos.map((p) => p.titulo), ['Vieja']);
  assert.equal(c.promo.titulo, 'Vieja');
});

test('que pasen los días no inventa un cambio pendiente', () => {
  const promos = [promo('Octubre', { hasta: '2026-10-31' }), promo('Navidad', { desde: '2026-12-01' })];
  const publicado = armarContenido({ filasMotos: [], sucursales: SUC, promos, hoy: '2026-10-07' });
  const diciembre = armarContenido({ filasMotos: [], sucursales: SUC, promos, hoy: '2026-12-05' });
  assert.notEqual(publicado.promo.titulo, diciembre.promo.titulo, '`promo` sí cambia con el día');
  assert.equal(diferencias(publicado, diciembre).some((c) => /Promoci/.test(c)), false, 'pero no cuenta como cambio');
});

test('pasar de una sola promo publicada a la lista con la misma no es un cambio', () => {
  const p = promo('Feria');
  const viejo = { motos: [], promo: p };
  const nuevo = armarContenido({ filasMotos: [], sucursales: SUC, promos: [p], hoy: '2026-10-07' });
  assert.equal(diferencias(viejo, nuevo).some((c) => /Promoci/.test(c)), false);
});

test('validarPromo: "solo la imagen" se guarda y pide una imagen', () => {
  const { validarPromo } = require('../src/utils/contenido-web');
  const img = '/api/sitio/fotos/0123456789abcdef01234567.webp';
  assert.equal(validarPromo({ activa: true, titulo: 'Feria', imagen: img, soloImagen: true }).datos.soloImagen, true);
  assert.equal(validarPromo({ activa: true, titulo: 'Feria', imagen: img }).datos.soloImagen, false);
  assert.ok(validarPromo({ activa: true, titulo: 'Feria', soloImagen: true }).error);
  // Apagada se puede guardar a medias.
  assert.equal(validarPromo({ activa: false, titulo: 'Feria', soloImagen: true }).error, undefined);
});

test('validarPromo: con "solo la imagen" el título es opcional y el id sale de la imagen', () => {
  const { validarPromo } = require('../src/utils/contenido-web');
  const img = '/api/sitio/fotos/0123456789abcdef01234567.webp';
  const { error, datos } = validarPromo({ activa: true, soloImagen: true, imagen: img });
  assert.equal(error, undefined);
  assert.equal(datos.id, 'promo-01234567');
  // Sin "solo la imagen" el título sigue haciendo falta.
  assert.ok(validarPromo({ activa: true, imagen: img }).error);
});
