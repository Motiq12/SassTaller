// Datos de ejemplo para el taller que recién se registró.
//
// Un sistema de gestión vacío no se puede evaluar: todas las pantallas se ven iguales
// —una lista sin nada— y no hay forma de saber si sirve sin cargar media hora de datos
// reales primero. Esto pone un taller de mentira funcionando en un segundo, con órdenes
// repartidas por el flujo para que el tablero muestre algo.
//
// Y se va con un botón: las filas quedan marcadas con `es_ejemplo = 1`, así que el
// borrado es exacto. Sin esa marca habría que adivinar ("todo lo del primer día"), y
// esa clase de borrado se lleva por delante lo que el taller ya cargó de verdad.
const { generarNumeroOrden } = require('./ordenes');
const { getConfig } = require('./configuracion');
const { normalizarTipos } = require('./tipos-vehiculo');

const CLIENTES = [
  { nombre: 'Ana',    apellido: 'Rojas (ejemplo)',  telefono: '8888-0001', email: 'ana.ejemplo@motiq.app' },
  { nombre: 'Carlos', apellido: 'Mora (ejemplo)',   telefono: '8888-0002', email: 'carlos.ejemplo@motiq.app' },
  { nombre: 'Lucía',  apellido: 'Vargas (ejemplo)', telefono: '8888-0003', email: 'lucia.ejemplo@motiq.app' },
];

// Dos juegos de vehículos según lo que atienda el taller. Sembrarle motos a un taller
// de autos sería peor que no sembrar nada: la primera impresión del producto sería que
// no es para él (el mismo criterio que ya usa el catálogo de servicios del alta).
const VEHICULOS = {
  moto: [
    { marca: 'Honda',   modelo: 'CB 190R',   anio: 2021, placa: 'MOT-101', color: 'Rojo' },
    { marca: 'Yamaha',  modelo: 'FZ 2.0',    anio: 2019, placa: 'MOT-102', color: 'Negro' },
  ],
  auto: [
    { marca: 'Toyota',  modelo: 'Yaris',     anio: 2018, placa: 'AUT-201', color: 'Gris' },
    { marca: 'Hyundai', modelo: 'Tucson',    anio: 2020, placa: 'AUT-202', color: 'Blanco' },
  ],
};

// Órdenes repartidas por el flujo: el tablero y los filtros por estado no dicen nada si
// las cinco están en 'recepcion'.
const ORDENES = [
  { estado: 'recepcion',            problema: 'Revisión general y cambio de aceite' },
  { estado: 'diagnostico',          problema: 'Hace un ruido al frenar' },
  { estado: 'esperando_aprobacion', problema: 'Cambio de pastillas y discos' },
  { estado: 'en_reparacion',        problema: 'Fuga de aceite en el motor' },
  { estado: 'lista_entrega',        problema: 'Mantenimiento de los 20.000 km' },
];

async function hayEjemplo(db) {
  const [[{ n }]] = await db.query(
    'SELECT COUNT(*) AS n FROM clientes WHERE tenant_id = @tenant AND es_ejemplo = 1'
  );
  return n > 0;
}

async function cargarEjemplo(db) {
  // Volver a cargar duplicaría todo. Se responde que ya están en vez de fallar: quien
  // apretó dos veces el botón quiere ver datos, y ya los tiene.
  if (await hayEjemplo(db)) return { ya: true, creados: 0 };

  // normalizarTipos es el mismo camino que usan vehiculos y el portal para leer este
  // campo: la columna es JSON y nunca devuelve vacío. Comprobarlo a mano acá sería una
  // segunda interpretación del mismo dato, lista para quedar desincronizada.
  const config = await getConfig(db);
  const tipos = normalizarTipos(config.tipos_vehiculo);
  const flota = tipos.flatMap(t => (VEHICULOS[t] || []).map(v => ({ ...v, tipo: t })));

  // Los números de orden se piden ANTES de abrir la transacción: generarNumeroOrden usa
  // su propia conexión para el contador atómico, y pedirlos desde adentro mezclaría dos
  // conexiones en la misma operación sin necesidad. Que el contador avance aunque
  // después se haga rollback es normal — un correlativo puede saltarse números.
  const numeros = [];
  for (let i = 0; i < ORDENES.length; i++) numeros.push(await generarNumeroOrden(db));

  const conn = await db.conexion();
  try {
    await conn.beginTransaction();

    const clienteIds = [];
    for (const c of CLIENTES) {
      const [r] = await conn.query(
        `INSERT INTO clientes (tenant_id, nombre, apellido, telefono, email, activo, es_ejemplo)
         VALUES (@tenant, ?, ?, ?, ?, 1, 1)`,
        [c.nombre, c.apellido, c.telefono, c.email]
      );
      clienteIds.push(r.insertId);
    }

    const vehiculoIds = [];
    for (const [i, v] of flota.entries()) {
      const [r] = await conn.query(
        `INSERT INTO vehiculos (tenant_id, cliente_id, tipo, marca, modelo, anio, placa, color, activa, es_ejemplo)
         VALUES (@tenant, ?, ?, ?, ?, ?, ?, ?, 1, 1)`,
        [clienteIds[i % clienteIds.length], v.tipo, v.marca, v.modelo, v.anio, v.placa, v.color]
      );
      vehiculoIds.push({ id: r.insertId, cliente_id: clienteIds[i % clienteIds.length] });
    }

    for (const [i, o] of ORDENES.entries()) {
      const veh = vehiculoIds[i % vehiculoIds.length];
      // El número sale del contador real del taller: una orden de ejemplo con un número
      // inventado rompería el correlativo que después ve el cliente en su factura.
      const numero = numeros[i];
      await conn.query(
        `INSERT INTO ordenes_trabajo (tenant_id, numero_orden, vehiculo_id, cliente_id, estado, problema_reportado, es_ejemplo)
         VALUES (@tenant, ?, ?, ?, ?, ?, 1)`,
        [numero, veh.id, veh.cliente_id, o.estado, o.problema]
      );
    }

    await conn.commit();
    return { ya: false, creados: CLIENTES.length + flota.length + ORDENES.length };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function borrarEjemplo(db) {
  const conn = await db.conexion();
  try {
    await conn.beginTransaction();
    // En orden de dependencia: las órdenes apuntan a vehículos y clientes, los vehículos
    // a clientes. No hace falta desactivar las claves foráneas — a diferencia de borrar
    // un taller entero, acá se sabe exactamente qué se creó y en qué orden.
    let filas = 0;
    for (const tabla of ['ordenes_trabajo', 'citas', 'vehiculos', 'clientes']) {
      const [r] = await conn.query(`DELETE FROM ${tabla} WHERE tenant_id = @tenant AND es_ejemplo = 1`);
      filas += r.affectedRows;
    }
    await conn.commit();
    return { borradas: filas };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = { cargarEjemplo, borrarEjemplo, hayEjemplo };
