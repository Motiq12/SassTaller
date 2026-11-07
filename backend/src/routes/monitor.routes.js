// GET /api/monitor/seguridad — para el vigilante de n8n, no para personas.
// Sin sesión: se entra con la cabecera `X-Monitor-Clave` igual a la variable
// MONITOR_CLAVE. Sin esa variable la ruta no existe (404), así que en una instalación
// que no usa el vigilante no hay nada que adivinar. Solo lee: no cambia nada.
//
// ?minutos=15 (1 a 1440): la ventana que se resume. El vigilante pregunta cada 15 min.
const router = require('express').Router();
const { fail } = require('../utils/responder');
const { claveCorrecta, resumenSeguridad } = require('../utils/eventos-seguridad');

const MIN_LARGO_CLAVE = 32;

router.get('/seguridad', async (req, res) => {
  const esperada = process.env.MONITOR_CLAVE;
  if (!esperada || esperada.length < MIN_LARGO_CLAVE) return res.status(404).json({ error: 'No encontrado' });
  if (!claveCorrecta(req.get('x-monitor-clave'), esperada)) return res.status(401).json({ error: 'Clave incorrecta' });
  try {
    const minutos = Math.min(1440, Math.max(1, Number(req.query.minutos) || 15));
    res.json({ data: await resumenSeguridad(minutos) });
  } catch (err) {
    fail(res, err);
  }
});

module.exports = router;
