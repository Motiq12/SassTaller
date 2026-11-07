// Los servicios de una cita: el cliente puede pedir varios en la misma ("Cambio de
// aceite" y "Revisión de frenos").
//
// Se guardan en tres lugares, y este archivo es el único que los escribe:
// - `cita_servicios`: una fila por servicio. Es la que cuentan los reportes y la que
//   mira "no se puede borrar un servicio que ya se usó".
// - `citas.tipo_servicio`: el primero. Lo que ya lo leía (recordatorios, aviso de
//   mantenimiento, ingresos por servicio) sigue funcionando igual.
// - `citas.servicios`: el texto para mostrar, "Cambio de aceite + Revisión de frenos".
const { pool } = require('../db/pool');
const { servicioValido } = require('./servicios');

const MAX_SERVICIOS_CITA = 5;
const SEPARADOR = ' + ';

// Lo que manda la pantalla: `servicios` (varios) o `tipo_servicio` (uno: la app
// instalada que todavía no se actualizó). Limpio, sin repetidos y en el orden elegido.
function serviciosDelPedido(body) {
  const crudos = Array.isArray(body?.servicios)
    ? body.servicios
    : (body?.tipo_servicio ? [body.tipo_servicio] : []);
  const lista = crudos.map((s) => String(s ?? '').trim().slice(0, 100)).filter(Boolean);
  return [...new Set(lista)];
}

// ¿Vino `servicios` o `tipo_servicio` en el pedido? Si no vino ninguno, al editar se
// conservan los que ya tenía la cita.
function pedidoTraeServicios(body) {
  return Array.isArray(body?.servicios) || body?.tipo_servicio !== undefined;
}

// Qué está mal con la lista, o null. El portal exige al menos uno y que estén en el
// catálogo activo; el personal puede agendar sin servicio (como antes).
async function problemaConServicios(lista, { obligatorio = false, delCatalogo = false } = {}) {
  if (obligatorio && !lista.length) return 'Elige al menos un servicio';
  if (lista.length > MAX_SERVICIOS_CITA) return `Puedes elegir hasta ${MAX_SERVICIOS_CITA} servicios`;
  if (delCatalogo) {
    for (const s of lista) {
      if (!(await servicioValido(s))) return `Servicio no válido: ${s}`;
    }
  }
  return null;
}

const textoServicios = (lista) => (lista.length ? lista.join(SEPARADOR).slice(0, 600) : null);

// Guarda la lista de una cita (reemplaza la que tenía). `conn` para usarlo dentro de
// una transacción.
async function guardarServiciosCita(citaId, lista, conn = pool) {
  await conn.query('DELETE FROM cita_servicios WHERE cita_id = ?', [citaId]);
  if (lista.length) {
    await conn.query(
      'INSERT INTO cita_servicios (cita_id, servicio, orden) VALUES ?',
      [lista.map((s, i) => [citaId, s, i])]
    );
  }
  await conn.query(
    'UPDATE citas SET tipo_servicio = ?, servicios = ? WHERE id = ?',
    [lista[0] || null, textoServicios(lista), citaId]
  );
}

module.exports = {
  MAX_SERVICIOS_CITA, SEPARADOR,
  serviciosDelPedido, pedidoTraeServicios, problemaConServicios, textoServicios, guardarServiciosCita,
};
