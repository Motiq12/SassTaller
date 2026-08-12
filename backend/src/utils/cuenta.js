// El estado de la cuenta de un taller, listo para mostrar y para decidir.
//
// Junta las dos mitades que viven en otro lado: el plan (caché en memoria, utils/
// estado-tenant) y lo que el taller lleva usado (una consulta de conteos). El plan solo
// no alcanza para nada — "tenés hasta 2 usuarios" no sirve sin saber cuántos hay.
const { cuentaDe } = require('./estado-tenant');
const { limitesDe, diasRestantes, mensajeTope } = require('./limites');

// Cómo se cuenta cada recurso con tope. Solo los que la tabla de límites acota: acá no
// entran clientes, vehículos ni órdenes, y esa ausencia es deliberada (ver utils/limites).
const CONTEOS = {
  usuarios:   'SELECT COUNT(*) AS n FROM usuarios   WHERE tenant_id = @tenant AND activo = 1',
  sucursales: 'SELECT COUNT(*) AS n FROM sucursales WHERE tenant_id = @tenant AND activa = 1',
};

// Lo que necesita el frontend para saber en qué anda la cuenta: qué plan, cuánto falta,
// qué incluye y cuánto va usado.
async function resumenCuenta(db) {
  const { plan, trial_hasta } = cuentaDe(db.tenantId);
  const [[uso]] = await db.query(
    `SELECT (SELECT COUNT(*) FROM usuarios   WHERE tenant_id = @tenant AND activo = 1) AS usuarios,
            (SELECT COUNT(*) FROM sucursales WHERE tenant_id = @tenant AND activa = 1) AS sucursales`
  );
  return {
    // Puede venir null si la caché todavía no vio a este taller (recién creado en otro
    // worker). El frontend lo trata como "no sé todavía" y no muestra nada, que es mejor
    // que afirmar un plan equivocado.
    plan: plan || null,
    vence: trial_hasta || null,
    dias_restantes: diasRestantes(trial_hasta),
    limites: limitesDe(plan),
    uso,
  };
}

// ¿Puede el taller agregar uno más de `recurso`? Devuelve null si sí, o el texto del
// tope si ya llegó.
//
// No usa bloqueo: dos altas simultáneas podrían colarse y dejar tres usuarios donde el
// tope es dos. Poner una transacción con FOR UPDATE para eso sería pagar un candado en
// cada alta para evitar que alguien termine con un usuario de más — y de todos modos el
// taller que llegó al tope va a ver el mensaje en el intento siguiente.
async function topeAlcanzado(db, recurso) {
  const limite = limitesDe(cuentaDe(db.tenantId).plan)[recurso];
  if (limite == null) return null;

  const [[{ n }]] = await db.query(CONTEOS[recurso]);
  return n >= limite ? mensajeTope(recurso, limite) : null;
}

// ¿Le toca la marca propia (logo y color) según el plan?
function puedeMarcaPropia(tenantId) {
  return limitesDe(cuentaDe(tenantId).plan).marca_propia;
}

module.exports = { resumenCuenta, topeAlcanzado, puedeMarcaPropia };
