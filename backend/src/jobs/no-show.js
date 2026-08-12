// Job: marcar no-show las citas vencidas.
// Corre una vez al día. Una cita agendada cuya fecha ya pasó y que nunca tuvo
// check-in en mostrador (hora_llegada NULL) se marca no_show = 1. No la cancela
// ni la borra: solo levanta la bandera para que recepción la revise y no ensucie
// la agenda ni las métricas. Idempotente (solo toca las que aún tienen no_show = 0).
//
// Multi-tenant: el barrido va taller por taller, no en una sola pasada global. Cada
// taller tiene su propio offset horario configurado, así que "ayer" no cae en el
// mismo momento para todos y una única fecha de corte marcaría de más o de menos.

const { porCadaTenant } = require('../db/tenant-db');
const { getConfig } = require('../utils/configuracion');
const { fechaLocalISO } = require('../utils/fecha');

async function marcarNoShows() {
  const porTaller = await porCadaTenant(async (db) => {
    const config = await getConfig(db);
    const hoy = fechaLocalISO(config.zona_horaria_offset, 0);

    const [r] = await db.query(
      `UPDATE citas SET no_show = 1
       WHERE fecha < ? AND estado = 'agendado' AND hora_llegada IS NULL AND no_show = 0
         AND tenant_id = @tenant`,
      [hoy]
    );

    return { total: r.affectedRows, hasta: hoy };
  });

  const total = porTaller.reduce((n, x) => n + (x.resultado?.total || 0), 0);
  return { total, talleres: porTaller.length, detalle: porTaller };
}

module.exports = { marcarNoShows };
