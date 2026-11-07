// La página «Nosotros» del sitio, editable desde el panel.
const test = require('node:test');
const assert = require('node:assert');

const { validarNosotros, nosotrosParaSitio } = require('../src/utils/contenido-web');

test('la historia se parte en párrafos con una línea en blanco', () => {
  const { datos } = validarNosotros({ historia: 'Primero.\n\nSegundo.\n\n\nTercero.' });
  assert.deepEqual(datos.historia, ['Primero.', 'Segundo.', 'Tercero.']);
});

test('un salto de línea suelto NO parte el párrafo', () => {
  // Quien escribe en el panel suele dar Enter una vez al final de una frase sin
  // querer empezar otro párrafo.
  const { datos } = validarNosotros({ historia: 'Una frase.\nY su continuación.' });
  assert.equal(datos.historia.length, 1);
});

test('una cifra a medias se rechaza: o va completa, o no va', () => {
  assert.ok(validarNosotros({ cifras: [{ valor: '+12', etiqueta: '' }] }).error);
  assert.ok(validarNosotros({ cifras: [{ valor: '', etiqueta: 'Años de experiencia' }] }).error);
  // Una fila vacía del formulario sí se descarta sin protestar.
  assert.deepEqual(validarNosotros({ cifras: [{ valor: '', etiqueta: '' }] }).datos.cifras, []);
});

test('se pueden dejar cero cifras: mejor ninguna que una inventada', () => {
  const { datos, error } = validarNosotros({ titulo: 'Quiénes somos', cifras: [] });
  assert.equal(error, undefined);
  assert.deepEqual(datos.cifras, []);
});

test('la foto solo acepta una subida del panel o https', () => {
  assert.ok(validarNosotros({ foto: { url: 'javascript:alert(1)' } }).error);
  assert.ok(validarNosotros({ foto: { url: 'http://inseguro.com/a.jpg' } }).error);
  assert.equal(validarNosotros({ foto: { url: 'https://a.com/taller.jpg', alt: 'El taller' } }).datos.foto.alt, 'El taller');
  // Sin dirección, no hay foto: no se guarda un objeto vacío.
  assert.equal(validarNosotros({ foto: { url: '' } }).datos.foto, null);
});

test('sin nada escrito, el sitio se queda con lo que trae: no se publica una página a medias', () => {
  assert.equal(nosotrosParaSitio(null), null);
  assert.equal(nosotrosParaSitio({ titulo: '', historia: [], cifras: [], foto: null }), null);
  // Las cifras solas no alcanzan: una página con tres números y nada más no es
  // una página «Nosotros».
  assert.equal(nosotrosParaSitio({ titulo: '', historia: [], cifras: [{ valor: '+12', etiqueta: 'Años' }] }), null);
});

test('con título o historia o foto, ya se publica', () => {
  assert.ok(nosotrosParaSitio({ titulo: 'Quiénes somos' }));
  assert.ok(nosotrosParaSitio({ historia: ['Nacimos en Liberia.'] }));
  assert.ok(nosotrosParaSitio({ foto: { url: 'https://a.com/1.jpg' } }));
});

test('respeta los largos máximos', () => {
  assert.ok(validarNosotros({ titulo: 'a'.repeat(121) }).error);
  assert.equal(validarNosotros({ titulo: 'a'.repeat(120) }).error, undefined);
  assert.ok(validarNosotros({ historia: Array(7).fill('x').join('\n\n') }).error, 'más de 6 párrafos');
  assert.ok(validarNosotros({ cifras: Array(5).fill({ valor: '1', etiqueta: 'x' }) }).error, 'más de 4 cifras');
  assert.ok(validarNosotros({ cifras: [{ valor: '1'.repeat(11), etiqueta: 'x' }] }).error);
});
