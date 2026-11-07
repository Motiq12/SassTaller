// El mecánico no ve plata ni el teléfono del cliente (decisión del taller). Esconderlo
// solo en las pantallas no alcanza: el dato igual viajaba a su celular y se veía en
// cualquier respuesta. Esto limpia TODA respuesta JSON que va a alguien con rol
// 'tecnico' (incluye los roles propios de base Taller), en cualquier ruta.
//
// Se monta una vez en server.js, antes de las rutas: envuelve res.json y decide al
// responder, cuando auth ya puso req.usuario.

// Campos de dinero, en cualquier nivel de la respuesta.
const DINERO = new Set([
  'costo_mano_obra', 'costo_repuestos', 'costo_unitario', 'costo', 'descuento',
  'total_aprobado', 'monto_sin_aprobar', 'orden_total', 'total_pagado', 'total_cobrado',
  'monto', 'monto_promedio', 'montos', 'precio', 'precio_final', 'precio_desde', 'precio_texto',
  'precios', 'subtotal', 'cobrado', 'cobrado_hoy', 'ingresos', 'facturacion',
]);

// Y cualquier campo que empiece así (ingresos_mes, facturacion_hoy…): un dato de plata
// nuevo con otro nombre no se escapa por no estar en la lista.
const PREFIJOS_DINERO = ['ingreso', 'facturacion'];
const esDinero = (k) => DINERO.has(k) || PREFIJOS_DINERO.some((p) => k.startsWith(p));

// "total" también es un conteo (calificaciones, citas): se quita solo cuando el
// objeto es una orden o lleva costos, que es cuando "total" es plata.
const PISTAS_DE_ORDEN = ['numero_orden', 'costo_mano_obra', 'costo_repuestos', 'moto_id'];

// Teléfono del cliente con nombre propio: siempre fuera.
const TELEFONO_CLIENTE = new Set(['cliente_telefono', 'telefono_cliente']);

// "telefono" a secas es del cliente en casi todas las rutas. En estas es el del
// propio mecánico, el de recepción o el del taller, y se deja.
const RUTAS_CON_TELEFONO_DEL_PERSONAL = [
  /^\/api\/mecanico\/(perfil|recepcion-contacto)(\/|\?|$)/,
  /^\/api\/auth\//,
  /^\/api\/marca(\/|\?|$)/,
];

function esObjetoPlano(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
    && !(v instanceof Date) && !Buffer.isBuffer(v);
}

function limpiar(valor, quitarTelefono) {
  if (Array.isArray(valor)) return valor.map((v) => limpiar(v, quitarTelefono));
  if (!esObjetoPlano(valor)) return valor;
  const esOrden = PISTAS_DE_ORDEN.some((k) => k in valor);
  const out = {};
  for (const [k, v] of Object.entries(valor)) {
    if (esDinero(k)) continue;
    if (k === 'total' && esOrden) continue;
    if (TELEFONO_CLIENTE.has(k)) continue;
    if (k === 'telefono' && quitarTelefono) continue;
    out[k] = limpiar(v, quitarTelefono);
  }
  return out;
}

function ocultarAlMecanico(req, res, next) {
  const json = res.json.bind(res);
  res.json = (body) => {
    if (req.usuario?.rol !== 'tecnico') return json(body);
    const url = req.originalUrl || '';
    const quitarTelefono = !RUTAS_CON_TELEFONO_DEL_PERSONAL.some((r) => r.test(url));
    return json(limpiar(body, quitarTelefono));
  };
  next();
}

module.exports = ocultarAlMecanico;
module.exports.limpiar = limpiar;
