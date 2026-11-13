// Utilidades compartidas de órdenes de trabajo y su puente con las citas.
const { notificarCambioEstado, notificarPresupuestoListo, notificarMecanico } = require('./notificaciones');
const { necesitaReaprobacion, montoSinAprobar, ESTADOS_TRAS_APROBACION } = require('./reglas-orden');
const { getConfig } = require('./configuracion');
const { descontarOrden } = require('./inventario');
const { fechaLocalISO, horaLocal } = require('./fecha');
const { minutosRapidosValidos } = require('./agenda');
const { bloquearAgenda } = require('./cupos');

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
  // No valida cupo (la moto ya está en el taller), pero ocupa lugar: toma el candado del
  // día igual que todas las altas (B-13), para que una reserva que se está validando en
  // paralelo la cuente.
  await bloquearAgenda(conn, o.sucursal_id, fechaLocalISO(offset));
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
  const [[{ ultimo }]] = await db.query(
    `INSERT INTO orden_contadores (tenant_id, anio, ultimo) VALUES (@tenant, ?, 1)
     ON CONFLICT (tenant_id, anio) DO UPDATE SET ultimo = orden_contadores.ultimo + 1
     RETURNING ultimo`,
    [year]
  );
  return `OT-${year}-${String(ultimo).padStart(4, '0')}`;
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
  const { soloDesdeListaEntrega = true, confirmar = false, motivo, usuarioId } = opciones;
  const conn = await db.conexion();
  try {
    await conn.beginTransaction();
    const [[orden]] = await conn.query(
      'SELECT estado, cliente_id, visita_contada FROM ordenes_trabajo WHERE id = ? AND tenant_id = @tenant FOR UPDATE',
      [ordenId]
    );
    if (!orden) { await conn.rollback(); return { notFound: true }; }
    // Nunca reabrir ni cambiar la fecha de una orden terminal, incluso al confirmar.
    const terminal = ['entregada', 'cancelada'].includes(orden.estado);
    const excepcional = orden.estado !== 'lista_entrega';
    const motivoCierre = typeof motivo === 'string' ? motivo.trim() : '';
    if (terminal || (excepcional && (soloDesdeListaEntrega || confirmar !== true || !usuarioId || motivoCierre.length < 5 || motivoCierre.length > 500))) {
      await conn.rollback();
      return { estadoInvalido: true, estadoActual: orden.estado };
    }
    if (excepcional) {
      await conn.query(
        'UPDATE ordenes_trabajo SET cierre_excepcional = ?::jsonb WHERE id = ? AND tenant_id = @tenant',
        [JSON.stringify({ usuario_id: usuarioId, fecha: new Date().toISOString(), estado_anterior: orden.estado, motivo: motivoCierre }), ordenId]
      );
    }
    await conn.query(
      `UPDATE ordenes_trabajo SET estado='entregada', metodo_pago=?, garantia_dias=?,
       observaciones_finales=?, fecha_entrega_real=NOW() WHERE id=? AND tenant_id = @tenant`,
      [metodo_pago || null, garantia_dias || 0, observaciones_finales || null, ordenId]
    );
    // La entrega termina la etapa en curso (normalmente "lista para entrega"): sin
    // esto su tiempo quedaba abierto para siempre en el registro de tiempos.
    await conn.query('UPDATE orden_tiempos SET fin = NOW() WHERE orden_id = ? AND fin IS NULL AND tenant_id = @tenant', [ordenId]);
    // Las piezas del catálogo salen del inventario de la sucursal de la orden.
    await descontarOrden(conn, ordenId, usuarioId || null);

    let cortesiaGanada = false;
    if (!orden.visita_contada) {
      await conn.query('UPDATE ordenes_trabajo SET visita_contada = 1 WHERE id = ? AND tenant_id = @tenant', [ordenId]);
      await conn.query('UPDATE clientes SET visitas = visitas + 1 WHERE id = ? AND tenant_id = @tenant', [orden.cliente_id]);
      const [[cli]] = await conn.query('SELECT visitas FROM clientes WHERE id = ? AND tenant_id = @tenant', [orden.cliente_id]);
      const config = await getConfig(conn);
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

// Una orden entregada o cancelada no vuelve a ninguna etapa de trabajo.
const TERMINALES = ['entregada', 'cancelada'];

// Etapas que llevan registro de tiempo (orden_tiempos). Espejo de ordenes.routes.
const ETAPAS_TIEMPO = ['recepcion', 'diagnostico', 'esperando_aprobacion', 'esperando_repuestos', 'en_reparacion', 'lista_entrega'];

// Avance de estado dirigido por el sistema (no por el usuario): cierra el tiempo de
// la etapa actual, abre el de la nueva, actualiza el estado y sincroniza la cita.
// Se usa al aprobar/rechazar el presupuesto, para que la orden no quede "esperando
// aprobación" después de que el cliente ya decidió. No-op si el estado no cambia.
// Devuelve true solo si cambió el estado.
//
// QP-03: nunca sale de un estado terminal, y el cambio es condicional al estado que
// leyó (compare-and-set): si otra transacción entregó o canceló la orden entre la
// lectura y la escritura, el UPDATE espera su bloqueo, vuelve a evaluar la condición
// sobre la fila ya entregada y no toca nada. Así ningún llamador la reabre, aunque
// se olvide de bloquear la orden antes.
async function avanzarEstadoOrden(db, ordenId, nuevoEstado) {
  const [[o]] = await db.query('SELECT estado FROM ordenes_trabajo WHERE id = ? AND tenant_id = @tenant', [ordenId]);
  if (!o || o.estado === nuevoEstado || TERMINALES.includes(o.estado)) return false;
  const [r] = await db.query(
    'UPDATE ordenes_trabajo SET estado = ? WHERE id = ? AND tenant_id = @tenant AND estado = ?',
    [nuevoEstado, ordenId, o.estado]
  );
  if (!r.affectedRows) return false;
  if (ETAPAS_TIEMPO.includes(o.estado)) {
    await db.query('UPDATE orden_tiempos SET fin = NOW() WHERE orden_id = ? AND etapa = ? AND fin IS NULL AND tenant_id = @tenant', [ordenId, o.estado]);
  }
  if (ETAPAS_TIEMPO.includes(nuevoEstado)) {
    await db.query('INSERT INTO orden_tiempos (tenant_id, orden_id, etapa) VALUES (@tenant, ?, ?)', [ordenId, nuevoEstado]);
  }
  await sincronizarCitaDesdeOrden(db, ordenId, nuevoEstado);
  return true;
}

// Estado al que pasa una orden recién aprobada: si tiene repuestos por conseguir
// (no "disponible") va a esperando_repuestos; si no, directo a en_reparacion.
async function estadoTrasAprobacion(db, ordenId) {
  const [[{ pendientes }]] = await db.query(
    "SELECT COUNT(*) AS pendientes FROM orden_repuestos WHERE orden_id = ? AND estado <> 'disponible' AND rechazado = 0 AND tenant_id = @tenant",
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
// pasa a trabajo (o a esperar repuestos). Con `clienteId` (portal), la orden tiene que
// ser de ese cliente. Devuelve false si al bloquearla ya no estaba esperando la
// aprobación (otra petición la resolvió, la entregó o la canceló).
async function registrarAprobacion(db, ordenId, { clienteId } = {}) {
  const conn = await db.conexion();
  try {
    await conn.beginTransaction();
    const [[orden]] = await bloquearOrden(conn, ordenId, clienteId, 'estado');
    if (!orden || orden.estado !== 'esperando_aprobacion') { await conn.rollback(); return false; }
    await conn.query(
    `UPDATE ordenes_trabajo
        SET aprobacion_cliente = 'aprobado', motivo_rechazo = NULL,
            aprobado_por_cliente = 1, fecha_aprobacion = NOW(),
            total_aprobado = costo_mano_obra + costo_repuestos - descuento
      WHERE id = ? AND tenant_id = @tenant`,
    [ordenId]
  );
    await guardarPresupuestoAprobado(conn, ordenId);
    await avanzarEstadoOrden(conn, ordenId, await estadoTrasAprobacion(conn, ordenId));
    await conn.commit();
    return true;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally { conn.release(); }
}

// SELECT … FOR UPDATE de la orden, el mismo bloqueo que toma cerrarOrden. Con
// `clienteId`, además tiene que ser de ese cliente: se revalida con la fila bloqueada.
function bloquearOrden(conn, ordenId, clienteId, columnas) {
  return clienteId == null
    ? conn.query(`SELECT ${columnas} FROM ordenes_trabajo WHERE id = ? AND tenant_id = @tenant FOR UPDATE`, [ordenId])
    : conn.query(`SELECT ${columnas} FROM ordenes_trabajo WHERE id = ? AND tenant_id = @tenant AND cliente_id = ? FOR UPDATE`, [ordenId, clienteId]);
}

// El cliente rechazó su PRIMER presupuesto (todavía no aprobó nada): la orden vuelve a
// diagnóstico. QP-03: antes era una lectura sin bloqueo seguida de un UPDATE
// incondicional; si entre las dos se entregaba la orden, el rechazo la reabría
// (estado diagnóstico con fecha de entrega) y volvía a dejar editar sus costos.
// Ahora bloquea la orden como el cierre y revalida cliente, estado y que no haya
// aprobación previa dentro de la misma transacción. False si ya no correspondía.
async function registrarRechazoInicial(db, ordenId, motivo, { clienteId } = {}) {
  const conn = await db.conexion();
  try {
    await conn.beginTransaction();
    const [[orden]] = await bloquearOrden(conn, ordenId, clienteId, 'estado, total_aprobado');
    if (!orden || orden.estado !== 'esperando_aprobacion' || orden.total_aprobado !== null) {
      await conn.rollback();
      return false;
    }
    await conn.query(
      `UPDATE ordenes_trabajo
         SET aprobacion_cliente = 'rechazado', motivo_rechazo = ?,
             aprobado_por_cliente = 0, fecha_aprobacion = NOW()
       WHERE tenant_id = @tenant AND id = ?`,
      [motivo, ordenId]
    );
    await avanzarEstadoOrden(conn, ordenId, 'diagnostico');
    await conn.commit();
    return true;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally { conn.release(); }
}

// Se usa dentro de la transacción de edición, antes de tocar cualquier importe.
// El bloqueo es el mismo que usa cerrarOrden: una edición nunca cruza una entrega.
async function validarEdicionCostos(conn, ordenId, res) {
  const [[orden]] = await conn.query('SELECT estado, total_aprobado, presupuesto_aprobado FROM ordenes_trabajo WHERE id = ? AND tenant_id = @tenant FOR UPDATE', [ordenId]);
  if (!orden) { res.status(404).json({ error: 'Orden no encontrada' }); return false; }
  if (['entregada', 'cancelada'].includes(orden.estado)) {
    res.status(409).json({ error: 'Esta orden ya está cerrada: no se pueden modificar sus costos ni repuestos' });
    return false;
  }
  // Compatibilidad con presupuestos aprobados antes de incorporar la copia: si hoy no
  // supera lo aprobado, lo que hay es lo aceptado y se copia antes de editar. Si lo
  // supera (un adicional viejo esperando), no se inventa la copia: al rechazarlo se
  // compensa con descuento (ver registrarRechazoAdicional).
  if (orden.total_aprobado !== null && !orden.presupuesto_aprobado
      && !montoSinAprobar(await totalOrden(conn, ordenId), orden.total_aprobado)) {
    await guardarPresupuestoAprobado(conn, ordenId);
  }
  return true;
}

async function leerPresupuesto(db, ordenId) {
  const [[montos]] = await db.query('SELECT costo_mano_obra, costo_repuestos, descuento FROM ordenes_trabajo WHERE id = ? AND tenant_id = @tenant', [ordenId]);
  const [repuestos] = await db.query('SELECT id, nombre, cantidad, costo_unitario, estado, adicional FROM orden_repuestos WHERE orden_id = ? AND rechazado = 0 AND tenant_id = @tenant ORDER BY id', [ordenId]);
  return { ...montos, repuestos };
}

async function guardarPresupuestoAprobado(db, ordenId) {
  const presupuesto = await leerPresupuesto(db, ordenId);
  await db.query('UPDATE ordenes_trabajo SET presupuesto_aprobado = ?::jsonb WHERE id = ? AND tenant_id = @tenant', [JSON.stringify(presupuesto), ordenId]);
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
  if (!pide) {
    // Un cambio que no le sube la cuenta por encima de lo aprobado (p. ej. quitar una
    // pieza o bajar la mano de obra) pasa a ser lo aceptado: si después se rechaza un
    // adicional, se vuelve a esto y no a una pieza que el taller ya había quitado.
    if (o.total_aprobado !== null && o.aprobacion_cliente === 'aprobado'
        && o.estado !== 'esperando_aprobacion' && !montoSinAprobar(o.total, o.total_aprobado)) {
      await guardarPresupuestoAprobado(db, ordenId);
    }
    return false;
  }
  await db.query(
    "UPDATE ordenes_trabajo SET aprobacion_cliente = 'pendiente', motivo_rechazo = NULL WHERE id = ? AND tenant_id = @tenant",
    [ordenId]
  );
  await avanzarEstadoOrden(db, ordenId, 'esperando_aprobacion');
  await notificarPresupuestoListo(db, ordenId, { adicional: true });
  return true;
}

// El cliente rechazó solo el adicional: lo que ya había aprobado sigue en pie y la
// orden vuelve a la etapa en que estaba antes de pedirle la aprobación. Los importes
// vuelven a la copia aprobada (presupuesto_aprobado); las piezas nuevas quedan con
// rechazado = 1 (no se borran, pero dejan de sumar) y la propuesta entera se guarda en
// adicionales_rechazados. No se usa estadoTrasAprobacion: mandaría la orden a
// "Esperando repuestos" por piezas que ya no se van a comprar.
async function registrarRechazoAdicional(db, ordenId, motivo, { clienteId } = {}) {
  const conn = await db.conexion();
  let sinCopia = false;
  try {
    await conn.beginTransaction();
    const [[orden]] = await bloquearOrden(conn, ordenId, clienteId, 'estado, presupuesto_aprobado, total_aprobado');
    if (!orden || orden.estado !== 'esperando_aprobacion' || orden.total_aprobado === null) { await conn.rollback(); return false; }
    const propuesta = await leerPresupuesto(conn, ordenId);
    const aprobado = orden.presupuesto_aprobado;
    // Sin una copia histórica no se inventa la distribución de un presupuesto viejo.
    // Se conserva el detalle y se compensa el exceso con descuento hasta lo aprobado.
    await conn.query('UPDATE ordenes_trabajo SET adicionales_rechazados = adicionales_rechazados || ?::jsonb WHERE id = ? AND tenant_id = @tenant',
      [JSON.stringify([{ fecha: new Date().toISOString(), motivo, presupuesto: propuesta }]), ordenId]);
    if (aprobado) {
      const ids = aprobado.repuestos.map(p => p.id);
      await conn.query('UPDATE orden_repuestos SET rechazado = 1 WHERE orden_id = ? AND tenant_id = @tenant AND NOT (id = ANY(?::int[]))', [ordenId, ids]);
      for (const p of aprobado.repuestos) {
        await conn.query(`INSERT INTO orden_repuestos (tenant_id, id, orden_id, nombre, cantidad, costo_unitario, estado, adicional, rechazado)
          VALUES (@tenant, ?, ?, ?, ?, ?, ?, ?, 0)
          ON CONFLICT (id) DO UPDATE SET nombre = EXCLUDED.nombre, cantidad = EXCLUDED.cantidad,
            costo_unitario = EXCLUDED.costo_unitario, rechazado = 0
          WHERE orden_repuestos.tenant_id = @tenant AND orden_repuestos.orden_id = EXCLUDED.orden_id`,
          [p.id, ordenId, p.nombre, p.cantidad, p.costo_unitario, p.estado, p.adicional]);
      }
      await conn.query('UPDATE ordenes_trabajo SET costo_mano_obra = ?, costo_repuestos = ?, descuento = ? WHERE id = ? AND tenant_id = @tenant',
        [aprobado.costo_mano_obra, aprobado.costo_repuestos, aprobado.descuento, ordenId]);
    } else {
      // QP-07: presupuesto aprobado antes de que existiera la copia. No se sabe cómo
      // se repartía, pero sí qué piezas NO aprobó nunca: las que se agregaron como
      // adicional después de su última aprobación (fecha_aprobacion). Esas son la
      // propuesta que acaba de rechazar: quedan rechazado = 1 (no se borran y siguen
      // en adicionales_rechazados) para que el portal no las muestre y no dejen la
      // orden esperando repuestos que no se van a comprar. Lo demás no se toca; si aun
      // así la cuenta pasa lo aprobado, el exceso se compensa con descuento, y nunca
      // se sube un descuento que ya alcanzaba. Recepción recibe el aviso para conciliar.
      sinCopia = true;
      await conn.query(
        `UPDATE orden_repuestos SET rechazado = 1
          WHERE orden_id = ? AND tenant_id = @tenant AND rechazado = 0 AND adicional = 1
            AND created_at > (SELECT fecha_aprobacion FROM ordenes_trabajo WHERE id = ? AND tenant_id = @tenant)`,
        [ordenId, ordenId]
      );
      await conn.query(
        `UPDATE ordenes_trabajo SET costo_repuestos = (SELECT COALESCE(SUM(cantidad * costo_unitario), 0) FROM orden_repuestos WHERE rechazado = 0 AND orden_id = ? AND tenant_id = @tenant)
          WHERE id = ? AND tenant_id = @tenant`,
        [ordenId, ordenId]
      );
      await conn.query('UPDATE ordenes_trabajo SET descuento = GREATEST(descuento, costo_mano_obra + costo_repuestos - total_aprobado) WHERE id = ? AND tenant_id = @tenant', [ordenId]);
    }
    await conn.query(
    "UPDATE ordenes_trabajo SET aprobacion_cliente = 'aprobado', motivo_rechazo = ? WHERE id = ? AND tenant_id = @tenant",
    [motivo, ordenId]
  );
  const [[previa]] = await conn.query(
    `SELECT etapa FROM orden_tiempos
      WHERE orden_id = ? AND etapa <> 'esperando_aprobacion' AND tenant_id = @tenant
      ORDER BY inicio DESC, id DESC LIMIT 1`,
    [ordenId]
  );
  const volverA = previa && ESTADOS_TRAS_APROBACION.includes(previa.etapa)
    ? previa.etapa
    : await estadoTrasAprobacion(conn, ordenId);
  await avanzarEstadoOrden(conn, ordenId, volverA);
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally { conn.release(); }
  await avisarRechazoAdicional(db, ordenId, motivo, sinCopia);
  return true;
}

async function avisarRechazoAdicional(db, ordenId, motivo, sinCopia) {
  try {
    const [[o]] = await db.query(
      'SELECT numero_orden, tecnico_id, recepcionista_id, sucursal_id FROM ordenes_trabajo WHERE id = ? AND tenant_id = @tenant',
      [ordenId]
    );
    if (!o) return;
    const texto = `El cliente rechazó el adicional de la orden ${o.numero_orden}`
      + (motivo ? `: «${String(motivo).slice(0, 200)}»` : '')
      + '. El adicional quedó rechazado y fuera del total a cobrar.'
      + (sinCopia ? ' Era un presupuesto aprobado antes de que se guardara su copia: revisá las piezas y el descuento.' : '');
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
  validarEdicionCostos,
  avanzarEstadoOrden, estadoTrasAprobacion,
  totalOrden, esAdicional, registrarAprobacion, revisarAdicional, registrarRechazoAdicional,
  registrarRechazoInicial, TERMINALES,
};
