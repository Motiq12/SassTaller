// Estado de cada taller (activo / suspendido / cancelado), en memoria.
//
// Antes de esto, `estado` solo se miraba al resolver el login público: un taller
// suspendido seguía trabajando con normalidad si ya tenía la sesión abierta, y el
// token dura 8 horas. Suspender no significaba nada hasta el día siguiente.
//
// Hay que mirarlo en CADA request autenticado, y por eso NO se consulta la base
// en cada uno: eso duplicaría los viajes a MySQL de toda la aplicación para leer
// un dato que cambia una vez cada varios meses. En su lugar se mantiene una foto
// completa (son pocas filas, una por taller) que se refresca sola, y `estadoDe`
// es una lectura de un Map — síncrona, sin await, sin red.
//
// Suspender surte efecto al instante porque el panel de Motiq escribe el estado
// nuevo acá mismo con fijarEstado(). El refresco periódico está para los otros
// workers del cluster, que no se enteran de ese cambio por memoria compartida.
const { pool } = require('../db/pool');

const estados = new Map();   // tenantId -> 'activo' | 'suspendido' | 'cancelado'
const CADA_MS = 30 * 1000;
let timer = null;

// Un taller que no está en la foto se deja pasar. Puede ser uno recién creado
// (el onboarding lo agrega, pero otro worker todavía no lo vio) o la foto que aún
// no cargó. Cortarle el acceso a un cliente nuevo por eso sería peor que el riesgo
// que cubre: quien no exista de verdad no va a encontrar ni un dato, porque todas
// las consultas van filtradas por su tenant.
function estadoDe(tenantId) {
  return estados.get(Number(tenantId)) || 'activo';
}

// Para que un cambio hecho en este proceso valga ya, sin esperar al refresco.
function fijarEstado(tenantId, estado) {
  estados.set(Number(tenantId), estado);
}

async function refrescarEstados() {
  const [filas] = await pool.query('SELECT id, estado FROM tenants');
  estados.clear();
  for (const f of filas) estados.set(Number(f.id), f.estado);
  return estados.size;
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

module.exports = { estadoDe, fijarEstado, refrescarEstados, iniciarRefrescoEstados };
