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
const { pool } = require('../db/pool');

const PLANES = ['trial', 'gratis', 'pro'];

// Días de prueba y con cuánta anticipación se avisa que se acaba.
const DIAS_TRIAL = 30;
const DIAS_AVISO = 7;

// `null` = sin límite. Son los valores DE FÁBRICA: lo que rige mientras nadie los
// haya editado desde el panel de Motiq, y lo que sigue rigiendo si la tabla
// planes_config no existe todavía (una base vieja) o está vacía. No se leen nunca
// directo — limitesDe() de abajo es el único punto de lectura real.
const LIMITES = {
  // La prueba es el producto completo. Capar el trial sería la forma más rápida de que
  // alguien concluya que el sistema no le sirve.
  trial:  { usuarios: null, sucursales: null, marca_propia: true,  reportes_dias: null },
  // Al vencer no se corta el acceso: se aprieta. El taller de un mecánico se queda para
  // siempre en este plan y eso está bien — es el que después recomienda el producto.
  gratis: { usuarios: 2,    sucursales: 1,    marca_propia: false, reportes_dias: 30 },
  pro:    { usuarios: null, sucursales: null, marca_propia: true,  reportes_dias: null },
};

// Lo que el panel de Motiq editó, en memoria — igual que utils/estado-tenant.js hace
// con el estado y el plan de cada taller, y por la misma razón: se consulta en cada
// alta de usuario o sucursal, así que no puede costar un viaje a MySQL cada vez.
//
// Vacío hasta que algo llame a refrescarLimites() (server.js lo hace al arrancar). Un
// test unitario que importe este módulo directo — como test/limites.test.js — nunca
// hace esa llamada, así que para él `overrides` queda vacío para siempre y limitesDe()
// se comporta exactamente como antes de que existiera planes_config: los valores de
// fábrica de acá arriba, no los de ninguna base de datos.
const overrides = new Map();   // plan -> { precio_mensual, limite_usuarios, limite_sucursales, marca_propia, reportes_dias }

// Ante un plan que no reconocemos se cae al MÁS PERMISIVO, no al más restrictivo. Los
// valores de `plan` solo los escribe nuestro propio panel, así que un valor raro es un
// error nuestro: cobrarle el error al taller capándole la cuenta que paga es el peor de
// los dos desenlaces posibles. Al revés, lo único que se pierde es un tope.
function limitesDe(plan) {
  const base = LIMITES[plan] || LIMITES.pro;
  const o = overrides.get(plan);
  if (!o) return base;
  return {
    usuarios: o.limite_usuarios,
    sucursales: o.limite_sucursales,
    marca_propia: !!o.marca_propia,
    reportes_dias: o.reportes_dias,
  };
}

// El precio no es un límite (no toca estructura ni operación): es un dato de negocio
// para el panel, así que vive aparte de limitesDe() y no se mezcla en su forma.
function precioDe(plan) {
  const o = overrides.get(plan);
  return o ? Number(o.precio_mensual) || 0 : 0;
}

// Para que un cambio hecho desde el panel valga ya, sin esperar el refresco periódico
// — igual que fijarEstado/fijarPlan en utils/estado-tenant.js.
function fijarLimites(plan, datos) {
  overrides.set(plan, { ...overrides.get(plan), ...datos });
}

async function refrescarLimites() {
  const [filas] = await pool.query(
    `SELECT plan, precio_mensual, limite_usuarios, limite_sucursales, marca_propia, reportes_dias FROM planes_config`
  );
  overrides.clear();
  for (const f of filas) overrides.set(f.plan, f);
  return overrides.size;
}

const CADA_MS = 30 * 1000;
let timer = null;

async function iniciarRefrescoLimites() {
  await refrescarLimites();
  if (timer) clearInterval(timer);
  timer = setInterval(() => {
    refrescarLimites().catch((err) => console.warn('⚠️  No se pudo refrescar los planes:', err.message));
  }, CADA_MS);
  timer.unref();
  return timer;
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
  limitesDe, precioDe, diasRestantes, finDeTrial, mensajeTope,
  fijarLimites, refrescarLimites, iniciarRefrescoLimites,
};
