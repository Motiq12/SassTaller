// T04: ids de OTRO taller (o que no corresponden) en el CUERPO de altas y ediciones.
// Mismos contratos HTTP en npm test (test/pg-referencias.test.js) y en la prueba completa
// de dos empresas (scripts/prueba-dos-empresas.js).
//
// Cada negativa comprueba tres cosas: el código (400/404, nunca 500 ni 2xx), el campo que
// marca la respuesta, y que la fila no cambió. Cada ruta tiene además su control positivo:
// si el control falla, la negativa no prueba nada.
//
// ctx = {
//   db,                       // query(sql con ?, params) -> [filas]; INSERT ... RETURNING id
//   pedir(met, ruta, { token, body }) -> { status, json }
//   conexionAparte()          // otra conexión (para la carrera): { query, end }
//   propio: { tenantId, adminId, tecnicoId, recepcionId, sedeId, clienteId, vehiculoId,
//             tokens: { admin, recepcion, tecnico, cliente } }   // cliente = clienteId en el portal
//   otro:   { tenantId }      // el taller ajeno
// }
const assert = require('node:assert/strict');

// Relaciones del negocio: hijo.columna -> padre. Ninguna puede cruzar de taller.
// recompensas_canjeadas.orden_id no tiene FK en la base (0001): por eso, además del cruce,
// se concilia que la orden exista y que el canje vigente no cuelgue de una orden cancelada.
const RELACIONES = [
  ['vehiculos', 'cliente_id', 'clientes'],
  ['citas', 'cliente_id', 'clientes'], ['citas', 'vehiculo_id', 'vehiculos'], ['citas', 'tecnico_id', 'usuarios'],
  ['citas', 'usuario_id', 'usuarios'], ['citas', 'sucursal_id', 'sucursales'], ['citas', 'orden_id', 'ordenes_trabajo'],
  ['cita_servicios', 'cita_id', 'citas'],
  ['ordenes_trabajo', 'cliente_id', 'clientes'], ['ordenes_trabajo', 'vehiculo_id', 'vehiculos'],
  ['ordenes_trabajo', 'tecnico_id', 'usuarios'], ['ordenes_trabajo', 'recepcionista_id', 'usuarios'],
  ['ordenes_trabajo', 'sucursal_id', 'sucursales'],
  ['orden_avances', 'orden_id', 'ordenes_trabajo'], ['orden_avances', 'usuario_id', 'usuarios'],
  ['orden_checklist', 'orden_id', 'ordenes_trabajo'], ['orden_fotos', 'orden_id', 'ordenes_trabajo'],
  ['orden_repuestos', 'orden_id', 'ordenes_trabajo'], ['orden_tiempos', 'orden_id', 'ordenes_trabajo'],
  ['garantias', 'orden_id', 'ordenes_trabajo'], ['garantias', 'creado_por', 'usuarios'], ['garantia_fotos', 'garantia_id', 'garantias'],
  ['notificaciones', 'cliente_id', 'clientes'], ['notificaciones', 'cita_id', 'citas'],
  ['mensajes_internos', 'remitente_id', 'usuarios'], ['mensajes_internos', 'destino_id', 'usuarios'],
  ['mensajes_internos', 'orden_id', 'ordenes_trabajo'], ['mensajes_internos', 'sucursal_id', 'sucursales'],
  ['mensaje_lecturas', 'mensaje_id', 'mensajes_internos'], ['mensaje_lecturas', 'usuario_id', 'usuarios'],
  ['recompensas_canjeadas', 'cliente_id', 'clientes'], ['recompensas_canjeadas', 'orden_id', 'ordenes_trabajo'],
  ['recompensas_canjeadas', 'aplicado_por', 'usuarios'],
  ['tareas_mecanico', 'tecnico_id', 'usuarios'], ['tareas_mecanico', 'asignado_por', 'usuarios'],
  ['usuarios', 'sucursal_id', 'sucursales'], ['usuarios', 'rol_id', 'roles'],
  ['bloqueos_horario', 'sucursal_id', 'sucursales'], ['feriados', 'sucursal_id', 'sucursales'],
  ['sesiones_personal', 'usuario_id', 'usuarios'], ['actividad_personal', 'usuario_id', 'usuarios'],
  ['ordenes_eliminadas', 'cliente_id', 'clientes'],
];

// Devuelve la lista de problemas (vacía = la base cuadra). Las tablas que esta base no
// tenga se saltean, pero se cuentan: quien llama ve cuántas relaciones se revisaron.
async function conciliar(db) {
  const problemas = [];
  let revisadas = 0;
  const [cols] = await db.query("SELECT table_name AS t, column_name AS c FROM information_schema.columns WHERE table_schema = current_schema()");
  const hay = new Set(cols.map((x) => `${x.t}.${x.c}`));
  for (const [hijo, col, padre] of RELACIONES) {
    if (!hay.has(`${hijo}.${col}`) || !hay.has(`${hijo}.tenant_id`) || !hay.has(`${padre}.tenant_id`)) continue;
    const [[{ n }]] = await db.query(`SELECT COUNT(*)::int AS n FROM "${hijo}" x JOIN "${padre}" y ON y.id = x."${col}" WHERE x.tenant_id <> y.tenant_id`);
    revisadas++;
    if (n) problemas.push(`${hijo}.${col} -> ${padre}: ${n} filas de otro taller`);
  }
  const [[{ huerfanos }]] = await db.query(
    `SELECT COUNT(*)::int AS huerfanos FROM recompensas_canjeadas r
      WHERE r.orden_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM ordenes_trabajo o WHERE o.id = r.orden_id AND o.tenant_id = r.tenant_id)`);
  if (huerfanos) problemas.push(`recompensas_canjeadas: ${huerfanos} canjes con una orden que no existe en su taller`);
  const [[{ otroCliente }]] = await db.query(
    `SELECT COUNT(*)::int AS "otroCliente" FROM recompensas_canjeadas r JOIN ordenes_trabajo o ON o.id = r.orden_id AND o.tenant_id = r.tenant_id
      WHERE o.cliente_id <> r.cliente_id`);
  if (otroCliente) problemas.push(`recompensas_canjeadas: ${otroCliente} canjes sobre la orden de otro cliente`);
  const [[{ sobreCancelada }]] = await db.query(
    `SELECT COUNT(*)::int AS "sobreCancelada" FROM recompensas_canjeadas r JOIN ordenes_trabajo o ON o.id = r.orden_id AND o.tenant_id = r.tenant_id
      WHERE o.estado = 'cancelada' AND r.devuelta_en IS NULL`);
  if (sobreCancelada) problemas.push(`recompensas_canjeadas: ${sobreCancelada} canjes vigentes sobre órdenes canceladas`);
  revisadas += 3;
  return { problemas, revisadas };
}

function casosReferencias(ctx) {
  const casos = [];
  const P = ctx.propio;
  const T = P.tokens;
  const q = (...args) => ctx.db.query(...args);
  const uno = async (sql, params) => (await q(sql, params))[0][0];
  const pedir = (met, ruta, body, token = T.admin) => ctx.pedir(met, ruta, { token, body });
  const sello = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
  let secuencia = 0;
  const f = {}; // filas de prueba, se crean una vez

  // Fecha futura dentro de la anticipación por defecto, nunca domingo.
  const dia = new Date(Date.now() + 5 * 864e5);
  while (dia.getUTCDay() === 0) dia.setUTCDate(dia.getUTCDate() + 1);
  const FECHA = dia.toISOString().slice(0, 10);

  const insertar = async (sql, params) => (await uno(`${sql} RETURNING id`, params)).id;
  const cliente = (tenant, extra = '1') => insertar(
    `INSERT INTO clientes (tenant_id, nombre, apellido, telefono, activo, cortesia_disponible) VALUES (?, 'Ref', ?, '88880000', ${extra}, 1)`, [tenant, `T04-${sello}-${++secuencia}`]);
  const vehiculo = (tenant, clienteId) => insertar(
    "INSERT INTO vehiculos (tenant_id, cliente_id, placa, marca, modelo, tipo) VALUES (?, ?, ?, 'Toyota', 'T04', 'auto')", [tenant, clienteId, `R${++secuencia}${sello}`.slice(0, 15).toUpperCase()]);
  const usuario = (tenant, rol, activo = 1) => insertar(
    "INSERT INTO usuarios (tenant_id, nombre, email, password_hash, rol, activo) VALUES (?, 'Ref', ?, 'no-es-clave-real', ?, ?)", [tenant, `t04-${sello}-${++secuencia}@prueba.test`, rol, activo]);
  const orden = (tenant, clienteId, vehiculoId, { estado = 'recepcion', sede = null, tecnico = null, recepcionista = null } = {}) => insertar(
    `INSERT INTO ordenes_trabajo (tenant_id, cliente_id, vehiculo_id, numero_orden, problema_reportado, estado, sucursal_id, tecnico_id, recepcionista_id)
     VALUES (?, ?, ?, ?, 'Prueba T04', ?, ?, ?, ?)`, [tenant, clienteId, vehiculoId, `T04-${sello}-${++secuencia}`, estado, sede, tecnico, recepcionista]);
  const cita = (tenant, clienteId, vehiculoId, sede, hora = '10:00') => insertar(
    "INSERT INTO citas (tenant_id, cliente_id, vehiculo_id, sucursal_id, fecha, hora, motivo, estado) VALUES (?, ?, ?, ?, ?, ?, 'Prueba T04', 'agendado')", [tenant, clienteId, vehiculoId, sede, FECHA, hora]);

  async function preparar() {
    if (f.listo) return;
    const F = ctx.otro.tenantId;
    // Del otro taller: lo que B (el que pide) no debería poder colgarse.
    f.sedeF = await insertar("INSERT INTO sucursales (tenant_id, nombre, activa) VALUES (?, 'Sede ajena T04', 1)", [F]);
    f.cF = await cliente(F);
    f.vF = await vehiculo(F, f.cF);
    f.tecF = await usuario(F, 'tecnico');
    f.ordenF = await orden(F, f.cF, f.vF, { sede: f.sedeF, recepcionista: f.tecF });
    f.citaF = await cita(F, f.cF, f.vF, f.sedeF);
    // Del propio taller, pero que tampoco corresponde.
    const Pt = P.tenantId;
    f.c1 = P.clienteId; f.v1 = P.vehiculoId;
    f.c2 = await cliente(Pt);
    f.v2 = await vehiculo(Pt, f.c2);
    f.cInactivo = await cliente(Pt, '0');
    f.tecInactivo = await usuario(Pt, 'tecnico', 0);
    f.orden = await orden(Pt, f.c1, f.v1, { sede: P.sedeId, tecnico: P.tecnicoId, recepcionista: P.adminId });
    f.orden2 = await orden(Pt, f.c2, f.v2, { sede: P.sedeId, recepcionista: P.adminId });
    f.cita = await cita(Pt, f.c1, f.v1, P.sedeId, '10:00');
    f.citaPortal = await cita(Pt, f.c1, f.v1, P.sedeId, '11:00');
    // Un servicio del catálogo (el portal solo acepta esos). Si el taller ya tiene, se usa
    // uno de los suyos: el servidor guarda el catálogo en caché y no vería uno recién creado.
    const existente = await uno('SELECT nombre FROM servicios WHERE tenant_id = ? AND activo = 1 ORDER BY id LIMIT 1', [Pt]);
    f.servicio = existente ? existente.nombre : `Revisión T04 ${sello}`;
    if (!existente) await q('INSERT INTO servicios (tenant_id, nombre, activo) VALUES (?, ?, 1)', [Pt, f.servicio]);
    f.listo = true;
  }
  const caso = (nombre, fn) => casos.push([nombre, async () => { await preparar(); await fn(); }]);

  const rechazo = (r, codigo, campo, msg) => {
    assert.equal(r.status, codigo, `${msg}: ${JSON.stringify(r.json)}`);
    if (campo) assert.equal(r.json && r.json.campo, campo, `${msg}: el error debe marcar ${campo} (${JSON.stringify(r.json)})`);
  };
  const exito = (r, msg) => assert.ok(r.status >= 200 && r.status < 300, `${msg}: ${r.status} ${JSON.stringify(r.json)}`);
  const filaOrden = (id) => uno('SELECT cliente_id, vehiculo_id, sucursal_id, tecnico_id, estado FROM ordenes_trabajo WHERE id = ?', [id]);
  const filaCita = (id) => uno("SELECT cliente_id, vehiculo_id, sucursal_id, tecnico_id, to_char(fecha, 'YYYY-MM-DD') AS fecha, to_char(hora, 'HH24:MI') AS hora FROM citas WHERE id = ?", [id]);
  const cuenta = async (sql, params) => Number((await uno(sql, params)).n);

  // ── Cortesía (QP-02 y QP-05) ──
  const cortesia = (clienteId, body, token = T.admin) => pedir('PATCH', `/clientes/${clienteId}/cortesia`, body, token);
  const conCortesia = (id) => q('UPDATE clientes SET cortesia_disponible = 1 WHERE id = ?', [id]);
  const estadoCortesia = async (id) => ({
    disponible: Number((await uno('SELECT cortesia_disponible FROM clientes WHERE id = ?', [id])).cortesia_disponible),
    canjes: await cuenta('SELECT COUNT(*) AS n FROM recompensas_canjeadas WHERE cliente_id = ?', [id]),
  });
  async function noConsume(body, codigo, campo, msg, token = T.admin) {
    await conCortesia(f.c1);
    const antes = await estadoCortesia(f.c1);
    rechazo(await cortesia(f.c1, body, token), codigo, campo, msg);
    assert.deepEqual(await estadoCortesia(f.c1), { disponible: 1, canjes: antes.canjes }, `${msg}: no debe consumir la cortesía`);
  }

  caso('cortesía: la orden de otro taller da 404 y no consume (admin y recepción)', async () => {
    await noConsume({ orden_id: f.ordenF }, 404, 'orden_id', 'orden ajena (admin)');
    await noConsume({ orden_id: f.ordenF }, 404, 'orden_id', 'orden ajena (recepción)', T.recepcion);
  });
  caso('cortesía: la orden de otro cliente del mismo taller da 400 y no consume', () => noConsume({ orden_id: f.orden2 }, 400, 'orden_id', 'orden de otro cliente'));
  caso('cortesía: una orden que no existe da 404 y un id que no es número da 400', async () => {
    await noConsume({ orden_id: 2147480000 }, 404, 'orden_id', 'orden inexistente');
    await noConsume({ orden_id: '1 OR 1=1' }, 400, 'orden_id', 'orden_id no numérico');
  });
  caso('cortesía: no se canjea sobre una orden cancelada ni entregada', async () => {
    for (const estado of ['cancelada', 'entregada']) {
      const id = await orden(P.tenantId, f.c1, f.v1, { estado, sede: P.sedeId, recepcionista: P.adminId });
      await noConsume({ orden_id: id }, 400, 'orden_id', `orden ${estado}`);
    }
  });
  caso('cortesía (control): se canjea en una orden propia activa, y cancelarla la devuelve', async () => {
    await conCortesia(f.c1);
    const id = await orden(P.tenantId, f.c1, f.v1, { sede: P.sedeId, recepcionista: P.adminId });
    exito(await cortesia(f.c1, { orden_id: id }), 'canje en orden propia');
    const canje = await uno('SELECT orden_id, tenant_id, devuelta_en FROM recompensas_canjeadas WHERE cliente_id = ? ORDER BY id DESC LIMIT 1', [f.c1]);
    assert.equal(Number(canje.orden_id), id);
    assert.equal(Number(canje.tenant_id), P.tenantId);
    assert.equal((await estadoCortesia(f.c1)).disponible, 0);
    exito(await pedir('PATCH', `/ordenes/${id}/estado`, { estado: 'cancelada', confirmar: true, motivo: 'Prueba T04' }), 'cancelar');
    assert.equal((await estadoCortesia(f.c1)).disponible, 1, 'la cancelación devuelve la cortesía');
    assert.ok((await uno('SELECT devuelta_en FROM recompensas_canjeadas WHERE cliente_id = ? AND orden_id = ?', [f.c1, id])).devuelta_en);
    await conCortesia(f.c1);
    exito(await cortesia(f.c1, {}), 'canje sin orden');
  });
  // Carrera determinista: otra transacción tiene bloqueada la orden (como PATCH /estado al
  // cancelar). El canje tiene que ESPERAR ese bloqueo (se comprueba en pg_stat_activity,
  // no con un sleep), y cuando la cancelación se confirma, rechazarse sin consumir. Antes
  // del arreglo el canje no tocaba la orden: no esperaba y quedaba vigente sobre una orden
  // cancelada, sin nadie que se la devuelva.
  caso('cortesía: un canje concurrente con la cancelación espera el bloqueo de la orden y no consume', async () => {
    await conCortesia(f.c1);
    const id = await orden(P.tenantId, f.c1, f.v1, { sede: P.sedeId, recepcionista: P.adminId });
    const antes = await estadoCortesia(f.c1);
    const otra = await ctx.conexionAparte();
    let esperó = false;
    try {
      await otra.query('BEGIN');
      const [[{ pid }]] = await otra.query('SELECT pg_backend_pid() AS pid');
      await otra.query('SELECT id FROM ordenes_trabajo WHERE id = ? FOR UPDATE', [id]);
      const enCurso = cortesia(f.c1, { orden_id: id });
      for (let i = 0; i < 100 && !esperó; i++) {
        const [[{ n }]] = await q('SELECT COUNT(*)::int AS n FROM pg_stat_activity WHERE ? = ANY(pg_blocking_pids(pid))', [pid]);
        esperó = n > 0;
        if (!esperó) await new Promise((r) => setTimeout(r, 30));
      }
      // Lo mismo que confirma PATCH /ordenes/:id/estado al cancelar.
      await otra.query("UPDATE ordenes_trabajo SET estado = 'cancelada' WHERE id = ?", [id]);
      await otra.query('COMMIT');
      const r = await enCurso;
      assert.ok(esperó, 'el canje debió quedar esperando el bloqueo de la orden');
      rechazo(r, 400, 'orden_id', 'canje tras la cancelación');
      assert.deepEqual(await estadoCortesia(f.c1), { disponible: 1, canjes: antes.canjes });
    } finally {
      await otra.query('ROLLBACK').catch(() => {});
      await otra.end();
    }
  });

  // ── Sede (QP-06): un id de sede ajeno se rechaza, no se cambia por null ──
  const marca = () => `T04-sede-${sello}-${++secuencia}`;
  for (const [quien, token] of [['admin', 'admin'], ['recepción', 'recepcion']]) {
    caso(`sede: POST /ordenes con la sede de otro taller da 400 y no crea nada (${quien})`, async () => {
      const problema = marca();
      rechazo(await pedir('POST', '/ordenes', { cliente_id: f.c1, vehiculo_id: f.v1, sucursal_id: f.sedeF, problema_reportado: problema }, T[token]), 400, 'sucursal_id', 'orden con sede ajena');
      assert.equal(await cuenta('SELECT COUNT(*) AS n FROM ordenes_trabajo WHERE problema_reportado = ?', [problema]), 0);
    });
    caso(`sede: POST /citas con la sede de otro taller da 400 y no crea nada (${quien})`, async () => {
      const motivo = marca();
      rechazo(await pedir('POST', '/citas', { cliente_id: f.c1, vehiculo_id: f.v1, sucursal_id: f.sedeF, fecha: FECHA, hora: '14:00', motivo }, T[token]), 400, 'sucursal_id', 'cita con sede ajena');
      assert.equal(await cuenta('SELECT COUNT(*) AS n FROM citas WHERE motivo = ?', [motivo]), 0);
    });
  }
  caso('sede (control): POST /ordenes con la sede propia o sin sede sigue andando', async () => {
    const r = await pedir('POST', '/ordenes', { cliente_id: f.c1, vehiculo_id: f.v1, sucursal_id: P.sedeId, problema_reportado: marca() });
    exito(r, 'orden con sede propia');
    assert.equal(Number(r.json.data.sucursal_id), P.sedeId);
    exito(await pedir('POST', '/ordenes', { cliente_id: f.c1, vehiculo_id: f.v1, problema_reportado: marca() }), 'orden sin sede');
  });

  const datos = (extra) => pedir('PATCH', `/ordenes/${f.orden}/datos`, { problema_reportado: 'Prueba T04', vehiculo_id: f.v1, sucursal_id: P.sedeId, ...extra });
  caso('edición de orden: la sede de otro taller da 400 y NO le borra la sede que tenía', async () => {
    const antes = await filaOrden(f.orden);
    assert.equal(Number(antes.sucursal_id), P.sedeId);
    rechazo(await datos({ sucursal_id: f.sedeF }), 400, 'sucursal_id', 'datos con sede ajena');
    assert.deepEqual(await filaOrden(f.orden), antes);
  });
  caso('edición de orden: vehículo de otro taller o de otro cliente da 400 sin cambios', async () => {
    const antes = await filaOrden(f.orden);
    rechazo(await datos({ vehiculo_id: f.vF }), 400, 'vehiculo_id', 'vehículo ajeno');
    rechazo(await datos({ vehiculo_id: f.v2 }), 400, 'vehiculo_id', 'vehículo de otro cliente');
    rechazo(await datos({ vehiculo_id: 'abc' }), 400, 'vehiculo_id', 'vehículo no numérico');
    assert.deepEqual(await filaOrden(f.orden), antes);
  });
  caso('edición de orden (control): sin mandar la sede la conserva; con la propia, 200', async () => {
    exito(await datos({}), 'datos con la sede propia');
    exito(await pedir('PATCH', `/ordenes/${f.orden}/datos`, { problema_reportado: 'Prueba T04', vehiculo_id: f.v1 }, T.recepcion), 'datos sin sede (recepción)');
    assert.equal(Number((await filaOrden(f.orden)).sucursal_id), P.sedeId, 'sin el campo, la sede se conserva');
  });

  const editarCita = (extra, token = T.admin) => pedir('PUT', `/citas/${f.cita}`, { cliente_id: f.c1, vehiculo_id: f.v1, fecha: FECHA, hora: '10:00', motivo: 'Prueba T04', sucursal_id: P.sedeId, ...extra }, token);
  caso('edición de cita: cliente, vehículo, técnico o sede que no corresponden dan 400 sin cambios', async () => {
    const antes = await filaCita(f.cita);
    const malos = [
      [{ cliente_id: f.cF }, 'cliente_id', 'cliente de otro taller'],
      [{ cliente_id: f.cInactivo }, 'cliente_id', 'cliente inactivo'],
      [{ vehiculo_id: f.vF }, 'vehiculo_id', 'vehículo de otro taller'],
      [{ vehiculo_id: f.v2 }, 'vehiculo_id', 'vehículo de otro cliente'],
      [{ tecnico_id: f.tecF }, 'tecnico_id', 'mecánico de otro taller'],
      [{ tecnico_id: f.tecInactivo }, 'tecnico_id', 'mecánico inactivo'],
      [{ tecnico_id: P.recepcionId }, 'tecnico_id', 'alguien que no es mecánico'],
      [{ sucursal_id: f.sedeF }, 'sucursal_id', 'sede de otro taller'],
    ];
    for (const token of [T.admin, T.recepcion]) {
      for (const [extra, campo, msg] of malos) rechazo(await editarCita(extra, token), 400, campo, `PUT /citas: ${msg}`);
    }
    assert.deepEqual(await filaCita(f.cita), antes);
  });
  caso('edición de cita (control): con los datos propios y su mecánico, 200', async () => {
    exito(await editarCita({ tecnico_id: P.tecnicoId }), 'PUT /citas propio');
    assert.equal(Number((await filaCita(f.cita)).tecnico_id), P.tecnicoId);
  });

  // ── Asignar mecánico ──
  caso('asignar mecánico: uno de otro taller, inactivo o que no es mecánico da 400 sin cambios', async () => {
    const antesO = await filaOrden(f.orden);
    const antesC = await filaCita(f.cita);
    for (const malo of [f.tecF, f.tecInactivo, P.recepcionId]) {
      rechazo(await pedir('PATCH', `/ordenes/${f.orden}/tecnico`, { tecnico_id: malo }), 400, null, 'PATCH /ordenes/:id/tecnico');
      rechazo(await pedir('PATCH', `/recepcion/ordenes/${f.orden}/tecnico`, { tecnico_id: malo }, T.recepcion), 400, null, 'PATCH /recepcion/ordenes/:id/tecnico');
      rechazo(await pedir('PATCH', `/citas/${f.cita}/asignar`, { tecnico_id: malo }), 400, 'tecnico_id', 'PATCH /citas/:id/asignar');
    }
    const piezas = [{ nombre: 'Pieza T04', cantidad: 1, costo_unitario: 10 }];
    const repuestos = await cuenta('SELECT COUNT(*) AS n FROM orden_repuestos WHERE orden_id = ?', [f.orden]);
    rechazo(await pedir('POST', `/recepcion/cotizaciones/${f.orden}/armar`, { tecnico_id: f.tecF, piezas }, T.recepcion), 400, null, 'armar con mecánico ajeno');
    assert.equal(await cuenta('SELECT COUNT(*) AS n FROM orden_repuestos WHERE orden_id = ?', [f.orden]), repuestos, 'armar rechazado no agrega piezas');
    assert.deepEqual(await filaOrden(f.orden), antesO);
    assert.deepEqual(await filaCita(f.cita), antesC);
  });
  caso('asignar mecánico (control): el propio, 200 en las tres rutas', async () => {
    exito(await pedir('PATCH', `/ordenes/${f.orden}/tecnico`, { tecnico_id: P.tecnicoId }), 'orden');
    exito(await pedir('PATCH', `/recepcion/ordenes/${f.orden}/tecnico`, { tecnico_id: P.tecnicoId }, T.recepcion), 'recepción');
    exito(await pedir('PATCH', `/citas/${f.cita}/asignar`, { tecnico_id: P.tecnicoId }), 'cita');
  });

  // ── Notificar y mensajes ──
  caso('notificar: cliente o cita de otro taller dan 400 y no crean la notificación', async () => {
    const titulo = marca();
    rechazo(await pedir('POST', '/recepcion/notificar', { cliente_id: f.cF, titulo, mensaje: 'x' }, T.recepcion), 400, 'cliente_id', 'cliente ajeno');
    rechazo(await pedir('POST', '/recepcion/notificar', { cliente_id: f.c1, cita_id: f.citaF, titulo, mensaje: 'x' }, T.recepcion), 400, 'cita_id', 'cita ajena');
    assert.equal(await cuenta('SELECT COUNT(*) AS n FROM notificaciones WHERE titulo = ?', [titulo]), 0);
    exito(await pedir('POST', '/recepcion/notificar', { cliente_id: f.c1, cita_id: f.cita, titulo, mensaje: 'x' }, T.recepcion), 'control: cita propia');
  });
  caso('mensajes internos: destinatario u orden de otro taller dan 400 y no se guardan', async () => {
    const mensaje = marca();
    rechazo(await pedir('POST', '/recepcion/mensajes-internos', { destino_id: f.tecF, mensaje }, T.recepcion), 400, 'destino_id', 'destinatario ajeno');
    rechazo(await pedir('POST', '/recepcion/mensajes-internos', { destino_id: P.tecnicoId, orden_id: f.ordenF, mensaje }, T.recepcion), 400, 'orden_id', 'orden ajena (recepción)');
    rechazo(await pedir('POST', '/mecanico/mensajes', { orden_id: f.ordenF, mensaje }, T.tecnico), 400, 'orden_id', 'orden ajena (mecánico)');
    assert.equal(await cuenta('SELECT COUNT(*) AS n FROM mensajes_internos WHERE mensaje = ?', [mensaje]), 0);
    exito(await pedir('POST', '/recepcion/mensajes-internos', { destino_id: P.tecnicoId, orden_id: f.orden, mensaje }, T.recepcion), 'control recepción');
    exito(await pedir('POST', '/mecanico/mensajes', { orden_id: f.orden, mensaje }, T.tecnico), 'control mecánico');
  });

  // ── Portal ──
  const portalCita = (extra) => pedir('PUT', `/portal/citas/${f.citaPortal}`, { vehiculo_id: f.v1, fecha: FECHA, hora: '11:00', servicios: [f.servicio], sucursal_id: P.sedeId, ...extra }, T.cliente);
  caso('portal: reprogramar con la sede de otro taller da 400 y no cambia la cita', async () => {
    const antes = await filaCita(f.citaPortal);
    rechazo(await portalCita({ sucursal_id: f.sedeF }), 400, 'sucursal_id', 'PUT /portal/citas sede ajena');
    rechazo(await portalCita({ vehiculo_id: f.vF }), 400, 'vehiculo_id', 'PUT /portal/citas vehículo ajeno');
    rechazo(await portalCita({ vehiculo_id: f.v2 }), 400, 'vehiculo_id', 'PUT /portal/citas vehículo de otro cliente');
    assert.deepEqual(await filaCita(f.citaPortal), antes);
  });
  caso('portal: agendar con la sede o el vehículo de otro taller da 400', async () => {
    const motivo = marca();
    const base = { vehiculo_id: f.v1, fecha: FECHA, hora: '09:00', servicios: [f.servicio], sucursal_id: P.sedeId, descripcion: motivo };
    rechazo(await pedir('POST', '/portal/citas', { ...base, sucursal_id: f.sedeF }, T.cliente), 400, 'sucursal_id', 'POST /portal/citas sede ajena');
    rechazo(await pedir('POST', '/portal/citas', { ...base, vehiculo_id: f.vF }, T.cliente), 400, 'vehiculo_id', 'POST /portal/citas vehículo ajeno');
    assert.equal(await cuenta('SELECT COUNT(*) AS n FROM citas WHERE motivo = ?', [motivo]), 0);
  });
  caso('portal (control): reprogramar sin mandar sede o con la propia, 200', async () => {
    exito(await portalCita({ sucursal_id: undefined }), 'sin sede');
    exito(await portalCita({ hora: '12:00' }), 'con la sede propia');
    assert.equal(Number((await filaCita(f.citaPortal)).sucursal_id), P.sedeId);
  });

  // ── Preferencia de sede (B-03): la de otro taller no se guarda ──
  caso('preferencias: la sede de otro taller queda en null; la propia se guarda', async () => {
    const r = await pedir('PUT', '/auth/perfil/preferencias', { sede_id: f.sedeF }, T.recepcion);
    exito(r, 'preferencias');
    assert.equal(r.json.data.sede_id, null);
    const guardadas = JSON.parse((await uno('SELECT preferencias FROM usuarios WHERE id = ?', [P.recepcionId])).preferencias || '{}');
    assert.equal(guardadas.sede_id ?? null, null, 'la sede ajena no queda guardada');
    const propia = await pedir('PUT', '/auth/perfil/preferencias', { sede_id: P.sedeId }, T.recepcion);
    assert.equal(propia.json.data.sede_id, P.sedeId);
  });

  // ── Conciliación final ──
  caso('conciliación: ninguna relación cruza de taller y recompensas_canjeadas cuadra', async () => {
    const { problemas, revisadas } = await conciliar(ctx.db);
    assert.ok(revisadas >= 30, `solo se revisaron ${revisadas} relaciones`);
    assert.deepEqual(problemas, []);
  });

  return casos;
}

module.exports = { casosReferencias, conciliar, RELACIONES };
