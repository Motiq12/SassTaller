const router = require('express').Router();
// Este archivo usa el pool crudo a propósito: web_vitals_publico es una tabla de la
// plataforma, sin tenant_id (las visitas a la landing no son de ningún taller), así
// que no hay req.db que la scopee. Por eso vive aparte de metricas.routes.js, que sí
// es de cada taller y no puede tocar el pool (test/tenant-scope.test.js).
const { pool } = require('../db/pool');
const { fail } = require('../utils/responder');
const { consumir } = require('../utils/rate-limit');

const METRICAS = ['LCP', 'CLS', 'INP', 'FCP', 'TTFB'];

// POST /api/metricas/web-vitals-publico — las páginas públicas de Motiq, sin taller.
//
// Va aparte de /web-vitals porque esas visitas no son de ningún taller (la tabla de
// arriba exige uno). Solo se aceptan las rutas públicas conocidas: es un endpoint de
// escritura abierto y no tiene por qué guardar cualquier dirección que le manden.
const RUTAS_PUBLICAS = new Set(['/', '/registro-taller', '/portal/login', '/portal/recuperar', '/portal/registro']);
const VARIANTES = new Set(['3d', 'fija', 'ninguna']);

router.post('/', async (req, res) => {
  try {
    // Un sendBeacon por métrica y por visita: 60 por minuto y por IP sobra para la
    // gente y frena a quien quiera llenar la tabla.
    if (!consumir(`wvp:${req.ip}`, { porMinuto: 60, porHora: 600 }).ok) return res.status(204).end();

    const { metrica, valor, calificacion, ruta, movil, variante } = req.body || {};
    if (!METRICAS.includes(metrica)) return res.status(400).json({ error: 'Métrica no válida' });
    const n = Number(valor);
    if (!Number.isFinite(n) || n < 0 || n > 600000) return res.status(400).json({ error: 'Valor no válido' });
    const rutaLimpia = String(ruta || '/').split('?')[0].slice(0, 200);
    if (!RUTAS_PUBLICAS.has(rutaLimpia)) return res.status(204).end();

    await pool.query(
      'INSERT INTO web_vitals_publico (metrica, valor, calificacion, ruta, movil, variante) VALUES (?, ?, ?, ?, ?, ?)',
      [metrica, n, String(calificacion || '').slice(0, 20) || null, rutaLimpia, movil ? 1 : 0,
        VARIANTES.has(variante) ? variante : null]
    );
    res.status(204).end();
  } catch (err) {
    fail(res, err);
  }
});

module.exports = router;
