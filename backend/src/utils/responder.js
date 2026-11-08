// Respuesta de error centralizada: loguea el detalle real en el servidor
// y devuelve un mensaje corto al cliente (no filtra mensajes internos/SQL).
//
// Cuando se sabe en qué campo del formulario está el problema, la respuesta lleva
// `campo` (el `name` del campo en la pantalla): el panel y el portal bajan hasta él,
// lo marcan en rojo y ponen el mensaje debajo (frontend/src/app/shared/errores.ts).
const crypto = require('crypto');

// Errores de MySQL que en realidad describen un dato inválido del cliente, no una
// falla del servidor. Devolverlos como 500 tiene dos costos: el cliente no puede
// distinguir "mandé mal los datos" de "el sistema está caído", y en el monitoreo un
// formulario mal llenado se ve igual que una caída real. Salió de la prueba de carga:
// referencias inexistentes generaban 500 y disparaban la tasa de error al 6%.
const POR_DATO_INVALIDO = {
  // FK que apunta a una fila que no existe (cliente_id, vehiculo_id… inventados).
  ER_NO_REFERENCED_ROW: 'Alguno de los datos relacionados no existe',
  ER_NO_REFERENCED_ROW_2: 'Alguno de los datos relacionados no existe',
  // Borrar algo de lo que todavía cuelgan otras filas.
  ER_ROW_IS_REFERENCED: 'No se puede eliminar: hay registros que dependen de esto',
  ER_ROW_IS_REFERENCED_2: 'No se puede eliminar: hay registros que dependen de esto',
  // Único duplicado (correo repetido, placa repetida…).
  ER_DUP_ENTRY: 'Ese valor ya existe',
  // Texto más largo que la columna, o fuera del rango del ENUM.
  ER_DATA_TOO_LONG: 'Alguno de los valores es demasiado largo',
  WARN_DATA_TRUNCATED: 'Alguno de los valores no es válido',
  ER_TRUNCATED_WRONG_VALUE: 'Alguno de los valores no tiene el formato esperado',
  ER_BAD_NULL_ERROR: 'Falta un dato obligatorio',
};

// Cómo se llama cada columna para una persona (para los mensajes de abajo).
const NOMBRE_CAMPO = {
  nombre: 'el nombre', apellido: 'el apellido', email: 'el correo', telefono: 'el teléfono',
  cedula: 'la cédula', placa: 'la placa', marca: 'la marca', modelo: 'el modelo', color: 'el color',
  motivo: 'el motivo', descripcion: 'la descripción', problema_reportado: 'el problema',
  direccion: 'la dirección', titulo: 'el título', fecha: 'la fecha', hora: 'la hora',
  prioridad: 'la prioridad', nivel_combustible: 'el combustible', kilometraje_ingreso: 'el kilometraje',
  accesorios_entregados: 'los accesorios', estado_fisico: 'el estado físico', precio: 'el precio',
};

// Los duplicados más comunes, por el nombre de la clave única que choca.
const DUPLICADOS = [
  [/email/i, 'email', 'Ese correo ya está registrado'],
  [/placa/i, 'placa', 'Esa placa ya está registrada'],
  [/cedula/i, 'cedula', 'Esa cédula ya está registrada'],
  [/servicio_nombre/i, 'nombre', 'Ya hay un servicio con ese nombre'],
  [/slug/i, 'nombre', 'Ya hay una moto con ese nombre'],
];

// Saca el campo y un mensaje más preciso del texto de MySQL, cuando lo dice.
// "Data too long for column 'nombre'" → { campo: 'nombre', error: 'El nombre es demasiado largo' }.
function precisar(err) {
  const sql = String(err?.sqlMessage || '');
  if (err?.code === 'ER_DUP_ENTRY') {
    const clave = (sql.match(/for key '([^']+)'/) || [])[1] || '';
    const d = DUPLICADOS.find(([re]) => re.test(clave));
    return d ? { campo: d[1], error: d[2] } : null;
  }
  const col = (sql.match(/column '([^']+)'/i) || [])[1];
  if (!col) return null;
  const nombre = NOMBRE_CAMPO[col];
  if (!nombre) return { campo: col };
  const Nombre = nombre[0].toUpperCase() + nombre.slice(1);
  if (err.code === 'ER_DATA_TOO_LONG') return { campo: col, error: `${Nombre} es demasiado largo` };
  if (err.code === 'ER_BAD_NULL_ERROR') return { campo: col, error: `Falta ${nombre}` };
  return { campo: col, error: `${Nombre} no es válido` };
}

function fail(res, err, status = 500) {
  const mensaje = POR_DATO_INVALIDO[err?.code];
  if (mensaje && status === 500) {
    // Se loguea igual, pero como aviso: sirve para detectar validaciones que faltan
    // en una ruta, sin ensuciar los errores de verdad.
    console.warn(`Dato inválido (${err.code}):`, err?.sqlMessage || err?.message);
    const p = precisar(err);
    return res.status(400).json(p ? { error: p.error || mensaje, campo: p.campo } : { error: mensaje });
  }
  // Un error de verdad: el mensaje no cuenta nada interno, pero lleva un código corto
  // que también queda en el registro, para encontrar exactamente qué pasó.
  const codigo = crypto.randomBytes(2).toString('hex').toUpperCase();
  console.error(`Error [${codigo}]:`, err?.stack || err?.message || err);
  res.status(status).json({ error: `Falló el servidor (código ${codigo}).`, codigo_error: codigo });
}

// Un dato del formulario no sirve: 400 con el mensaje y el campo donde está el problema.
function invalido(res, campo, error, status = 400) {
  return res.status(status).json({ error, campo });
}

// El primer dato obligatorio que falta: responde 400 «Falta el correo» con su campo y
// devuelve true; si están todos, false. campos = [[campo, 'el correo'], ...].
function faltante(res, datos, campos) {
  for (const [campo, nombre] of campos) {
    const v = datos?.[campo];
    if (v === undefined || v === null || String(v).trim() === '') {
      invalido(res, campo, `Falta ${nombre}`);
      return true;
    }
  }
  return false;
}

module.exports = { fail, invalido, faltante };
