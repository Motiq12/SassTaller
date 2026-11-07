// Programador de tareas de fondo (node-cron).
// Se arranca una sola vez desde server.js, después de la auto-migración.
// Railway corre en UTC: las expresiones cron se interpretan en UTC y cada job
// calcula el "día local" del taller usando zona_horaria_offset (ver utils/fecha).

const cron = require('node-cron');
const { enviarRecordatorios } = require('./recordatorios');
const { marcarNoShows } = require('./no-show');
const { publicarProgramada, reconstruirSitio, recordarSeguimientos } = require('./sitio-web');
const { respaldoDiario, describirRespaldo } = require('./respaldo');

let iniciado = false;

function iniciarJobs() {
  // Interruptor de emergencia (p. ej. para no correr crons en dev).
  if (process.env.DISABLE_CRON === '1') {
    console.log('⏰ Jobs desactivados (DISABLE_CRON=1)');
    return;
  }
  // Idempotente: no registrar timers dos veces si se llama más de una vez.
  if (iniciado) return;
  iniciado = true;

  // Recordatorios: 14:00 UTC ≈ 08:00 en CR (offset -6). Avisa de las citas de mañana.
  cron.schedule('0 14 * * *', () => ejecutar('recordatorios', enviarRecordatorios));

  // No-show: 07:00 UTC ≈ 01:00 en CR, con el día anterior ya cerrado.
  cron.schedule('0 7 * * *', () => ejecutar('no-show', marcarNoShows));

  // Sitio web: publicación programada (cada 5 min) y reconstrucción diaria
  // (06:10 UTC ≈ 00:10 en CR, apenas cambia el día).
  cron.schedule('*/5 * * * *', () => ejecutar('sitio-web programada', publicarProgramada));
  cron.schedule('10 6 * * *', () => ejecutar('sitio-web diario', reconstruirSitio));
  // Seguimientos de consultas del sitio: 14:05 UTC ≈ 08:05 en CR.
  cron.schedule('5 14 * * *', () => ejecutar('sitio-web seguimientos', recordarSeguimientos));

  // Respaldo de la base: 08:30 UTC ≈ 02:30 en CR, con el taller cerrado y lejos de
  // los demás jobs. Si no está configurado, respaldoDiario no hace nada.
  cron.schedule('30 8 * * *', () => ejecutar('respaldo', respaldoDiario));

  console.log('⏰ Jobs programados: recordatorios (14:00 UTC), no-show (07:00 UTC), sitio web (cada 5 min y 06:10 UTC)');
  console.log(describirRespaldo());
}

// Corre un job con manejo de errores: un fallo se loguea y no tumba el proceso.
async function ejecutar(nombre, fn) {
  try {
    const r = await fn();
    if (r && r.total) console.log(`⏰ Job ${nombre}:`, JSON.stringify(r));
  } catch (err) {
    console.error(`⚠️  Job ${nombre} falló:`, err.message);
  }
}

module.exports = { iniciarJobs, ejecutar };
