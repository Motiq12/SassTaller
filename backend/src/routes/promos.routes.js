const router = require('express').Router();
// Sin `pool`: todo el acceso pasa por req.db, scopeado al taller.
const { fail, invalido } = require('../utils/responder');
const auth = require('../middleware/auth');
const requireRol = require('../middleware/roles');

router.use(auth);

// Columnas del listado. La imagen queda FUERA a propósito: se guarda como data URL
// en base64 dentro de la tabla, así que devolverla en la lista hacía que la respuesta
// pesara ~100 KB por promoción (3 MB con 30 activas, medido en la prueba de carga).
// Se expone `tiene_imagen` y la imagen se pide aparte, por promoción, como ya hacía
// el portal del cliente. Además así el navegador puede cachearla.
const COLS_LISTA = `id, titulo, descripcion, descuento, precio_final, activa, created_at,
                    (imagen IS NOT NULL)::int AS tiene_imagen`;

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
    const [[p]] = await req.db.query('SELECT imagen FROM promos WHERE id = ? AND tenant_id = @tenant', [req.params.id]);
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
    // Título y descripción, o una imagen: la que el taller diseña con todo puesto
    // (precio, texto) puede ir sola. Las columnas son NOT NULL: sin texto va ''.
    if (!imagen && (!String(titulo || '').trim() || !String(descripcion || '').trim())) {
      return invalido(res, 'titulo', 'Pon un título y una descripción, o sube una imagen');
    }
    const [result] = await req.db.query(
      'INSERT INTO promos (tenant_id, titulo, descripcion, descuento, activa, imagen, precio_final) VALUES (@tenant, ?, ?, ?, ?, ?, ?)',
      [String(titulo || '').trim(), String(descripcion || '').trim(), descuento || 0, activa === false ? 0 : 1, imagen || null, precio_final || null]
    );
    const [[nueva]] = await req.db.query('SELECT * FROM promos WHERE id = ? AND tenant_id = @tenant', [result.insertId]);
    res.status(201).json({ data: nueva, message: 'Promoción creada' });
  } catch (err) {
    fail(res, err);
  }
});

// Editar oferta (incluye imagen)
router.put('/:id', requireRol('admin'), async (req, res) => {
  try {
    const { titulo, descripcion, descuento, imagen, precio_final } = req.body;
    // Título y descripción, o una imagen: la que el taller diseña con todo puesto
    // (precio, texto) puede ir sola. Las columnas son NOT NULL: sin texto va ''.
    if (!imagen && (!String(titulo || '').trim() || !String(descripcion || '').trim())) {
      return invalido(res, 'titulo', 'Pon un título y una descripción, o sube una imagen');
    }
    await req.db.query(
      'UPDATE promos SET titulo = ?, descripcion = ?, descuento = ?, imagen = ?, precio_final = ? WHERE id = ? AND tenant_id = @tenant',
      [String(titulo || '').trim(), String(descripcion || '').trim(), descuento || 0, imagen || null, precio_final || null, req.params.id]
    );
    const [[promo]] = await req.db.query('SELECT * FROM promos WHERE id = ? AND tenant_id = @tenant', [req.params.id]);
    if (!promo) return res.status(404).json({ error: 'Promoción no encontrada' });
    res.json({ data: promo, message: 'Promoción actualizada' });
  } catch (err) {
    fail(res, err);
  }
});

router.patch('/:id/toggle', requireRol('admin'), async (req, res) => {
  try {
    // `activa` es smallint 0/1 (no boolean): se invierte con 1 - activa.
    await req.db.query('UPDATE promos SET activa = 1 - activa WHERE tenant_id = @tenant AND id = ?', [req.params.id]);
    const [[promo]] = await req.db.query('SELECT * FROM promos WHERE tenant_id = @tenant AND id = ?', [req.params.id]);
    if (!promo) return res.status(404).json({ error: 'Promoción no encontrada' });
    res.json({ data: promo, message: promo.activa ? 'Promoción activada' : 'Promoción desactivada' });
  } catch (err) {
    fail(res, err);
  }
});

router.delete('/:id', requireRol('admin'), async (req, res) => {
  try {
    await req.db.query('DELETE FROM promos WHERE id = ? AND tenant_id = @tenant', [req.params.id]);
    res.json({ message: 'Promoción eliminada' });
  } catch (err) {
    fail(res, err);
  }
});

module.exports = router;
