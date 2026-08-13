const router = require('express').Router();
// Lo que manda el PERSONAL de un taller (admin/recepción/mecánico) hacia Motiq — al
// revés de avisos.routes.js, que es Motiq hacia los talleres. Va contra el pool sin
// scope a propósito: la fila no es de ningún taller en particular, es un mensaje QUE
// LE LLEGA a la plataforma, así que no tiene sentido guardarla acotada por tenant_id
// como hace req.db con el resto del sistema.
const { pool } = require('../db/pool');
const { fail } = require('../utils/responder');
const { consumir } = require('../utils/rate-limit');
const auth = require('../middleware/auth');

// POST /api/reportes — "algo no funciona", desde cualquier taller y cualquier rol.
router.post('/', auth, async (req, res) => {
  try {
    const descripcion = String(req.body?.descripcion || '').trim();
    if (!descripcion) return res.status(400).json({ error: 'Contanos qué pasó' });

    // Por persona y no por IP (todos los talleres comparten el mismo servidor, así
    // que por IP sería un límite compartido entre clientes distintos sin ninguna
    // relación entre sí). Generoso: a nadie le hace falta reportar diez fallas por
    // minuto, pero tampoco es una acción tan rara como para justificar un tope duro.
    const limite = consumir(`reporte:${req.usuario.id}`, { porMinuto: 3, porHora: 20 });
    if (!limite.ok) {
      return res.status(429).json({ error: `Ya nos llegaron varios. Esperá ${limite.retryAfter}s e intentá de nuevo.` });
    }

    const [[t]] = await pool.query('SELECT nombre, slug FROM tenants WHERE id = ?', [req.usuario.tenant_id]);
    const pantalla = String(req.body?.pantalla || '').trim().slice(0, 200) || null;

    await pool.query(
      `INSERT INTO reportes_falla
         (tenant_id, tenant_nombre, tenant_slug, usuario_id, usuario_nombre, usuario_email, usuario_rol, descripcion, pantalla)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        req.usuario.tenant_id, t?.nombre || null, t?.slug || null,
        req.usuario.id, req.usuario.nombre, req.usuario.email, req.usuario.rol,
        descripcion.slice(0, 2000), pantalla,
      ]
    );
    res.status(201).json({ message: 'Gracias — ya nos llegó. Lo vamos a revisar.' });
  } catch (err) {
    fail(res, err);
  }
});

module.exports = router;
