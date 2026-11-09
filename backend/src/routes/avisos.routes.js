const router = require('express').Router();
// Lo que ve el PERSONAL del taller (admin/recepción/mecánico), no un cliente ni la
// plataforma: por eso el middleware de acá es el mismo `auth` de siempre, sin nada
// especial. La tabla que lee es global (avisos_plataforma, sin tenant_id) — la
// escribe Motiq desde motiq.routes.js, y acá solo se lee, nunca se escribe.
const { pool } = require('../db/pool');
const { fail } = require('../utils/responder');
const auth = require('../middleware/auth');

// GET /api/avisos/activo — el aviso vigente más reciente, para la franja que se ve
// arriba de la pantalla en todo el lado del personal. `null` si no hay ninguno.
// "Vigente" = activo Y (sin vencimiento O todavía no venció). vence_el es timestamptz
// y NOW() también: se comparan instantes absolutos, así que el resultado no depende de
// la zona horaria de la sesión (en MySQL hacía falta UTC_TIMESTAMP() para lo mismo;
// ver motiq.routes.js, fechaOVacio).
router.get('/activo', auth, async (req, res) => {
  try {
    const [[fila]] = await pool.query(
      `SELECT id, mensaje, tipo, created_at FROM avisos_plataforma
        WHERE activo = 1 AND (vence_el IS NULL OR vence_el > NOW())
        ORDER BY created_at DESC LIMIT 1`
    );
    res.json({ data: fila || null });
  } catch (err) {
    fail(res, err);
  }
});

module.exports = router;
