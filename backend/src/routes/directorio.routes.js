const router = require('express').Router();
// Buscador público de talleres: es lo único del sistema que mira a través de las empresas
// sin ser el panel de la plataforma, por eso va contra el pool. Solo devuelve datos que
// el taller decidió publicar: nombre, marca, sedes y tipos que atiende. Nunca clientes,
// órdenes, correos ni cantidades.
const { pool } = require('../db/pool');
const { fail } = require('../utils/responder');
const { consumir } = require('../utils/rate-limit');
const { UBICACIONES, provinciaValida, cantonValido } = require('../utils/ubicaciones');
const { TIPOS, normalizarTipos } = require('../utils/tipos-vehiculo');

const MAX_TALLERES = 30;
const MIN_BUSQUEDA = 2;

router.get('/ubicaciones', (req, res) => {
  res.json({ data: UBICACIONES });
});

// GET /api/directorio/talleres?provincia=&canton=&q=
// Exige una provincia o al menos dos letras: sin filtro sería descargar el directorio.
router.get('/talleres', async (req, res) => {
  try {
    const limite = consumir(`directorio:${req.ip}`, { porMinuto: 30, porHora: 300 });
    if (!limite.ok) {
      return res.status(429).json({ error: `Demasiadas búsquedas. Probá de nuevo en ${limite.retryAfter} segundos.` });
    }

    const provincia = String(req.query.provincia || '').trim();
    const canton = String(req.query.canton || '').trim();
    const q = String(req.query.q || '').trim().slice(0, 60);
    if (provincia && !provinciaValida(provincia)) return res.status(400).json({ error: 'Provincia no válida' });
    if (canton && !cantonValido(provincia, canton)) return res.status(400).json({ error: 'Cantón no válido' });
    if (!provincia && q.length < MIN_BUSQUEDA) {
      return res.status(400).json({ error: 'Elegí una provincia o escribí el nombre del taller' });
    }

    let sql = `SELECT t.slug, c.nombre_taller, c.color_primario, (c.logo IS NOT NULL)::int AS tiene_logo,
                      c.tipos_vehiculo, s.id AS sucursal_id, s.nombre AS sucursal, s.direccion, s.telefono,
                      s.provincia, s.canton
                 FROM tenants t
                 JOIN configuracion c ON c.tenant_id = t.id AND c.id = 1
                 JOIN sucursales s ON s.tenant_id = t.id AND s.activa = 1
                WHERE t.estado = 'activo' AND c.visible_buscador = 1
                  AND s.provincia IS NOT NULL AND s.canton IS NOT NULL`;
    const params = [];
    if (provincia) { sql += ' AND s.provincia = ?'; params.push(provincia); }
    if (canton) { sql += ' AND s.canton = ?'; params.push(canton); }
    if (q) {
      // Lo que escribe la persona es texto, no un patrón: % y _ se escapan.
      sql += " AND c.nombre_taller ILIKE ? ESCAPE '\\'";
      params.push(`%${q.replace(/[\\%_]/g, '\\$&')}%`);
    }
    sql += ' ORDER BY c.nombre_taller, s.orden, s.id LIMIT 120';
    const [filas] = await pool.query(sql, params);

    const talleres = new Map();
    for (const f of filas) {
      if (!talleres.has(f.slug)) {
        if (talleres.size >= MAX_TALLERES) continue;
        talleres.set(f.slug, {
          slug: f.slug,
          nombre: f.nombre_taller,
          color: f.color_primario || null,
          tiene_logo: !!f.tiene_logo,
          tipos: normalizarTipos(f.tipos_vehiculo).map((t) => TIPOS[t].plural),
          sucursales: [],
        });
      }
      talleres.get(f.slug).sucursales.push({
        nombre: f.sucursal, direccion: f.direccion || null, telefono: f.telefono || null,
        provincia: f.provincia, canton: f.canton,
      });
    }
    res.json({ data: [...talleres.values()] });
  } catch (err) {
    fail(res, err);
  }
});

module.exports = router;
