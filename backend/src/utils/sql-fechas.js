// "Hoy", "esta semana", "este mes"… en la hora del taller, para las consultas.
//
// En Railway MySQL corre en UTC: CURDATE() y MONTH(NOW()) cambian de día a las 6 p. m.
// de Costa Rica. Después de esa hora, la agenda "de hoy" de recepción mostraba las
// citas de mañana y lo cobrado "hoy" volvía a cero. Acá el período se calcula en Node
// con la zona del taller (configuracion.zona_horaria_offset) y la consulta compara
// contra esos valores.
//
// Las columnas de día (DATE: citas.fecha, fecha_estimada_entrega) se comparan contra
// días; las de momento (TIMESTAMP: fecha_fin, fecha_entrega_real, fecha_ingreso),
// contra el instante en que empieza ese día en el taller. mysql2 escribe ese instante
// en la zona del proceso, que es la misma que usa la base al guardar (UTC en Railway,
// la de la computadora en local), así que la comparación vale en las dos.

const mysql = require('mysql2');
const { fechaLocalISO } = require('./fecha');

const PERIODOS = ['hoy', 'semana', 'mes', 'mes_pasado', 'anio'];

// El período como días semiabiertos [desde, hasta). La semana va de lunes a domingo.
function rangoDelTaller(periodo, offset = -6, ahora = Date.now()) {
  if (!PERIODOS.includes(periodo)) throw new Error(`Período no válido: ${periodo}`);
  const hoy = fechaLocalISO(offset, 0, ahora);
  const [a, m, d] = hoy.split('-').map(Number);
  const dia = (y, mes, n) => new Date(Date.UTC(y, mes - 1, n)).toISOString().slice(0, 10);
  if (periodo === 'hoy') return { desde: hoy, hasta: dia(a, m, d + 1) };
  if (periodo === 'semana') {
    const lunes = d - ((new Date(Date.UTC(a, m - 1, d)).getUTCDay() + 6) % 7);
    return { desde: dia(a, m, lunes), hasta: dia(a, m, lunes + 7) };
  }
  if (periodo === 'mes') return { desde: dia(a, m, 1), hasta: dia(a, m + 1, 1) };
  if (periodo === 'mes_pasado') return { desde: dia(a, m - 1, 1), hasta: dia(a, m, 1) };
  return { desde: dia(a, 1, 1), hasta: dia(a + 1, 1, 1) };
}

// El instante en que empieza ese día en el taller.
function inicioDelDia(fecha, offset = -6) {
  return new Date(Date.parse(`${fecha}T00:00:00Z`) - (Number(offset) || 0) * 3600000);
}

const COLUMNA = /^[a-z_]+(\.[a-z_]+)?$/;

// Condición SQL: `col` cae en el período. `momento`: la columna guarda un instante.
function enPeriodo(col, periodo, { momento = false, offset = -6, ahora = Date.now() } = {}) {
  if (!COLUMNA.test(col)) throw new Error(`Columna no válida: ${col}`);
  const r = rangoDelTaller(periodo, offset, ahora);
  const valor = (f) => mysql.escape(momento ? inicioDelDia(f, offset) : f);
  return `(${col} >= ${valor(r.desde)} AND ${col} < ${valor(r.hasta)})`;
}

// El día de hoy del taller, ya escapado para meterlo en una consulta ('2026-10-24').
function hoySQL(offset = -6, ahora = Date.now()) {
  return mysql.escape(fechaLocalISO(offset, 0, ahora));
}

// Cuántos días tiene el período (para la serie diaria de los reportes).
function diasDelPeriodo(periodo, offset = -6, ahora = Date.now()) {
  const r = rangoDelTaller(periodo, offset, ahora);
  return Math.round((Date.parse(r.hasta) - Date.parse(r.desde)) / 86400000);
}

module.exports = { rangoDelTaller, inicioDelDia, enPeriodo, hoySQL, diasDelPeriodo, PERIODOS };
