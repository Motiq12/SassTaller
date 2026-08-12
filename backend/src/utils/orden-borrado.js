// En qué orden hay que borrar las tablas de un taller para no violar ninguna clave
// foránea: los hijos antes que los padres.
//
// Por qué existe: borrar un taller entero tenía que hacer `SET FOREIGN_KEY_CHECKS = 0`
// porque mantener el orden a mano se rompía en cuanto alguien agregaba una tabla. La
// consecuencia era que la única forma de atender un "borrame mis datos" era apagando la
// integridad referencial — y si algo fallaba a mitad, con la comprobación apagada, las
// filas huérfanas quedaban sin que nadie se enterara.
//
// El orden se deduce del esquema real en cada corrida, así que una tabla nueva entra
// sola. Y con las comprobaciones ENCENDIDAS: si el orden estuviera mal, MySQL lo dice
// en vez de dejar basura.

// Orden topológico. `grafo` es tabla -> conjunto de tablas a las que apunta con una FK.
// Devuelve las tablas con los hijos primero.
//
// Lanza si hay un ciclo en vez de devolver un orden a medias: un ciclo de claves
// foráneas no se puede borrar sin romper alguna, y hay que enterarse acá y no con media
// base borrada.
function ordenarPorDependencias(grafo) {
  const pendientes = new Map(Object.entries(grafo).map(([t, d]) => [t, new Set(d)]));
  const padresPrimero = [];

  while (pendientes.size) {
    // Una tabla está "libre" cuando ya no apunta a ninguna que siga pendiente.
    const libres = [...pendientes.keys()]
      .filter(t => ![...pendientes.get(t)].some(d => pendientes.has(d)))
      .sort();
    if (!libres.length) {
      throw new Error(`orden-borrado: ciclo de claves foráneas entre ${[...pendientes.keys()].join(', ')}`);
    }
    for (const t of libres) { padresPrimero.push(t); pendientes.delete(t); }
  }

  // El recorrido saca primero las que no dependen de nadie —los padres—, y para borrar
  // hace falta exactamente lo contrario.
  return padresPrimero.reverse();
}

// Lee el grafo de claves foráneas del esquema vivo, limitado a las tablas indicadas.
// Las FK que apuntan afuera del conjunto (a `tenants`) no cuentan: esa fila se borra
// aparte y al final.
async function grafoDeFks(pool, tablas) {
  const lista = [...tablas];
  const [filas] = await pool.query(
    `SELECT TABLE_NAME AS hija, REFERENCED_TABLE_NAME AS padre
       FROM information_schema.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA = DATABASE()
        AND REFERENCED_TABLE_NAME IS NOT NULL
        AND TABLE_NAME IN (${lista.map(() => '?').join(',')})`,
    lista
  );
  const grafo = Object.fromEntries(lista.map(t => [t, new Set()]));
  for (const { hija, padre } of filas) {
    // Las autorreferencias no imponen orden ENTRE tablas (una fila que apunta a otra de
    // la misma tabla se resuelve dentro del mismo DELETE).
    if (grafo[hija] && grafo[padre] && hija !== padre) grafo[hija].add(padre);
  }
  return grafo;
}

async function ordenDeBorrado(pool, tablas) {
  return ordenarPorDependencias(await grafoDeFks(pool, tablas));
}

module.exports = { ordenarPorDependencias, grafoDeFks, ordenDeBorrado };
