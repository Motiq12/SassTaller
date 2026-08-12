const router = require('express').Router();
// Sin `pool`: todo el acceso pasa por req.db, scopeado al taller.
const { fail } = require('../utils/responder');
const auth = require('../middleware/auth');
const requireRol = require('../middleware/roles');

router.use(auth);

// Columnas del listado. La imagen queda FUERA a propósito: se guarda como data URL
// en base64 dentro de la tabla, así que devolverla en la lista hacía que la respuesta
// pesara ~100 KB por promoción (3 MB con 30 activas, medido en la prueba de carga).
// Se expone `tiene_imagen` y la imagen se pide aparte, por promoción, como ya hacía
// el portal del cliente. Además así el navegador puede cachearla.
const COLS_LISTA = `id, titulo, descripcion, descuento, precio_final, activa, created_at,
                    (imagen IS NOT NULL) AS tiene_imagen`;

// GET /api/promos — todas (para gestión del personal)
router.get('/', async (req, res) => {
  try {
    const [rows] = await req.db.query(`SELECT ${COLS_LISTA} FROM promos WHERE tenant_id = @tenant ORDER BY created_at DESC`);
    res.json({ data: rows });
  } catch (err) {
    fail(res, err);
  }
});

// GET /api/promos/:id/imagen — la imagen de una promoción, aparte del listado.
// Devuelve la data URL en JSON, el mismo contrato que ya usa el portal del cliente:
// la ruta pide sesión, y un <img src> no puede mandar la cabecera de autorización,
// así que el frontend la trae por HttpClient y la asigna cuando llega.
router.get('/:id/imagen', async (req, res) => {
  try {
    const [[p]] = await req.db.query('SELECT imagen FROM promos WHERE tenant_id = @tenant AND id = ?', [req.params.id]);
    if (!p || !p.imagen) return res.status(404).json({ error: 'Sin imagen' });
    res.json({ data: p.imagen });
  } catch (err) {
    fail(res, err);
  }
});

// Gestión: solo admin
router.post('/', requireRol('admin'), async (req, res) => {
  try {
    const { titulo, descripcion, descuento, activa, imagen, precio_final } = req.body;
    if (!titulo || !descripcion) return res.status(400).json({ error: 'Título y descripción son requeridos' });
    const [result] = await req.db.query(
      'INSERT INTO promos (tenant_id,titulo, descripcion, descuento, activa, imagen, precio_final) VALUES (@tenant, ?, ?, ?, ?, ?, ?)',
      [titulo, descripcion, descuento || 0, activa === false ? 0 : 1, imagen || null, precio_final || null]
    );
    const [[nueva]] = await req.db.query('SELECT * FROM promos WHERE tenant_id = @tenant AND id = ?', [result.insertId]);
    res.status(201).json({ data: nueva, message: 'Promoción creada' });
  } catch (err) {
    fail(res, err);
  }
});

// Editar oferta (incluye imagen)
router.put('/:id', requireRol('admin'), async (req, res) => {
  try {
    const { titulo, descripcion, descuento, imagen, precio_final } = req.body;
    if (!titulo || !descripcion) return res.status(400).json({ error: 'Título y descripción son requeridos' });
    await req.db.query(
      'UPDATE promos SET titulo = ?, descripcion = ?, descuento = ?, imagen = ?, precio_final = ? WHERE tenant_id = @tenant AND id = ?',
      [titulo, descripcion, descuento || 0, imagen || null, precio_final || null, req.params.id]
    );
    const [[promo]] = await req.db.query('SELECT * FROM promos WHERE tenant_id = @tenant AND id = ?', [req.params.id]);
    if (!promo) return res.status(404).json({ error: 'Promoción no encontrada' });
    res.json({ data: promo, message: 'Promoción actualizada' });
  } catch (err) {
    fail(res, err);
  }
});

router.patch('/:id/toggle', requireRol('admin'), async (req, res) => {
  try {
    await req.db.query('UPDATE promos SET activa = NOT activa WHERE tenant_id = @tenant AND id = ?', [req.params.id]);
    const [[promo]] = await req.db.query('SELECT * FROM promos WHERE tenant_id = @tenant AND id = ?', [req.params.id]);
    if (!promo) return res.status(404).json({ error: 'Promoción no encontrada' });
    res.json({ data: promo, message: promo.activa ? 'Promoción activada' : 'Promoción desactivada' });
  } catch (err) {
    fail(res, err);
  }
});

router.delete('/:id', requireRol('admin'), async (req, res) => {
  try {
    await req.db.query('DELETE FROM promos WHERE tenant_id = @tenant AND id = ?', [req.params.id]);
    res.json({ message: 'Promoción eliminada' });
  } catch (err) {
    fail(res, err);
  }
});

module.exports = router;
