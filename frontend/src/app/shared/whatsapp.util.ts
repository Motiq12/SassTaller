// Utilidad para notificar al cliente por WhatsApp (click-to-send, sin API ni costo).
// Arma un mensaje según la etapa de la orden y abre wa.me con el teléfono del cliente.

// Los mensajes al cliente. El taller puede reescribir cualquiera en Configuración →
// Mensajes al cliente; acá están los de fábrica. Al cliente se le habla de tú.
//
// Un texto lleva datos entre llaves ({nombre}, {vehiculo}…). Lo que va entre corchetes
// solo sale si todos sus datos tienen valor: "listo[ por {total}]" queda "listo" si no
// hay total. La misma regla está en backend/src/utils/plantillas.js (rellenar).
export interface DatosMensaje {
  nombre?: string | null;
  moto?: string | null;
  vehiculo?: string | null;
  orden?: string | null;
  total?: string | null;
  portal?: string | null;
  hora?: string | null;
  nota?: string | null;
  usuario?: string | null;
  contrasena?: string | null;
}

export interface PlantillaWa {
  clave: string;
  grupo: 'orden' | 'cita' | 'portal';
  label: string;
  datos: (keyof DatosMensaje)[];
  fabrica: string;
}

export const PLANTILLAS_WA: PlantillaWa[] = [
  { clave: 'orden_recibida', grupo: 'orden', label: 'Vehículo recibido', datos: ['nombre', 'vehiculo', 'orden'],
    fabrica: 'Hola {nombre}, recibimos tu {vehiculo} en el taller[ (orden {orden})]. Te iremos avisando del avance. ¡Gracias!' },
  { clave: 'orden_diagnostico', grupo: 'orden', label: 'Diagnóstico listo', datos: ['nombre', 'vehiculo'],
    fabrica: 'Hola {nombre}, ya revisamos tu {vehiculo} y tenemos el diagnóstico. En breve te enviamos el presupuesto para tu aprobación.' },
  { clave: 'orden_aprobacion', grupo: 'orden', label: 'Presupuesto para aprobar', datos: ['nombre', 'vehiculo', 'orden', 'total', 'portal'],
    fabrica: 'Hola {nombre}, el presupuesto de tu {vehiculo}[ (orden {orden})] está listo[ por {total}]. Puedes revisarlo y aprobarlo desde el portal: {portal}' },
  { clave: 'orden_repuestos', grupo: 'orden', label: 'Esperando repuestos', datos: ['nombre', 'vehiculo'],
    fabrica: 'Hola {nombre}, estamos a la espera de repuestos para tu {vehiculo}. Apenas lleguen, continuamos con la reparación y te avisamos.' },
  { clave: 'orden_reparacion', grupo: 'orden', label: 'En reparación', datos: ['nombre', 'vehiculo'],
    fabrica: 'Hola {nombre}, ya estamos trabajando en la reparación de tu {vehiculo}. Te avisamos cuando terminemos.' },
  { clave: 'orden_lista', grupo: 'orden', label: 'Lista para retirar', datos: ['nombre', 'vehiculo', 'orden'],
    fabrica: 'Hola {nombre}, ¡buenas noticias! Ya puedes retirar tu {vehiculo}[ (orden {orden})]. Te esperamos en el taller. 🎉' },
  { clave: 'orden_entregada', grupo: 'orden', label: 'Entrega y factura', datos: ['nombre', 'vehiculo', 'total'],
    fabrica: 'Hola {nombre}, gracias por confiar en nosotros. La factura de tu {vehiculo}[ por {total}] está lista. ¡Hasta la próxima!' },
  { clave: 'orden_avance', grupo: 'orden', label: 'Novedad con fotos del avance', datos: ['nombre', 'vehiculo', 'orden', 'nota', 'portal'],
    fabrica: 'Hola {nombre}, novedad de tu {vehiculo}[ (orden {orden})].[ {nota}] Revisa las fotos del avance en el portal: {portal}' },
  { clave: 'cita_recordatorio', grupo: 'cita', label: 'Recordatorio de la cita', datos: ['nombre', 'vehiculo', 'hora'],
    fabrica: 'Hola {nombre} 👋, te recordamos tu cita[ hoy a las {hora}] para tu {vehiculo}. ¿Nos confirmas tu asistencia?' },
  { clave: 'cita_avance', grupo: 'cita', label: 'Avance de la cita', datos: ['nombre', 'vehiculo'],
    fabrica: 'Hola {nombre}, te contamos sobre el avance de tu {vehiculo} en el taller.' },
  { clave: 'portal_acceso', grupo: 'portal', label: 'Acceso al portal', datos: ['nombre', 'portal', 'usuario', 'contrasena'],
    fabrica: 'Hola {nombre}, ya puedes seguir el estado de tu vehículo en línea:\n{portal}\n\nUsuario: {usuario}\nContraseña: {contrasena}\n\nAhí vas a ver el avance y aprobar presupuestos.' },
];

export const NOMBRE_DATO: Record<keyof DatosMensaje, string> = {
  nombre: 'nombre del cliente', moto: 'marca y modelo', vehiculo: 'marca y modelo', orden: 'número de orden', total: 'total en colones',
  portal: 'enlace del portal', hora: 'hora de la cita', nota: 'nota que escribe recepción', usuario: 'correo del cliente',
  contrasena: 'contraseña nueva',
};

export function rellenar(texto: string, datos: DatosMensaje): string {
  // {moto} era el nombre anterior de {vehiculo}: hay talleres con textos guardados que lo usan.
  const valor = (k: string) => String((datos as any)[k === 'vehiculo' ? 'moto' : k] ?? '').trim();
  return String(texto || '')
    .replace(/\[([^\[\]]*)\]/g, (_, trozo: string) =>
      (trozo.match(/\{\w+\}/g) || []).every(m => valor(m.slice(1, -1))) ? trozo : '')
    .replace(/\{(\w+)\}/g, (_, k: string) => valor(k))
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

// El texto de una plantilla, con lo que reescribió el taller encima de lo de fábrica.
export function armarMensaje(clave: string, datos: DatosMensaje, propias: Record<string, string> = {}): string {
  const p = PLANTILLAS_WA.find(x => x.clave === clave);
  return rellenar(propias[clave] || p?.fabrica || '', datos);
}

export const colones = (n?: number) => (n ? `₡${n.toLocaleString('es-CR')}` : '');
export const motoDe = (x: { marca?: string; modelo?: string } | null | undefined) =>
  `${x?.marca || ''} ${x?.modelo || ''}`.trim() || 'vehículo';

// Mensaje sugerido según el estado actual de la orden.
const ESTADO_A_MENSAJE: Record<string, string> = {
  recepcion: 'orden_recibida',
  diagnostico: 'orden_diagnostico',
  esperando_aprobacion: 'orden_aprobacion',
  esperando_repuestos: 'orden_repuestos',
  en_reparacion: 'orden_reparacion',
  lista_entrega: 'orden_lista',
  entregada: 'orden_entregada',
};

export function mensajeSugerido(estado?: string): string {
  return (estado && ESTADO_A_MENSAJE[estado]) || 'orden_recibida';
}

// Normaliza un teléfono a dígitos con código de país para wa.me.
// En Costa Rica los números son de 8 dígitos: se les antepone 506.
export function normalizarTelefono(telefono?: string | null): string {
  let tel = (telefono || '').replace(/\D/g, '');
  if (tel.startsWith('00')) tel = tel.slice(2);
  if (tel.length === 8) tel = '506' + tel;
  return tel;
}

// Abre WhatsApp con el mensaje. Devuelve false si no hay teléfono válido.
export function abrirWhatsApp(telefono: string | null | undefined, mensaje: string): boolean {
  const tel = normalizarTelefono(telefono);
  if (!tel) return false;
  window.open(`https://wa.me/${tel}?text=${encodeURIComponent(mensaje)}`, '_blank');
  return true;
}

// Qué plantilla corresponde a una CITA del día según su estado (distinto del estado
// de la orden): lista, en el taller o recordatorio.
export function plantillaDeCita(c: any): string {
  if (c?.estado === 'listo') return 'orden_lista';
  if (c?.estado === 'en_revision' || c?.estado === 'en_mantenimiento') return 'cita_avance';
  return 'cita_recordatorio';
}
