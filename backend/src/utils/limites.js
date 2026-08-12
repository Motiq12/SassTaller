// Qué puede hacer un taller según su plan.
//
// Es la única fuente de verdad de los planes: la landing muestra esta misma tabla en
// palabras y el panel de Motiq escribe el campo `plan` que se lee acá. Si mañana
// aparece un plan intermedio, se agrega en este archivo y en ningún otro lado.
//
// LA REGLA DE FONDO: los límites tocan la ESTRUCTURA del taller (usuarios, sucursales,
// marca), nunca su OPERACIÓN (clientes, vehículos, órdenes, citas). Un taller que no
// puede registrar la moto que tiene enfrente deja de usar el sistema ese mismo día y no
// vuelve; uno que no puede agregar su tercer mecánico llama a preguntar cuánto cuesta.
// Por eso acá no hay ni va a haber un tope de órdenes.
const { fechaLocalISO } = require('./fecha');

const PLANES = ['trial', 'gratis', 'pro'];

// Días de prueba y con cuánta anticipación se avisa que se acaba.
const DIAS_TRIAL = 30;
const DIAS_AVISO = 7;

// `null` = sin límite.
const LIMITES = {
  // La prueba es el producto completo. Capar el trial sería la forma más rápida de que
  // alguien concluya que el sistema no le sirve.
  trial:  { usuarios: null, sucursales: null, marca_propia: true,  reportes_dias: null },
  // Al vencer no se corta el acceso: se aprieta. El taller de un mecánico se queda para
  // siempre en este plan y eso está bien — es el que después recomienda el producto.
  gratis: { usuarios: 2,    sucursales: 1,    marca_propia: false, reportes_dias: 30 },
  pro:    { usuarios: null, sucursales: null, marca_propia: true,  reportes_dias: null },
};

// Ante un plan que no reconocemos se cae al MÁS PERMISIVO, no al más restrictivo. Los
// valores de `plan` solo los escribe nuestro propio panel, así que un valor raro es un
// error nuestro: cobrarle el error al taller capándole la cuenta que paga es el peor de
// los dos desenlaces posibles. Al revés, lo único que se pierde es un tope.
function limitesDe(plan) {
  return LIMITES[plan] || LIMITES.pro;
}

// Días que le quedan de prueba. Negativo si ya venció, null si no aplica.
//
// `hasta` viene como 'YYYY-MM-DD' (la caché lo pide con DATE_FORMAT justamente para no
// tener que adivinar en qué zona horaria quedó un objeto Date). Se compara contra el día
// local del taller: el reloj del servidor está en UTC y en Costa Rica son seis horas
// menos, así que a partir de las 18:00 el servidor ya está en el día siguiente. Para un
// contador de 30 días esas horas dan igual, pero decirle a alguien "te quedan 0 días"
// cuando todavía tiene el día entero es la clase de detalle que se nota.
function diasRestantes(hasta, ahora = Date.now()) {
  if (!hasta) return null;
  const fin = Date.parse(`${String(hasta).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(fin)) return null;
  const hoy = Date.parse(`${fechaLocalISO(-6, 0, ahora)}T00:00:00Z`);
  return Math.round((fin - hoy) / 86400000);
}

// Fecha de fin de la prueba para un taller que se registra hoy.
function finDeTrial(ahora = Date.now()) {
  return fechaLocalISO(-6, DIAS_TRIAL, ahora);
}

// El texto que ve alguien que se topó con un límite.
//
// Nunca es "no autorizado": quien llega acá no hizo nada malo, hizo crecer su taller. El
// mensaje dice cuál es el tope y qué lo levanta, porque un tope es una conversación de
// venta y no un 403.
const NOMBRES = {
  usuarios:   { uno: 'usuario',   varios: 'usuarios del taller' },
  sucursales: { uno: 'sucursal',  varios: 'sucursales' },
};

function mensajeTope(recurso, limite) {
  const n = NOMBRES[recurso] || { uno: recurso, varios: recurso };
  const cuantos = limite === 1 ? `una ${n.uno}` : `${limite} ${n.varios}`;
  return `Tu plan gratuito incluye ${cuantos}. Pasá a Pro y agregá los que necesites.`;
}

module.exports = {
  PLANES, DIAS_TRIAL, DIAS_AVISO, LIMITES,
  limitesDe, diasRestantes, finDeTrial, mensajeTope,
};
