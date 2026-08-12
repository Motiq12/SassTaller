// La cuenta de cada taller (estado, plan y vencimiento de la prueba), en memoria.
//
// Antes de esto, `estado` solo se miraba al resolver el login público: un taller
// suspendido seguía trabajando con normalidad si ya tenía la sesión abierta, y el
// token dura 8 horas. Suspender no significaba nada hasta el día siguiente.
//
// Hay que mirarlo en CADA request autenticado, y por eso NO se consulta la base
// en cada uno: eso duplicaría los viajes a MySQL de toda la aplicación para leer
// un dato que cambia una vez cada varios meses. En su lugar se mantiene una foto
// completa (son pocas filas, una por taller) que se refresca sola, y las lecturas
// son de un Map — síncronas, sin await, sin red.
//
// El PLAN viaja en la misma foto por la misma razón: los topes del plan gratuito se
// comprueban al crear un usuario o una sucursal, y no vale la pena una consulta extra
// para saber algo que ya está acá. Traerlo aparte habría significado mantener dos
// cachés del mismo puñado de filas.
//
// Suspender o cambiar el plan surte efecto al instante porque el panel de Motiq escribe
// el valor nuevo acá mismo (fijarEstado / fijarPlan). El refresco periódico está para
// los otros workers del cluster, que no se enteran de ese cambio por memoria compartida.
const { pool } = require('../db/pool');

const cuentas = new Map();   // tenantId -> { estado, plan, trial_hasta }
const CADA_MS = 30 * 1000;
let timer = null;

// Un taller que no está en la foto se deja pasar, y sin límites. Puede ser uno recién
// creado (el onboarding lo agrega, pero otro worker todavía no lo vio) o la foto que aún
// no cargó. Cortarle el acceso a un cliente nuevo por eso sería peor que el riesgo que
// cubre: quien no exista de verdad no va a encontrar ni un dato, porque todas las
// consultas van filtradas por su tenant.
const CUENTA_DESCONOCIDA = { estado: 'activo', plan: null, trial_hasta: null };

function cuentaDe(tenantId) {
  return cuentas.get(Number(tenantId)) || CUENTA_DESCONOCIDA;
}

function estadoDe(tenantId) {
  return cuentaDe(tenantId).estado || 'activo';
}

function planDe(tenantId) {
  return cuentaDe(tenantId).plan;
}

// Para que un cambio hecho en este proceso valga ya, sin esperar al refresco.
function fijar(tenantId, parcial) {
  const id = Number(tenantId);
  cuentas.set(id, { ...cuentaDe(id), ...parcial });
}

function fijarEstado(tenantId, estado) {
  fijar(tenantId, { estado });
}

function fijarPlan(tenantId, plan, trial_hasta = null) {
  fijar(tenantId, { plan, trial_hasta });
}

async function refrescarEstados() {
  // trial_hasta se pide ya formateado: es una columna DATE y el driver la devolvería
  // como un Date a medianoche de la zona del proceso, que es justo la ambigüedad que no
  // queremos arrastrar hasta el cálculo de días restantes.
  const [filas] = await pool.query(
    `SELECT id, estado, plan, DATE_FORMAT(trial_hasta, '%Y-%m-%d') AS trial_hasta FROM tenants`
  );
  cuentas.clear();
  for (const f of filas) {
    cuentas.set(Number(f.id), { estado: f.estado, plan: f.plan, trial_hasta: f.trial_hasta });
  }
  return cuentas.size;
}

// La primera carga se espera (server.js la hace antes de escuchar) para no abrir
// una ventana donde un taller suspendido trabaje. Los refrescos siguientes no
// pueden tumbar el proceso: si MySQL parpadea, se conserva la foto anterior.
async function iniciarRefrescoEstados() {
  await refrescarEstados();
  if (timer) clearInterval(timer);
  timer = setInterval(() => {
    refrescarEstados().catch((err) => console.warn('⚠️  No se pudo refrescar el estado de los talleres:', err.message));
  }, CADA_MS);
  timer.unref();   // que un temporizador de fondo no impida que el proceso termine
  return timer;
}

module.exports = {
  cuentaDe, estadoDe, planDe,
  fijarEstado, fijarPlan,
  refrescarEstados, iniciarRefrescoEstados,
};
