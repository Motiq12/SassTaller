// Reglas del flujo de una orden que no dependen de la base: qué estados siguen,
// qué hay que advertir antes de un cambio y cuándo un costo nuevo necesita que el
// cliente vuelva a aprobar. Las rutas leen los datos y le preguntan acá.
const { TRANSICIONES_ORDEN } = require('./transiciones');

// Estados posibles de un repuesto, con el nombre que ve el personal.
const ESTADOS_REPUESTO = {
  solicitado: 'Solicitado por el mecánico',
  pendiente: 'Por conseguir',
  pedido_especial: 'Pedido especial',
  disponible: 'Disponible',
};

// Estados en los que el cliente ya aprobó y el trabajo está en marcha: si el costo
// sube en uno de estos, el cliente tiene que aprobar la diferencia.
const ESTADOS_TRAS_APROBACION = ['esperando_repuestos', 'en_reparacion', 'lista_entrega'];

// Margen para comparar montos en colones con decimales de la base.
const CENTIMO = 0.005;

// Estados a los que puede pasar la orden desde la pantalla. Cancelar es solo de admin.
// La entrega no está: va por "Entregar" (POST /recepcion/ordenes/:id/entregar).
function estadosSiguientes(estado, rol) {
  const lista = TRANSICIONES_ORDEN[estado] || [];
  return rol === 'admin' ? [...lista] : lista.filter((e) => e !== 'cancelada');
}

// Lo que conviene que la persona sepa antes de cambiar el estado. No bloquea: la
// ruta pide confirmar y, si confirma, sigue. Recibe:
//   repuestos:    [{ nombre, cantidad, estado }]
//   fotosIngreso: cuántas fotos de tipo 'ingreso' tiene la orden
//   aprobacion:   aprobacion_cliente ('pendiente' | 'aprobado' | 'rechazado')
function avisosDeCambio({ desde, hacia, repuestos = [], fotosIngreso = 0, aprobacion = 'pendiente' }) {
  const avisos = [];
  if (hacia === 'cancelada' || desde === hacia) return avisos;

  if (desde === 'recepcion' && !fotosIngreso) {
    avisos.push({
      tipo: 'fotos_ingreso',
      mensaje: 'La moto no tiene fotos de ingreso.',
      detalle: ['Son el respaldo del taller si el cliente reclama un golpe o un rayón que ya traía.'],
    });
  }

  if (['diagnostico', 'esperando_aprobacion'].includes(desde)
      && ['esperando_repuestos', 'en_reparacion'].includes(hacia)
      && aprobacion !== 'aprobado') {
    avisos.push({
      tipo: 'sin_aprobacion',
      mensaje: 'El cliente todavía no aprobó el presupuesto.',
      detalle: ['Si se trabaja sin su aprobación, puede no reconocer el cobro.'],
    });
  }

  if (hacia === 'en_reparacion') {
    const faltan = repuestos.filter((r) => r.estado !== 'disponible');
    if (faltan.length) {
      avisos.push({
        tipo: 'repuestos_faltantes',
        mensaje: faltan.length === 1 ? 'Falta 1 repuesto por llegar.' : `Faltan ${faltan.length} repuestos por llegar.`,
        detalle: faltan.map((r) => `${r.nombre}${r.cantidad > 1 ? ` ×${r.cantidad}` : ''} — ${ESTADOS_REPUESTO[r.estado] || r.estado}`),
      });
    }
  }

  return avisos;
}

// ¿Este cambio de costo obliga a pedirle al cliente que apruebe de nuevo? Solo
// cuando ya había aprobado, la orden sigue en trabajo, y el total SUBIÓ con este
// cambio por encima de lo que aprobó. Comparar con el total de antes evita volver
// a pedir aprobación cuando se edita otra cosa (el estado de un repuesto, por
// ejemplo) en una orden cuyo adicional el cliente ya rechazó.
function necesitaReaprobacion({ estado, aprobacion, totalAprobado, totalAntes, totalDespues }) {
  if (aprobacion !== 'aprobado') return false;
  if (!ESTADOS_TRAS_APROBACION.includes(estado)) return false;
  if (totalAprobado === null || totalAprobado === undefined) return false;
  const despues = Number(totalDespues) || 0;
  return despues > (Number(totalAntes) || 0) + CENTIMO && despues > Number(totalAprobado) + CENTIMO;
}

// Estado con el que queda un repuesto al editarlo. Si la pantalla manda uno, ese.
// Si no manda (la de cotizaciones solo cambia precio y cantidad), se respeta el que
// tenía; antes se reseteaba a 'pendiente' y un repuesto que ya había llegado volvía
// a figurar como faltante. Un repuesto que pidió el mecánico, al ponerle precio,
// pasa a 'pendiente' (por conseguir).
function estadoAlEditarRepuesto(actual, pedido, costoUnitario) {
  if (pedido) return pedido;
  if (actual === 'solicitado' && Number(costoUnitario) > 0) return 'pendiente';
  return actual || 'pendiente';
}

// Monto que el cliente todavía no aprobó (0 si no hay diferencia o nunca aprobó).
function montoSinAprobar(total, totalAprobado) {
  if (totalAprobado === null || totalAprobado === undefined) return 0;
  const diferencia = (Number(total) || 0) - Number(totalAprobado);
  return diferencia > CENTIMO ? Math.round(diferencia * 100) / 100 : 0;
}

module.exports = {
  ESTADOS_REPUESTO,
  ESTADOS_TRAS_APROBACION,
  estadosSiguientes,
  avisosDeCambio,
  necesitaReaprobacion,
  montoSinAprobar,
  estadoAlEditarRepuesto,
};
