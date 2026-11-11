const router = require('express').Router();
// Sin `pool`: todo pasa por req.db, scopeado al taller (ver clientes.routes.js).
const { fail } = require('../utils/responder');
const { getConfig } = require('../utils/configuracion');
const { normalizarTipos, puedeUsarTipo, catalogoDelTaller, limpiarAtributos, mensaje, etiquetaPara } = require('../utils/tipos-vehiculo');
const auth = require('../middleware/auth');
const { anioValido, placaValida } = require('../utils/validar');

router.use(auth);

// Tope del listado global (ver comentario en clientes.routes.js): la búsqueda por `q`
// y el filtro por cliente_id son server-side, así que no hace falta traer todo.
const MAX_LISTADO = 500;

router.get('/', async (req, res) => {
  try {
    const { q, cliente_id } = req.query;
    // Columnas explícitas SIN la foto base64 (MEDIUMTEXT): este listado es global y
    // sin paginar, así que devolver la imagen de cada moto haría respuestas enormes.
    // Se expone `tiene_foto`; la imagen se obtiene en el detalle (GET /motos/:id).
    let sql = `SELECT m.id, m.cliente_id, m.marca, m.modelo, m.anio, m.placa, m.color,
                      m.numero_motor, m.numero_chasis, m.kilometraje_actual, m.foto_url,
                      m.activa, m.created_at, m.updated_at,
                      (m.foto IS NOT NULL)::int AS tiene_foto,
                      c.nombre AS cliente_nombre, c.apellido AS cliente_apellido, c.telefono AS cliente_telefono
               FROM vehiculos m JOIN clientes c ON m.cliente_id = c.id AND c.tenant_id = @tenant
               WHERE m.activa = 1 AND m.tenant_id = @tenant`;
    const params = [];
    if (cliente_id) { sql += ' AND m.cliente_id = ?'; params.push(cliente_id); }
    if (q) {
      sql += ' AND (m.marca ILIKE ? OR m.modelo ILIKE ? OR m.placa ILIKE ?)';
      const like = `%${q}%`;
      params.push(like, like, like);
    }
    sql += ` ORDER BY m.created_at DESC LIMIT ${MAX_LISTADO}`;
    const [rows] = await req.db.query(sql, params);
    res.json({ data: rows });
  } catch (err) {
    fail(res, err);
  }
});

// GET /api/vehiculos/tipos — solo los que atiende este taller, con sus campos.
// Va antes de /:id para que "tipos" no se lea como un id.
router.get('/tipos', async (req, res) => {
  try {
    const { tipos_vehiculo: tipos } = await getConfig(req.db);
    res.json(catalogoDelTaller(tipos));
  } catch (err) {
    fail(res, err);
  }
});

router.post('/', async (req, res) => {
  try {
    const { cliente_id, marca, modelo, anio, placa, color, numero_motor, numero_chasis, kilometraje_actual, foto_url } = req.body;
    if (!cliente_id || !marca || !modelo) {
      return res.status(400).json({ error: 'cliente_id, marca y modelo son requeridos' });
    }
    if (!placaValida(placa)) return res.status(400).json({ error: 'La placa no tiene un formato válido' });
    if (!anioValido(anio)) return res.status(400).json({ error: 'El año no es válido' });

    // El cliente tiene que ser de ESTE taller. Sin esta comprobación se podía colgar
    // una moto del cliente de otro taller mandando su id a mano: la FK apunta a
    // clientes(id) sin mirar el tenant, así que la base sola no lo impide.
    const [[duenio]] = await req.db.query(
      'SELECT id FROM clientes WHERE id = ? AND tenant_id = @tenant', [cliente_id]
    );
    if (!duenio) return res.status(404).json({ error: 'Cliente no encontrado' });

    // Evita placas duplicadas (normaliza espacios y guiones), igual que en el portal.
    // El chequeo va acotado al taller: que otro taller tenga esa placa no es asunto
    // de este, y el índice único de la base también es (tenant_id, placa_norm).
    if (placa) {
      const [[dup]] = await req.db.query(
        `SELECT id FROM vehiculos WHERE activa = 1 AND tenant_id = @tenant
           AND UPPER(REPLACE(REPLACE(placa, ' ', ''), '-', '')) = UPPER(REPLACE(REPLACE(?, ' ', ''), '-', ''))`,
        [placa]
      );
      if (dup) return res.status(409).json({ error: 'Esa placa ya está registrada' });
    }
    // El tipo tiene que ser uno de los que ESTE taller atiende: aceptar 'camion' en
    // un taller que solo marcó motos ensuciaría sus listados y sus reportes con algo
    // que no ofrece. El default es el primero que declaró, que cubre al taller de un
    // solo tipo — la mayoría — sin obligarlo a elegir en cada alta.
    const config = await getConfig(req.db);
    const tiposDelTaller = normalizarTipos(config.tipos_vehiculo);
    const tipoPedido = String(req.body.tipo || tiposDelTaller[0]).toLowerCase();
    if (!tiposDelTaller.includes(tipoPedido)) {
      return res.status(400).json({ error: 'Este taller no atiende ese tipo de vehículo' });
    }
    // Los atributos se filtran contra la definición del tipo: sin esto, `atributos`
    // sería un JSON abierto donde el cliente podría guardar lo que quisiera.
    const atributos = limpiarAtributos(tipoPedido, req.body.atributos);

    const [result] = await req.db.query(
      `INSERT INTO vehiculos (tenant_id, cliente_id, tipo, marca, modelo, anio, placa, color, numero_motor, numero_chasis, kilometraje_actual, foto_url, atributos)
       VALUES (@tenant, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [cliente_id, tipoPedido, marca, modelo, anio || null, placa || null, color || null, numero_motor || null, numero_chasis || null, kilometraje_actual || 0, foto_url || null, atributos ? JSON.stringify(atributos) : null]
    );
    const [[nueva]] = await req.db.query(
      'SELECT * FROM vehiculos WHERE id = ? AND tenant_id = @tenant', [result.insertId]
    );
    res.status(201).json({ data: nueva, message: mensaje(tiposDelTaller, 'registrad') });
  } catch (err) {
    fail(res, err);
  }
});

router.get('/:id', async (req, res) => {
  try {
    const [[moto]] = await req.db.query(
      `SELECT m.*, c.nombre AS cliente_nombre, c.apellido AS cliente_apellido, c.telefono AS cliente_telefono
       FROM vehiculos m JOIN clientes c ON m.cliente_id = c.id AND c.tenant_id = @tenant
       WHERE m.id = ? AND m.activa = 1 AND m.tenant_id = @tenant`,
      [req.params.id]
    );
    if (!moto) {
      const e = etiquetaPara((await getConfig(req.db)).tipos_vehiculo);
      return res.status(404).json({ error: `${e.singular} no encontrad${e.genero === 'f' ? 'a' : 'o'}` });
    }
    res.json({ data: moto });
  } catch (err) {
    fail(res, err);
  }
});

router.put('/:id', async (req, res) => {
  try {
    const { marca, modelo, anio, placa, color, numero_motor, numero_chasis, kilometraje_actual, foto_url } = req.body;
    if (!placaValida(placa)) return res.status(400).json({ error: 'La placa no tiene un formato válido' });
    if (!anioValido(anio)) return res.status(400).json({ error: 'El año no es válido' });
    // Se revisa antes de guardar nada, para no dejar la edición a medias.
    const tipo = req.body.tipo === undefined ? undefined : String(req.body.tipo).toLowerCase();
    if (tipo !== undefined) {
      const { tipos_vehiculo: atendidos } = await getConfig(req.db);
      const [[previo]] = await req.db.query('SELECT tipo FROM vehiculos WHERE id = ? AND tenant_id = @tenant', [req.params.id]);
      if (!puedeUsarTipo(tipo, atendidos, previo?.tipo)) {
        return res.status(400).json({ error: 'Este taller no atiende ese tipo de vehículo' });
      }
    }
    await req.db.query(
      `UPDATE vehiculos SET marca=?, modelo=?, anio=?, placa=?, color=?, numero_motor=?, numero_chasis=?, kilometraje_actual=?, foto_url=?
       WHERE id=? AND tenant_id = @tenant`,
      [marca, modelo, anio || null, placa || null, color || null, numero_motor || null, numero_chasis || null, kilometraje_actual || 0, foto_url || null, req.params.id]
    );
    // El tipo y sus datos propios, solo si vinieron: otra pantalla que guarda este
    // vehículo sin conocerlos no los borra.
    if (tipo !== undefined) {
      const propios = limpiarAtributos(tipo, req.body.atributos);
      await req.db.query(
        'UPDATE vehiculos SET tipo = ?, atributos = ? WHERE id = ? AND tenant_id = @tenant',
        [tipo, propios ? JSON.stringify(propios) : null, req.params.id]
      );
    }
    const [[actualizada]] = await req.db.query(
      'SELECT * FROM vehiculos WHERE id = ? AND tenant_id = @tenant', [req.params.id]
    );
    if (!actualizada) {
      const e = etiquetaPara((await getConfig(req.db)).tipos_vehiculo);
      return res.status(404).json({ error: `${e.singular} no encontrad${e.genero === 'f' ? 'a' : 'o'}` });
    }
    const cfg = await getConfig(req.db);
    res.json({ data: actualizada, message: mensaje(cfg.tipos_vehiculo, 'actualizad') });
  } catch (err) {
    fail(res, err);
  }
});

router.get('/:id/historial', async (req, res) => {
  try {
    const [rows] = await req.db.query(
      `SELECT ot.id, ot.numero_orden, ot.estado, ot.problema_reportado, ot.fecha_ingreso, ot.fecha_entrega_real,
              ot.costo_mano_obra, ot.costo_repuestos, ot.descuento,
              (ot.costo_mano_obra + ot.costo_repuestos - ot.descuento) AS total,
              u.nombre AS tecnico_nombre
       FROM ordenes_trabajo ot
       LEFT JOIN usuarios u ON ot.tecnico_id = u.id AND u.tenant_id = @tenant
       WHERE ot.vehiculo_id = ? AND ot.tenant_id = @tenant
       ORDER BY ot.fecha_ingreso DESC`,
      [req.params.id]
    );
    res.json({ data: rows });
  } catch (err) {
    fail(res, err);
  }
});

module.exports = router;
