// Datos de muestra de las pantallas de la landing.
//
// Son inventados pero coherentes: las sumas dan, las placas tienen formato tico y
// los montos van en colones. Todo vive acá para cambiarlo de un solo lugar. Si un
// taller real presta sus datos, se reemplazan acá (y se pide permiso antes).

export const crc = (n: number) => '₡' + n.toLocaleString('es-CR').replace(/\s/g, '.');

/** La orden que recorre las etapas (sección "Cómo funciona"). */
export const ORDEN = {
  numero: 'OT-2026-0148',
  vehiculo: 'Honda CB190R 2022',
  placa: 'MOT 638214',
  cliente: 'Andrés Solano',
  telefono: '8814 2297',
  problema: 'Frena tarde y chilla adelante.',
  km: '18.420 km',
  combustible: 'Medio tanque',
  recibio: 'Laura · recepción',
  mecanico: 'Carlos Ureña',
  diagnostico: 'Disco delantero gastado bajo el mínimo (3,6 mm). Pastillas al 10 %.',
  lineas: [
    { concepto: 'Disco de freno delantero', monto: 42000 },
    { concepto: 'Pastillas de freno delanteras', monto: 18500 },
    { concepto: 'Mano de obra', monto: 24000 },
  ],
  aprobado: 'Aprobado por Andrés desde su portal · 10:41 a. m.',
  pago: 'SINPE Móvil',
  garantia: 'Garantía de 30 días, hasta el 8 dic. 2026',
};
export const TOTAL_ORDEN = ORDEN.lineas.reduce((s, l) => s + l.monto, 0);   // 84.500

export const ETAPAS = [
  { nombre: 'Recepción', frase: 'Primero, la moto entra.', estado: 'Recepción', tono: 'neutro' },
  { nombre: 'Diagnóstico', frase: 'Después, el diagnóstico.', estado: 'Esperando aprobación', tono: 'ambar' },
  { nombre: 'Aprobación', frase: 'Luego, el cliente aprueba.', estado: 'En reparación', tono: 'indigo' },
  { nombre: 'Entrega', frase: 'Al final, la retira.', estado: 'Entregada', tono: 'esmeralda' },
] as const;

/** Historial de una placa (vitrina: "¿Dónde anoté ese trabajo?"). */
export const HISTORIAL = [
  { fecha: '08/11/26', numero: 'OT-2026-0148', trabajo: 'Frenos delanteros', monto: 84500, estado: 'En reparación' },
  { fecha: '14/08/26', numero: 'OT-2026-0093', trabajo: 'Cambio de aceite y filtro', monto: 28000, estado: 'Entregada' },
  { fecha: '02/05/26', numero: 'OT-2026-0041', trabajo: 'Kit de arrastre', monto: 61500, estado: 'Entregada' },
  { fecha: '17/01/26', numero: 'OT-2026-0007', trabajo: 'Revisión general', monto: 35000, estado: 'Entregada' },
];
export const TOTAL_HISTORIAL = HISTORIAL.reduce((s, o) => s + o.monto, 0);   // 209.000

/** Portal del cliente (vitrina: "¿Ya está mi carro?"). Un auto, para mostrar que no es solo motos. */
export const PORTAL = {
  taller: 'Taller Jiménez',
  cliente: 'Mariela',
  vehiculo: 'Toyota Yaris 2019',
  placa: 'BTX-482',
  pasos: ['Recibido', 'Diagnóstico', 'Aprobado', 'En reparación', 'Listo para retirar'],
  actual: 3,
  mensaje: 'Le estamos cambiando las pastillas y rectificando los discos. Te avisamos apenas esté listo.',
  retiro: 'Jueves 12 nov., 4:00 p. m.',
};

/** Agenda del día (vitrina: "Citas que nadie olvida"). */
export const AGENDA = {
  dia: 'Jueves 12 de noviembre',
  mecanicos: [
    {
      nombre: 'Carlos',
      citas: [
        { hora: '8:00', vehiculo: 'Yamaha FZ25', servicio: 'Cambio de aceite', estado: 'Confirmada' },
        { hora: '11:00', vehiculo: 'Bajaj Pulsar 200', servicio: 'Kit de arrastre', estado: 'Aviso enviado' },
      ],
    },
    {
      nombre: 'Diego',
      citas: [
        { hora: '9:30', vehiculo: 'Toyota Yaris', servicio: 'Frenos', estado: 'Confirmada' },
        { hora: '14:00', vehiculo: 'Suzuki Gixxer 150', servicio: 'Revisión general', estado: 'Por confirmar' },
      ],
    },
  ],
};

/** Reportes del mes (vitrina: "Saber cómo va el mes"). */
export const SEMANAS = [
  { nombre: 'Sem 1', monto: 298000 },
  { nombre: 'Sem 2', monto: 412500 },
  { nombre: 'Sem 3', monto: 351000 },
  { nombre: 'Sem 4', monto: 223000 },
];
export const FACTURADO = SEMANAS.reduce((s, x) => s + x.monto, 0);            // 1.284.500
export const ENTREGADAS = 37;
export const TICKET = Math.round(FACTURADO / ENTREGADAS);                      // 34.716
export const SERVICIOS_TOP = [
  { nombre: 'Cambio de aceite', veces: 14 },
  { nombre: 'Frenos', veces: 9 },
  { nombre: 'Kit de arrastre', veces: 6 },
];
