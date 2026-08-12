// Job: la prueba de 30 días se acaba sola.
//
// Corre una vez al día y hace dos cosas: avisar con anticipación a los que están por
// vencer, y pasar al plan gratuito a los que ya vencieron.
//
// Vencer NO es suspender. El taller sigue entrando, sigue trabajando y no se le borra
// nada; lo único que cambia son los topes de estructura (ver utils/limites). Suspender
// es otra cosa —una decisión manual del panel de Motiq, con motivo escrito— y este job
// no la toca nunca.
//
// Va contra el pool sin scope a propósito: `tenants` es la tabla raíz y este barrido es
// de plataforma, mira a través de todos los talleres. Es el mismo caso que las rutas de
// /api/motiq, no una consulta de taller a la que se le olvidó el filtro.
const { pool } = require('../db/pool');
const { fechaLocalISO } = require('../utils/fecha');
const { DIAS_AVISO } = require('../utils/limites');
const { refrescarEstados } = require('../utils/estado-tenant');
const { enviarAvisoTrial, enviarAvisoPlanGratis } = require('../services/mailer');

// A quién se le escribe: el admin más antiguo del taller, que es el que lo registró.
// Si no hay ninguno activo no se manda nada — no vale la pena escribirle a un técnico
// sobre la facturación de una cuenta que no maneja.
async function adminDe(tenantId) {
  const [[u]] = await pool.query(
    `SELECT nombre, email FROM usuarios
      WHERE tenant_id = ? AND rol = 'admin' AND activo = 1
      ORDER BY id LIMIT 1`,
    [tenantId]
  );
  return u || null;
}

async function avisarPorVencer(hoy) {
  // Exactamente el día del aviso, no "menos de N": con >= se mandaría el mismo correo
  // los siete días seguidos, y eso deja de ser un aviso para ser una molestia.
  const [talleres] = await pool.query(
    `SELECT id, nombre FROM tenants
      WHERE plan = 'trial' AND estado = 'activo'
        AND trial_hasta = DATE_ADD(?, INTERVAL ? DAY)`,
    [hoy, DIAS_AVISO]
  );

  let enviados = 0;
  for (const t of talleres) {
    const admin = await adminDe(t.id);
    if (!admin) continue;
    // enviarCorreo nunca lanza y devuelve false si no salió: un correo caído no puede
    // frenar el barrido ni dejar sin procesar a los talleres que vienen después.
    if (await enviarAvisoTrial(admin.email, { nombre: admin.nombre, taller: t.nombre, dias: DIAS_AVISO })) enviados++;
  }
  return { candidatos: talleres.length, enviados };
}

async function vencerTrials(hoy) {
  // Se listan ANTES de actualizarlos: después del UPDATE ya no se distinguen de los
  // talleres que hace meses están en gratis, y no habría a quién avisarle.
  const [talleres] = await pool.query(
    `SELECT id, nombre FROM tenants
      WHERE plan = 'trial' AND trial_hasta IS NOT NULL AND trial_hasta < ?`,
    [hoy]
  );
  if (!talleres.length) return { vencidos: 0, avisados: 0 };

  const ids = talleres.map(t => t.id);
  await pool.query(
    `UPDATE tenants SET plan = 'gratis', trial_hasta = NULL
      WHERE id IN (${ids.map(() => '?').join(',')})`,
    ids
  );

  // Los topes se leen de la foto en memoria, así que sin esto el plan nuevo no valdría
  // hasta el refresco siguiente. A los demás workers del cluster les llega por ahí.
  await refrescarEstados();

  let avisados = 0;
  for (const t of talleres) {
    const admin = await adminDe(t.id);
    if (!admin) continue;
    if (await enviarAvisoPlanGratis(admin.email, { nombre: admin.nombre, taller: t.nombre })) avisados++;
  }
  return { vencidos: talleres.length, avisados };
}

// Punto de entrada del scheduler. `hoy` se puede pasar para probarlo a mano.
//
// Usa el offset por defecto (-6, Costa Rica) y no el de cada taller: un contador de 30
// días no cambia de significado por seis horas, y mirar la configuración de cada uno
// para eso serían N consultas más para decidir lo mismo. Los jobs que sí dependen de la
// hora local del taller (recordatorios, no-show) usan porCadaTenant justamente porque
// ahí sí importa.
async function revisarVencimientos(hoy = fechaLocalISO(-6)) {
  const aviso = await avisarPorVencer(hoy);
  const vencidos = await vencerTrials(hoy);
  return { hoy, total: aviso.enviados + vencidos.vencidos, aviso, vencidos };
}

module.exports = { revisarVencimientos, vencerTrials, avisarPorVencer };
