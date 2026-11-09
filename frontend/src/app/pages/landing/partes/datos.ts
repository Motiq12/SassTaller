// Datos de muestra de las pantallas de la landing.
//
// Son inventados pero coherentes: las sumas dan, las placas tienen formato tico y
// los montos van en colones. Todo vive acá para cambiarlo de un solo lugar. Si un
// taller real presta sus datos, se reemplazan acá (y se pide permiso antes).

import { ESTADO_CONFIG } from '../../../models/orden.model';
import { ESTADO_CITA_LABEL, ETAPAS_PORTAL } from '../../../shared/utils/servicios.util';

// Los NOMBRES de estados y etapas no se escriben acá: salen de las mismas constantes
// que usa la app (ESTADO_CONFIG, ESTADO_CITA_LABEL, ETAPAS_PORTAL). Así lo que se ve
// en la landing es lo que el taller y sus clientes encuentran adentro, y si la app
// cambia un nombre, la landing cambia con ella. Los datos (personas, placas, montos)
// sí son de ejemplo, y cada pantalla lo dice.
const E = ESTADO_CONFIG;

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
  { nombre: 'Recepción', frase: 'Primero, la moto entra.', estado: E.recepcion.label, tono: 'neutro',
    detalle: 'Recepción registra la placa, el kilometraje, el combustible y lo que cuenta el cliente, y la orden queda asignada a un mecánico.' },
  { nombre: 'Diagnóstico', frase: 'Después, el diagnóstico.', estado: E.esperando_aprobacion.label, tono: 'ambar',
    detalle: 'El mecánico anota lo que encontró y se arma el presupuesto, que le llega al cliente a su portal.' },
  { nombre: 'Aprobación', frase: 'Luego, el cliente aprueba.', estado: E.en_reparacion.label, tono: 'indigo',
    detalle: 'El cliente lo aprueba desde el celular. La orden pasa sola a reparación y queda registrado cuándo aprobó.' },
  { nombre: 'Entrega', frase: 'Al final, la retira.', estado: E.entregada.label, tono: 'esmeralda',
    detalle: 'Se cierra con el pago y la garantía, y todo queda en el historial de la placa para la próxima visita.' },
] as const;

/** Historial de una placa (vitrina: "¿Dónde anoté ese trabajo?"). */
export const HISTORIAL = [
  { fecha: '08/11/26', numero: 'OT-2026-0148', trabajo: 'Frenos delanteros', monto: 84500, estado: E.en_reparacion.label },
  { fecha: '14/08/26', numero: 'OT-2026-0093', trabajo: 'Cambio de aceite y filtro', monto: 28000, estado: E.entregada.label },
  { fecha: '02/05/26', numero: 'OT-2026-0041', trabajo: 'Kit de arrastre', monto: 61500, estado: E.entregada.label },
  { fecha: '17/01/26', numero: 'OT-2026-0007', trabajo: 'Revisión general', monto: 35000, estado: E.entregada.label },
];
export const TOTAL_HISTORIAL = HISTORIAL.reduce((s, o) => s + o.monto, 0);   // 209.000

/** Portal del cliente (vitrina: "¿Ya está mi carro?"). Un auto, para mostrar que no es solo motos. */
export const PORTAL = {
  taller: 'Taller Jiménez',
  cliente: 'Mariela',
  vehiculo: 'Toyota Yaris 2019',
  placa: 'BTX-482',
  // Las mismas etapas y nombres que la línea de tiempo del portal real.
  pasos: ETAPAS_PORTAL.map((e) => e.label),
  actual: 2,   // En mantenimiento
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
        { hora: '8:00', vehiculo: 'Yamaha FZ25', servicio: 'Cambio de aceite', estado: ESTADO_CITA_LABEL['en_mantenimiento'] },
        { hora: '11:00', vehiculo: 'Bajaj Pulsar 200', servicio: 'Kit de arrastre', estado: ESTADO_CITA_LABEL['agendado'] },
      ],
    },
    {
      nombre: 'Diego',
      citas: [
        { hora: '9:30', vehiculo: 'Toyota Yaris', servicio: 'Frenos', estado: ESTADO_CITA_LABEL['en_revision'] },
        { hora: '14:00', vehiculo: 'Suzuki Gixxer 150', servicio: 'Revisión general', estado: ESTADO_CITA_LABEL['agendado'] },
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
