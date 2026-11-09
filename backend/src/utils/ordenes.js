// Utilidades compartidas de órdenes de trabajo y su puente con las citas.
const { notificarCambioEstado, notificarPresupuestoListo, notificarMecanico } = require('./notificaciones');
const { necesitaReaprobacion, ESTADOS_TRAS_APROBACION } = require('./reglas-orden');
const { getConfig } = require('./configuracion');
const { fechaLocalISO, horaLocal } = require('./fecha');
const { minutosRapidosValidos } = require('./agenda');

// Mapeo del flujo rico de la orden → flujo simple de la cita (lo que ve el cliente).
const MAP_ORDEN_A_CITA = {
  recepcion: 'agendado',
  diagnostico: 'en_revision',
  esperando_aprobacion: 'en_revision',
  esperando_repuestos: 'en_revision',
  en_reparacion: 'en_mantenimiento',
  lista_entrega: 'listo',
  entregada: 'entregado',
  cancelada: 'cancelado',
};

// Le crea su cita a una orden abierta sin agendar (cliente que llegó sin cita, u
// orden creada en administración). El cliente solo ve citas en el portal: sin esto
// la orden no le aparecía. La moto ya está en el taller, así que nace "en revisión"
// y con la llegada marcada. Sin tipo de servicio: el portal muestra entonces el
// problema que se anotó ("Ruido en la cadena"), que dice más que una categoría.
// Corre dentro de la transacción de la orden (`conn`).
// Devuelve el id de la cita; quien llama avisa al cliente después del commit.
async function crearCitaDeOrden(conn, o) {
  const config = await getConfig(conn);
  const offset = Number(config.zona_horaria_offset) || -6;
  const [r] = await conn.query(
    `INSERT INTO citas (tenant_id, cliente_id, vehiculo_id, usuario_id, tecnico_id, sucursal_id, fecha, hora, motivo,
                        estado, fecha_inicio, hora_llegada, orden_id, creada_por_orden, duracion_min)
     VALUES (@tenant, ?, ?, ?, ?, ?, ?, ?, ?, 'en_revision', NOW(), NOW(), ?, 1, ?)`,
    [
      o.cliente_id, o.vehiculo_id, o.usuario_id || null, o.tecnico_id || null, o.sucursal_id || null,
      fechaLocalISO(offset), horaLocal(offset), o.problema_reportado, o.orden_id,
      // Servicio rápido (20, 30 o 40 min): ocupa solo ese rato de la hora en que llegó.
      minutosRapidosValidos(o.duracion_min) ? Number(o.duracion_min) : null,
    ]
  );
  return r.insertId;
}

// Genera numero_orden OT-YYYY-XXXX con un contador atómico por año Y POR TALLER: es un
// correlativo que ve el cliente, y un taller nuevo no debe empezar en el 43 de otro.
// El INSERT y el SELECT corren en la MISMA conexión (LAST_INSERT_ID es por conexión).
async function generarNumeroOrden(db) {
  const year = new Date().getFullYear();
  const conn = await db.conexion();
  try {
    await conn.query(
      `INSERT INTO orden_contadores (tenant_id, anio, ultimo) VALUES (@tenant, ?, LAST_INSERT_ID(1))
       ON DUPLICATE KEY UPDATE ultimo = LAST_INSERT_ID(ultimo + 1)`,
      [year]
    );
    const [[{ n }]] = await conn.sinScope('SELECT LAST_INSERT_ID() AS n');
    return `OT-${year}-${String(n).padStart(4, '0')}`;
  } finally {
    conn.release();
  }
}

// Refleja el estado de una orden en su cita vinculada (si existe). Nunca lanza:
// si algo falla, lo loguea y sigue (no debe romper el cambio de estado de la orden).
async function sincronizarCitaDesdeOrden(db, ordenId, ordenEstado) {
  try {
    const estadoCita = MAP_ORDEN_A_CITA[ordenEstado];
    if (!estadoCita) return;
    const [[cita]] = await db.query('SELECT id, estado FROM citas WHERE orden_id = ? AND tenant_id = @tenant LIMIT 1', [ordenId]);
    if (!cita || cita.estado === estadoCita) return; // sin cita o sin cambio real

    const sets = ['estado = ?'];
    const params = [estadoCita];
    // Marca el inicio del trabajo al arrancar.
    if (cita.estado === 'agendado' && estadoCita !== 'agendado' && estadoCita !== 'cancelado') {
      sets.push('fecha_inicio = COALESCE(fecha_inicio, NOW())');
    }
    if (estadoCita === 'listo') {
      sets.push('fecha_listo = COALESCE(fecha_listo, NOW())');
    }
    if (estadoCita === 'entregado') {
      sets.push('fecha_fin = NOW()');
      const [[o]] = await db.query(
        'SELECT (costo_mano_obra + costo_repuestos - descuento) AS total FROM ordenes_trabajo WHERE id = ? AND tenant_id = @tenant',
        [ordenId]
      );
      if (o) { sets.push('monto = ?'); params.push(Number(o.total) || 0); }
    }
    params.push(cita.id);
    await db.query(`UPDATE citas SET ${sets.join(', ')} WHERE id = ? AND tenant_id = @tenant`, params);
    await notificarCambioEstado(db, cita.id, estadoCita);
  } catch (err) {
    console.error('⚠️  No se pudo sincronizar la cita desde la orden:', err.message);
  }
}

// Fidelización: cada cuántas entregas el cliente gana una cortesía (configurable desde admin).

// Cierra (entrega) una orden en una transacción: la marca entregada, registra pago,
// garantía y observaciones, cuenta la visita una sola vez y otorga cortesía cada N
// entregas; luego sincroniza la cita vinculada. Compartido por el cierre de admin y
// la entrega de recepción para no duplicar la lógica de fidelización.
// Devuelve { notFound } | { estadoInvalido, estadoActual } | { cortesiaGanada }.
async function cerrarOrden(db, ordenId, datos = {}, opciones = {}) {
  const { metodo_pago, garantia_dias, observaciones_finales } = datos;
  const { soloDesdeListaEntrega = false } = opciones;
  const conn = await db.conexion();
  try {
    await conn.beginTransaction();
    const [[orden]] = await conn.query(
      'SELECT estado, cliente_id, visita_contada FROM ordenes_trabajo WHERE id = ? AND tenant_id = @tenant FOR UPDATE',
      [ordenId]
    );
    if (!orden) { await conn.rollback(); return { notFound: true }; }
    // Recepción solo entrega órdenes que el mecánico ya dejó listas.
    if (soloDesdeListaEntrega && orden.estado !== 'lista_entrega') {
      await conn.rollback();
      return { estadoInvalido: true, estadoActual: orden.estado };
    }
    await conn.query(
      `UPDATE ordenes_trabajo SET estado='entregada', metodo_pago=?, garantia_dias=?,
       observaciones_finales=?, fecha_entrega_real=NOW() WHERE id=? AND tenant_id = @tenant`,
      [metodo_pago || null, garantia_dias || 0, observaciones_finales || null, ordenId]
    );
    // La entrega termina la etapa en curso (normalmente "lista para entrega"): sin
    // esto su tiempo quedaba abierto para siempre en el registro de tiempos.
    await conn.query('UPDATE orden_tiempos SET fin = NOW() WHERE orden_id = ? AND fin IS NULL AND tenant_id = @tenant', [ordenId]);

    let cortesiaGanada = false;
    if (!orden.visita_contada) {
      await conn.query('UPDATE ordenes_trabajo SET visita_contada = 1 WHERE id = ? AND tenant_id = @tenant', [ordenId]);
      await conn.query('UPDATE clientes SET visitas = visitas + 1 WHERE id = ? AND tenant_id = @tenant', [orden.cliente_id]);
      const [[cli]] = await conn.query('SELECT visitas FROM clientes WHERE id = ? AND tenant_id = @tenant', [orden.cliente_id]);
      const config = await getConfig(db);
      const visitasParaCortesia = Number(config.visitas_para_cortesia) || 7;
      if (cli && cli.visitas > 0 && cli.visitas % visitasParaCortesia === 0) {
        await conn.query('UPDATE clientes SET cortesia_disponible = 1 WHERE id = ? AND tenant_id = @tenant', [orden.cliente_id]);
        cortesiaGanada = true;
      }
    }

    await conn.commit();
    await sincronizarCitaDesdeOrden(db, ordenId, 'entregada');
    return { cortesiaGanada };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// Etapas que llevan registro de tiempo (orden_tiempos). Espejo de ordenes.routes.
const ETAPAS_TIEMPO = ['recepcion', 'diagnostico', 'esperando_aprobacion', 'esperando_repuestos', 'en_reparacion', 'lista_entrega'];

// Avance de estado dirigido por el sistema (no por el usuario): cierra el tiempo de
// la etapa actual, abre el de la nueva, actualiza el estado y sincroniza la cita.
// Se usa al aprobar/rechazar el presupuesto, para que la orden no quede "esperando
// aprobación" después de que el cliente ya decidió. No-op si el estado no cambia.
async function avanzarEstadoOrden(db, ordenId, nuevoEstado) {
  const [[o]] = await db.query('SELECT estado FROM ordenes_trabajo WHERE id = ? AND tenant_id = @tenant', [ordenId]);
  if (!o || o.estado === nuevoEstado) return;
  if (ETAPAS_TIEMPO.includes(o.estado)) {
    await db.query('UPDATE orden_tiempos SET fin = NOW() WHERE orden_id = ? AND etapa = ? AND fin IS NULL AND tenant_id = @tenant', [ordenId, o.estado]);
  }
  await db.query('UPDATE ordenes_trabajo SET estado = ? WHERE id = ? AND tenant_id = @tenant', [nuevoEstado, ordenId]);
  if (ETAPAS_TIEMPO.includes(nuevoEstado)) {
    await db.query('INSERT INTO orden_tiempos (tenant_id, orden_id, etapa) VALUES (@tenant, ?, ?)', [ordenId, nuevoEstado]);
  }
  await sincronizarCitaDesdeOrden(db, ordenId, nuevoEstado);
}

// Estado al que pasa una orden recién aprobada: si tiene repuestos por conseguir
// (no "disponible") va a esperando_repuestos; si no, directo a en_reparacion.
async function estadoTrasAprobacion(db, ordenId) {
  const [[{ pendientes }]] = await db.query(
    "SELECT COUNT(*) AS pendientes FROM orden_repuestos WHERE orden_id = ? AND estado <> 'disponible' AND tenant_id = @tenant",
    [ordenId]
  );
  return pendientes > 0 ? 'esperando_repuestos' : 'en_reparacion';
}

// Total que se le cobraría hoy al cliente (mano de obra + repuestos − descuento).
async function totalOrden(db, ordenId) {
  const [[o]] = await db.query(
    'SELECT (costo_mano_obra + costo_repuestos - descuento) AS total FROM ordenes_trabajo WHERE id = ? AND tenant_id = @tenant',
    [ordenId]
  );
  return o ? Number(o.total) || 0 : 0;
}

// 1 si lo que se agregue ahora a la orden va por encima de un presupuesto que el
// cliente ya aprobó alguna vez (el portal se lo muestra marcado como adicional), 0
// si no. También cuenta mientras espera que apruebe un adicional anterior.
async function esAdicional(db, ordenId) {
  const [[o]] = await db.query('SELECT total_aprobado FROM ordenes_trabajo WHERE id = ? AND tenant_id = @tenant', [ordenId]);
  return o && o.total_aprobado !== null ? 1 : 0;
}

// El cliente aprobó (desde el portal o de palabra en el mostrador): se guarda cuánto
// aprobó, para saber después si algo que se agregue le sube la cuenta, y la orden
// pasa a trabajo (o a esperar repuestos).
async function registrarAprobacion(db, ordenId) {
  await db.query(
    `UPDATE ordenes_trabajo
        SET aprobacion_cliente = 'aprobado', motivo_rechazo = NULL,
            aprobado_por_cliente = 1, fecha_aprobacion = NOW(),
            total_aprobado = costo_mano_obra + costo_repuestos - descuento
      WHERE id = ? AND tenant_id = @tenant`,
    [ordenId]
  );
  await avanzarEstadoOrden(db, ordenId, await estadoTrasAprobacion(db, ordenId));
}

// Después de cualquier cambio de costo (repuestos, mano de obra, descuento). Si el
// cliente ya había aprobado y la cuenta le subió, la orden vuelve a "Esperando
// aprobación" y se le avisa que hay un adicional. Devuelve true si pasó eso.
async function revisarAdicional(db, ordenId, totalAntes) {
  const [[o]] = await db.query(
    `SELECT estado, aprobacion_cliente, total_aprobado,
            (costo_mano_obra + costo_repuestos - descuento) AS total
       FROM ordenes_trabajo WHERE id = ? AND tenant_id = @tenant`,
    [ordenId]
  );
  if (!o) return false;
  const pide = necesitaReaprobacion({
    estado: o.estado,
    aprobacion: o.aprobacion_cliente,
    totalAprobado: o.total_aprobado === null ? null : Number(o.total_aprobado),
    totalAntes,
    totalDespues: Number(o.total),
  });
  if (!pide) return false;
  await db.query(
    "UPDATE ordenes_trabajo SET aprobacion_cliente = 'pendiente', motivo_rechazo = NULL WHERE id = ? AND tenant_id = @tenant",
    [ordenId]
  );
  await avanzarEstadoOrden(db, ordenId, 'esperando_aprobacion');
  await notificarPresupuestoListo(db, ordenId, { adicional: true });
  return true;
}

// El cliente rechazó solo el adicional: lo que ya había aprobado sigue en pie, la
// orden vuelve a la etapa en que estaba antes de pedirle la aprobación, y el
// mecánico y recepción se enteran para quitar lo que no aprobó antes de facturar.
// No se usa estadoTrasAprobacion: el repuesto rechazado sigue en la lista sin
// conseguir y mandaría la orden a "Esperando repuestos" por algo que no se va a comprar.
async function registrarRechazoAdicional(db, ordenId, motivo) {
  await db.query(
    "UPDATE ordenes_trabajo SET aprobacion_cliente = 'aprobado', motivo_rechazo = ? WHERE id = ? AND tenant_id = @tenant",
    [motivo, ordenId]
  );
  const [[previa]] = await db.query(
    `SELECT etapa FROM orden_tiempos
      WHERE orden_id = ? AND etapa <> 'esperando_aprobacion' AND tenant_id = @tenant
      ORDER BY inicio DESC, id DESC LIMIT 1`,
    [ordenId]
  );
  const volverA = previa && ESTADOS_TRAS_APROBACION.includes(previa.etapa)
    ? previa.etapa
    : await estadoTrasAprobacion(db, ordenId);
  await avanzarEstadoOrden(db, ordenId, volverA);
  try {
    const [[o]] = await db.query(
      'SELECT numero_orden, tecnico_id, recepcionista_id, sucursal_id FROM ordenes_trabajo WHERE id = ? AND tenant_id = @tenant',
      [ordenId]
    );
    if (!o) return;
    const texto = `El cliente rechazó el adicional de la orden ${o.numero_orden}`
      + (motivo ? `: «${String(motivo).slice(0, 200)}»` : '')
      + '. Quitá lo que no aprobó antes de facturar.';
    await notificarMecanico(db, o.tecnico_id, texto);
    // mensajes_internos exige un remitente del personal: el que recibió la moto o,
    // si no hay, el mecánico.
    const remitente = o.recepcionista_id || o.tecnico_id;
    if (remitente) {
      await db.query(
        `INSERT INTO mensajes_internos (tenant_id, remitente_id, destino_rol, mensaje, orden_id, tipo, sucursal_id)
         VALUES (@tenant, ?, 'recepcion', ?, ?, 'sistema', ?)`,
        [remitente, texto, ordenId, o.sucursal_id || null]
      );
    }
  } catch (err) {
    console.error('⚠️  No se pudo avisar el rechazo del adicional:', err.message);
  }
}

module.exports = {
  generarNumeroOrden, MAP_ORDEN_A_CITA, sincronizarCitaDesdeOrden, cerrarOrden,
  crearCitaDeOrden,
  avanzarEstadoOrden, estadoTrasAprobacion,
  totalOrden, esAdicional, registrarAprobacion, revisarAdicional, registrarRechazoAdicional,
};
