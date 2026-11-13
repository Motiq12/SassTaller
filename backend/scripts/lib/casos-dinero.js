// Mismos contratos HTTP en npm test y en la prueba completa de dos empresas.
const assert = require('node:assert/strict');

function casosDinero(ctx) {
  const casos = [];
  const caso = (nombre, fn) => casos.push([nombre, fn]);
  const q = (...args) => ctx.db.query(...args);
  const pedir = (met, ruta, body, token = ctx.token) => ctx.pedir(met, ruta, { token, body });
  const exito = r => { assert.ok(r.status >= 200 && r.status < 300, JSON.stringify(r)); return r.json?.data; };
  const fila = async id => (await q('SELECT * FROM ordenes_trabajo WHERE id = ?', [id]))[0][0];
  const total = o => Number(o.costo_mano_obra) + Number(o.costo_repuestos) - Number(o.descuento);
  let secuencia = 0;
  async function nueva(estado = 'recepcion') {
    const [[o]] = await q(`INSERT INTO ordenes_trabajo
      (tenant_id, cliente_id, vehiculo_id, recepcionista_id, numero_orden, problema_reportado, estado)
      VALUES (?, ?, ?, ?, ?, 'Prueba dinero', ?) RETURNING id`,
    [ctx.tenantId, ctx.clienteId, ctx.vehiculoId, ctx.usuarioId, `DIN-${Date.now()}-${++secuencia}`, estado]);
    return o.id;
  }
  const pieza = { nombre: 'Filtro', cantidad: 1, costo_unitario: 100, estado: 'disponible' };
  const agregar = async (id, base = 'ordenes', precio = 100) => exito(await pedir('POST', `/${base}/${id}/repuestos`, { ...pieza, costo_unitario: precio }));
  const aprobar = async id => exito(await pedir('POST', `/portal/ordenes/${id}/aprobar`, {}, ctx.clienteToken));
  const rechazar = async id => exito(await pedir('POST', `/portal/ordenes/${id}/rechazar`, { motivo: 'No autorizo el adicional' }, ctx.clienteToken));
  async function aprobada() {
    const id = await nueva('esperando_aprobacion');
    const p = await agregar(id);
    exito(await pedir('PUT', `/recepcion/cotizaciones/${id}/costos`, { costo_mano_obra: 200, descuento: 10 }));
    await aprobar(id);
    assert.equal(total(await fila(id)), 290);
    return { id, p };
  }

  for (const estado of ['entregada', 'cancelada']) {
    caso(`Q-03: ${estado} bloquea las nueve rutas de costos sin modificar datos`, async () => {
      const id = await nueva();
      const p = await agregar(id);
      await q('UPDATE ordenes_trabajo SET estado = ? WHERE id = ?', [estado, id]);
      const antes = await fila(id);
      const rutas = [
        ['PUT', `/ordenes/${id}`, { costo_mano_obra: 55, costo_repuestos: 66, descuento: 7 }],
        ['PUT', `/recepcion/cotizaciones/${id}/costos`, { costo_mano_obra: 55, descuento: 7 }],
        ['POST', `/recepcion/cotizaciones/${id}/armar`, { piezas: [pieza], costo_mano_obra: 55 }],
      ];
      for (const base of ['ordenes', 'recepcion/cotizaciones']) {
        rutas.push(['POST', `/${base}/${id}/repuestos`, pieza]);
        rutas.push(['PUT', `/${base}/${id}/repuestos/${p.id}`, { ...pieza, costo_unitario: 900 }]);
        rutas.push(['DELETE', `/${base}/${id}/repuestos/${p.id}`, {}]);
      }
      for (const [met, ruta, body] of rutas) assert.equal((await pedir(met, ruta, body)).status, 409, ruta);
      assert.deepEqual(await fila(id), antes);
      const [[actual]] = await q('SELECT costo_unitario FROM orden_repuestos WHERE id = ?', [p.id]);
      assert.equal(Number(actual.costo_unitario), 100);
    });
  }
  caso('Q-03: el mecánico no pide repuestos en una orden entregada o cancelada', async () => {
    for (const [estado, codigo] of [['entregada', 409], ['cancelada', 409], ['en_reparacion', 201]]) {
      const id = await nueva(estado);
      await q('UPDATE ordenes_trabajo SET tecnico_id = ? WHERE id = ?', [ctx.usuarioId, id]);
      const r = await pedir('POST', `/mecanico/ordenes/${id}/repuestos`, { nombre: 'Bujía', cantidad: 1 });
      assert.equal(r.status, codigo, JSON.stringify({ estado, r }));
      const [[{ n }]] = await q('SELECT COUNT(*)::int AS n FROM orden_repuestos WHERE orden_id = ?', [id]);
      assert.equal(n, codigo === 201 ? 1 : 0);
    }
  });
  caso('Q-03: una orden abierta permite agregar, editar, borrar y armar costos', async () => {
    const id = await nueva();
    for (const base of ['ordenes', 'recepcion/cotizaciones']) {
      const p = await agregar(id, base);
      exito(await pedir('PUT', `/${base}/${id}/repuestos/${p.id}`, { ...pieza, cantidad: 2 }));
      assert.equal(Number((await fila(id)).costo_repuestos), 200);
      exito(await pedir('DELETE', `/${base}/${id}/repuestos/${p.id}`, {}));
      assert.equal(Number((await fila(id)).costo_repuestos), 0);
    }
    exito(await pedir('PUT', `/ordenes/${id}`, { costo_mano_obra: 200, costo_repuestos: 20, descuento: 10 }));
    assert.equal(total(await fila(id)), 210);
    exito(await pedir('POST', `/recepcion/cotizaciones/${id}/armar`, { piezas: [pieza], costo_mano_obra: 300, descuento: 5 }));
    assert.equal(total(await fila(id)), 395);
  });

  caso('Q-04: rechazar restaura importes, conserva piezas y no borra un adicional antes aprobado', async () => {
    const { id, p } = await aprobada();
    const aceptado = await agregar(id);
    await aprobar(id);
    assert.equal(total(await fila(id)), 390);
    const rechazado = await agregar(id, 'recepcion/cotizaciones', 500);
    exito(await pedir('PUT', `/ordenes/${id}/repuestos/${p.id}`, { ...pieza, cantidad: 3 }));
    exito(await pedir('PUT', `/recepcion/cotizaciones/${id}/costos`, { costo_mano_obra: 400, descuento: 0 }));
    await rechazar(id);
    let o = await fila(id);
    assert.equal(total(o), 390);
    assert.equal(o.aprobacion_cliente, 'aprobado');
    assert.equal(o.adicionales_rechazados.length, 1);
    const [piezas] = await q('SELECT id, cantidad, rechazado FROM orden_repuestos WHERE orden_id = ?', [id]);
    assert.equal(piezas.length, 3);
    assert.equal(piezas.find(x => x.id === rechazado.id).rechazado, 1);
    assert.equal(piezas.find(x => x.id === aceptado.id).rechazado, 0);
    assert.equal(piezas.find(x => x.id === p.id).cantidad, 1);
    for (const base of ['ordenes', 'recepcion/cotizaciones']) {
      assert.equal((await pedir('PUT', `/${base}/${id}/repuestos/${rechazado.id}`, pieza)).status, 409);
      assert.equal((await pedir('DELETE', `/${base}/${id}/repuestos/${rechazado.id}`, {})).status, 404);
    }
    // Los listados que suman la factura y el detalle no traen el rechazado.
    for (const ruta of [`/ordenes/${id}/repuestos`, `/recepcion/cotizaciones/${id}/repuestos`]) {
      const lista = exito(await pedir('GET', ruta));
      assert.ok(!lista.some(x => x.id === rechazado.id), ruta);
      assert.equal(lista.reduce((t, x) => t + x.cantidad * Number(x.costo_unitario), 0), 200, ruta);
      const todos = exito(await pedir('GET', `${ruta}?incluir_rechazados=1`));
      assert.equal(todos.find(x => x.id === rechazado.id).rechazado, 1, ruta);
    }
    const portal = exito(await pedir('GET', `/portal/ordenes/${id}`, undefined, ctx.clienteToken));
    assert.equal(portal.repuestos.length, 2, 'el cliente no ve lo que rechazó');
    assert.equal(Number(portal.total), 390);
    const nuevo = await agregar(id, 'ordenes', 50);
    assert.equal(total(await fila(id)), 440, 'el recálculo no reincorpora el rechazado');
    await aprobar(id);
    assert.equal(Number((await fila(id)).total_aprobado), 440);
    await agregar(id, 'ordenes', 200);
    assert.equal((await fila(id)).estado, 'esperando_aprobacion');
    exito(await pedir('DELETE', `/ordenes/${id}/repuestos/${nuevo.id}`, {}));
    await rechazar(id);
    o = await fila(id);
    assert.equal(total(o), 440, 'restaura también una pieza aprobada borrada en la propuesta');
    assert.equal(o.adicionales_rechazados.length, 2);
  });
  caso('Q-04: rechazo solo de mano de obra/descuento, repetición y rechazo inicial', async () => {
    const { id } = await aprobada();
    exito(await pedir('PUT', `/recepcion/cotizaciones/${id}/costos`, { costo_mano_obra: 500, descuento: 0 }));
    await rechazar(id);
    assert.equal(total(await fila(id)), 290);
    assert.equal((await pedir('POST', `/portal/ordenes/${id}/rechazar`, {}, ctx.clienteToken)).status, 400);
    const inicial = await nueva('esperando_aprobacion');
    await agregar(inicial);
    await rechazar(inicial);
    assert.equal((await fila(inicial)).aprobacion_cliente, 'rechazado');
    assert.equal((await fila(inicial)).estado, 'diagnostico');
  });

  caso('Q-04: lo que el taller quitó sin subir la cuenta no vuelve al rechazar un adicional', async () => {
    const { id, p } = await aprobada();
    const extra = await agregar(id, 'ordenes', 50);
    await aprobar(id);
    assert.equal(total(await fila(id)), 340);
    exito(await pedir('DELETE', `/recepcion/cotizaciones/${id}/repuestos/${extra.id}`, {}));
    exito(await pedir('PUT', `/recepcion/cotizaciones/${id}/costos`, { costo_mano_obra: 150, descuento: 10 }));
    assert.equal(total(await fila(id)), 240);
    await agregar(id, 'ordenes', 300);
    assert.equal((await fila(id)).estado, 'esperando_aprobacion');
    await rechazar(id);
    const o = await fila(id);
    assert.equal(total(o), 240, 'vuelve a lo último aceptado, no a la pieza ya quitada');
    assert.equal(Number(o.costo_mano_obra), 150);
    const [piezas] = await q('SELECT id FROM orden_repuestos WHERE orden_id = ? AND rechazado = 0', [id]);
    assert.deepEqual(piezas.map(x => x.id), [p.id]);
  });
  caso('Q-04: presupuesto aprobado antes de la copia: se edita y el rechazo compensa con descuento', async () => {
    const id = await nueva('esperando_aprobacion');
    await agregar(id);
    await q('UPDATE ordenes_trabajo SET total_aprobado = 100, aprobacion_cliente = ?, presupuesto_aprobado = NULL WHERE id = ?', ['aprobado', id]);
    await q("UPDATE ordenes_trabajo SET costo_mano_obra = 80, aprobacion_cliente = 'pendiente' WHERE id = ?", [id]);
    exito(await pedir('PUT', `/recepcion/cotizaciones/${id}/costos`, { costo_mano_obra: 90, descuento: 0 }));
    assert.equal((await fila(id)).presupuesto_aprobado, null, 'no inventa una copia de lo que no se aprobó');
    await rechazar(id);
    const o = await fila(id);
    assert.equal(total(o), 100);
    assert.equal(o.adicionales_rechazados.length, 1);
    exito(await pedir('PUT', `/recepcion/cotizaciones/${id}/costos`, { costo_mano_obra: 90, descuento: 90 }));
    assert.ok((await fila(id)).presupuesto_aprobado, 'con la cuenta dentro de lo aprobado, ya guarda la copia');
  });

  caso('Q-05: garantía exige entrega, plazo positivo y fecha vigente', async () => {
    for (const [estado, dias, entrega, codigo] of [
      ['recepcion', 30, new Date(), 400], ['entregada', 0, new Date(), 400],
      ['entregada', -1, new Date(), 400], ['entregada', 30, null, 400],
      ['entregada', 30, new Date(Date.now() + 864e5), 400],
      ['entregada', 30, new Date(Date.now() - 30 * 864e5 - 60000), 400],
      ['entregada', 30, new Date(Date.now() - 30 * 864e5 + 60000), 201],
    ]) {
      const id = await nueva(estado);
      await q('UPDATE ordenes_trabajo SET garantia_dias = ?, fecha_entrega_real = ? WHERE id = ?', [dias, entrega, id]);
      const r = await pedir('POST', '/garantias', { orden_id: id, descripcion_problema: 'Falla' });
      assert.equal(r.status, codigo, JSON.stringify({ dias, entrega, r }));
    }
  });
  caso('Q-05: dos reclamos simultáneos crean uno; solo resueltos o rechazados permiten otro', async () => {
    const id = await nueva('entregada');
    await q('UPDATE ordenes_trabajo SET garantia_dias = 30, fecha_entrega_real = NOW() WHERE id = ?', [id]);
    const reclamar = () => pedir('POST', '/garantias', { orden_id: id, descripcion_problema: 'Falla' });
    const resultados = await Promise.all([reclamar(), reclamar()]);
    assert.deepEqual(resultados.map(r => r.status).sort(), [201, 409]);
    const g = resultados.find(r => r.status === 201).json.data.id;
    for (const estado of ['en_revision', 'aprobado']) {
      exito(await pedir('PATCH', `/garantias/${g}/estado`, { estado }));
      assert.equal((await reclamar()).status, 409);
    }
    exito(await pedir('PATCH', `/garantias/${g}/estado`, { estado: 'resuelto' }));
    const otro = exito(await reclamar());
    assert.equal((await pedir('PATCH', `/garantias/${g}/estado`, { estado: 'abierto' })).status, 409);
    exito(await pedir('PATCH', `/garantias/${otro.id}/estado`, { estado: 'rechazado' }));
    exito(await reclamar());
  });

  caso('Q-06: cancelar devuelve la cortesía una vez y conserva el canje', async () => {
    const id = await nueva();
    await q('UPDATE clientes SET cortesia_disponible = 1 WHERE id = ?', [ctx.clienteId]);
    exito(await pedir('PATCH', `/clientes/${ctx.clienteId}/cortesia`, { orden_id: id }));
    const cancelar = () => pedir('PATCH', `/ordenes/${id}/estado`, { estado: 'cancelada', motivo: 'Cliente cancela', confirmar: true });
    for (const r of await Promise.all([cancelar(), cancelar()])) exito(r);
    const [[cli]] = await q('SELECT cortesia_disponible FROM clientes WHERE id = ?', [ctx.clienteId]);
    assert.equal(cli.cortesia_disponible, 1);
    const [[canje]] = await q('SELECT devuelta_en FROM recompensas_canjeadas WHERE orden_id = ?', [id]);
    assert.ok(canje.devuelta_en);
    const cliente = exito(await pedir('GET', `/clientes/${ctx.clienteId}`));
    assert.equal(Number(cliente.cortesias_canjeadas), 0, 'la devuelta no cuenta como canjeada');
    const siguiente = await nueva();
    exito(await pedir('PATCH', `/clientes/${ctx.clienteId}/cortesia`, { orden_id: siguiente }));
    exito(await cancelar());
    exito(await pedir('DELETE', `/ordenes/${id}`, { motivo: 'Eliminar orden cancelada' }));
    const [[despues]] = await q('SELECT cortesia_disponible FROM clientes WHERE id = ?', [ctx.clienteId]);
    assert.equal(despues.cortesia_disponible, 0, 'reintentar o borrar no devuelve otra cortesía');
    const sinCanje = await nueva();
    exito(await pedir('PATCH', `/ordenes/${sinCanje}/estado`, { estado: 'cancelada', confirmar: true }));
    const [[sinRegalo]] = await q('SELECT cortesia_disponible FROM clientes WHERE id = ?', [ctx.clienteId]);
    assert.equal(sinRegalo.cortesia_disponible, 0);
  });

  caso('Q-08: cierre normal, excepción auditada y estados terminales', async () => {
    for (const estado of ['recepcion', 'diagnostico', 'esperando_aprobacion', 'esperando_repuestos', 'en_reparacion']) {
      const id = await nueva(estado);
      for (const body of [{}, { confirmar: 'true', motivo: 'Entrega especial' }, { confirmar: true }, { confirmar: true, motivo: 'x' }]) {
        assert.equal((await pedir('PATCH', `/ordenes/${id}/cerrar`, body)).status, 409);
        assert.equal((await fila(id)).estado, estado);
      }
      exito(await pedir('PATCH', `/ordenes/${id}/cerrar`, { confirmar: true, motivo: 'Retiro excepcional autorizado', garantia_dias: 30 }));
      const o = await fila(id);
      assert.equal(o.estado, 'entregada');
      assert.equal(o.cierre_excepcional.usuario_id, ctx.usuarioId);
      assert.equal(o.cierre_excepcional.estado_anterior, estado);
      assert.equal(o.cierre_excepcional.motivo, 'Retiro excepcional autorizado');
      assert.ok(o.cierre_excepcional.fecha);
      assert.equal((await pedir('PATCH', `/ordenes/${id}/cerrar`, { confirmar: true, motivo: 'Otra entrega' })).status, 400);
      assert.deepEqual(await fila(id), o);
    }
    const lista = await nueva('lista_entrega');
    const resultados = await Promise.all([pedir('PATCH', `/ordenes/${lista}/cerrar`, {}), pedir('PATCH', `/ordenes/${lista}/cerrar`, {})]);
    assert.equal(resultados.filter(r => r.status === 200).length, 1);
    assert.equal((await fila(lista)).cierre_excepcional, null);
    const cancelada = await nueva('cancelada');
    assert.equal((await pedir('PATCH', `/ordenes/${cancelada}/cerrar`, { confirmar: true, motivo: 'No debe cerrar' })).status, 400);
    const abierta = await nueva();
    assert.equal((await pedir('POST', `/recepcion/ordenes/${abierta}/entregar`, { confirmar: true, motivo: 'No debe saltarse' })).status, 409);
    assert.equal((await fila(abierta)).estado, 'recepcion');
    // La pantalla de recepción confirma con forzar: true; queda registrada igual.
    exito(await pedir('POST', `/recepcion/ordenes/${abierta}/entregar`, { metodo_pago: 'efectivo', garantia_dias: 30, forzar: true }));
    const forzada = await fila(abierta);
    assert.equal(forzada.estado, 'entregada');
    assert.equal(forzada.cierre_excepcional.estado_anterior, 'recepcion');
    assert.equal(forzada.cierre_excepcional.usuario_id, ctx.usuarioId);
    assert.ok(forzada.cierre_excepcional.motivo.length >= 5);
    const listaRecepcion = await nueva('lista_entrega');
    exito(await pedir('POST', `/recepcion/ordenes/${listaRecepcion}/entregar`, { metodo_pago: 'efectivo', garantia_dias: 30 }));
    assert.equal((await fila(listaRecepcion)).cierre_excepcional, null);
    assert.equal((await pedir('POST', `/recepcion/ordenes/${listaRecepcion}/entregar`, { forzar: true })).status, 400);
  });

  caso('Q-03/Q-05/Q-08: otro taller no puede editar, reclamar ni cerrar', async () => {
    const id = await nueva('lista_entrega');
    for (const [met, ruta, body] of [
      ['POST', `/ordenes/${id}/repuestos`, pieza],
      ['PUT', `/recepcion/cotizaciones/${id}/costos`, { costo_mano_obra: 10 }],
      ['PATCH', `/ordenes/${id}/cerrar`, { confirmar: true, motivo: 'Intento ajeno' }],
      ['POST', '/garantias', { orden_id: id, descripcion_problema: 'Intento ajeno' }],
    ]) assert.equal((await pedir(met, ruta, body, ctx.otroToken)).status, 404);
    assert.equal((await fila(id)).estado, 'lista_entrega');
  });
  return casos;
}

module.exports = { casosDinero };
