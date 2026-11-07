// Feriados que se repiten: un día del año (mes y día) en que el taller cierra, todos
// los años. Se guardan en la tabla `feriados` y la agenda (utils/agenda.js) los trata
// como un bloqueo del día entero: el portal no los ofrece y recepción no agenda ahí.
//
// Solo fechas fijas. Jueves y Viernes Santo cambian cada año, y el Gobierno a veces
// traslada un feriado al lunes: esos se bloquean a mano en Bloquear horario.

// Feriados de ley de Costa Rica con fecha fija (verificado el 24-oct-2026 contra la
// lista publicada para 2026). No se marca ninguno solo: se ofrecen para elegir,
// porque cerrar o no un feriado lo decide el taller.
const FERIADOS_CR = [
  { mes: 1, dia: 1, nombre: 'Año Nuevo' },
  { mes: 4, dia: 11, nombre: 'Día de Juan Santamaría' },
  { mes: 5, dia: 1, nombre: 'Día del Trabajador' },
  { mes: 7, dia: 25, nombre: 'Anexión del Partido de Nicoya' },
  { mes: 8, dia: 2, nombre: 'Virgen de los Ángeles' },
  { mes: 8, dia: 15, nombre: 'Día de la Madre' },
  { mes: 8, dia: 31, nombre: 'Día de la Persona Negra y la Cultura Afrocostarricense' },
  { mes: 9, dia: 15, nombre: 'Día de la Independencia' },
  { mes: 12, dia: 1, nombre: 'Abolición del Ejército' },
  { mes: 12, dia: 25, nombre: 'Navidad' },
];

const DIAS_DEL_MES = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

// ¿Existe ese día en algún año? (29 de febrero sí: solo cae en los bisiestos).
function fechaValida(mes, dia) {
  return Number.isInteger(mes) && Number.isInteger(dia) && mes >= 1 && mes <= 12 && dia >= 1 && dia <= DIAS_DEL_MES[mes - 1];
}

const dos = (n) => String(n).padStart(2, '0');

// ¿'YYYY-MM-DD' cae en ese feriado?
function caeEn(fecha, f) {
  return fecha.slice(5, 7) === dos(f.mes) && fecha.slice(8, 10) === dos(f.dia);
}

// La próxima vez que cae, desde `hoy` ('YYYY-MM-DD') inclusive. Un 29 de febrero
// salta al próximo año bisiesto.
function proximaFecha(mes, dia, hoy) {
  let anio = Number(hoy.slice(0, 4));
  for (let i = 0; i < 9; i++, anio++) {
    const f = `${anio}-${dos(mes)}-${dos(dia)}`;
    const d = new Date(`${f}T12:00:00Z`);
    if (d.getUTCMonth() + 1 !== mes) continue; // 29-feb en año no bisiesto
    if (f >= hoy) return f;
  }
  return null;
}

module.exports = { FERIADOS_CR, fechaValida, caeEn, proximaFecha };
