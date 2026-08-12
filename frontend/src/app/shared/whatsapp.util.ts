// Utilidad para notificar al cliente por WhatsApp (click-to-send, sin API ni costo).
// Arma un mensaje según la etapa de la orden y abre wa.me con el teléfono del cliente.

export interface WaContexto {
  nombre: string;
  marca?: string;
  modelo?: string;
  numero_orden?: string;
  total?: number;
  portalLink?: string;
}

export interface WaMensaje {
  key: string;
  label: string;
  build: (c: WaContexto) => string;
}

const vehiculo = (c: WaContexto) => `${c.marca || ''} ${c.modelo || ''}`.trim();
const colones = (n?: number) => `₡${(n || 0).toLocaleString('es-CR')}`;

export const WA_MENSAJES: WaMensaje[] = [
  {
    key: 'recibida',
    label: 'Vehiculo recibida',
    build: c => `Hola ${c.nombre}, recibimos tu ${vehiculo(c)} en el taller (orden ${c.numero_orden}). Te iremos avisando del avance. ¡Gracias!`,
  },
  {
    key: 'diagnostico',
    label: 'Diagnóstico listo',
    build: c => `Hola ${c.nombre}, ya revisamos tu ${vehiculo(c)} y tenemos el diagnóstico. En breve te enviamos el presupuesto para tu aprobación.`,
  },
  {
    key: 'aprobacion',
    label: 'Presupuesto para aprobar',
    build: c => `Hola ${c.nombre}, el presupuesto de tu ${vehiculo(c)} está listo${c.total ? ` (total ${colones(c.total)})` : ''}. Podés revisarlo y aprobarlo desde el portal: ${c.portalLink || ''}`,
  },
  {
    key: 'repuestos',
    label: 'Esperando repuestos',
    build: c => `Hola ${c.nombre}, estamos a la espera de repuestos para tu ${vehiculo(c)}. Apenas lleguen, continuamos con la reparación y te avisamos.`,
  },
  {
    key: 'reparacion',
    label: 'En reparación',
    build: c => `Hola ${c.nombre}, ya estamos trabajando en la reparación de tu ${vehiculo(c)}. Te avisamos cuando esté lista.`,
  },
  {
    key: 'lista',
    label: 'Lista para entrega',
    build: c => `Hola ${c.nombre}, ¡buenas noticias! Tu ${vehiculo(c)} ya está lista para retirar (orden ${c.numero_orden}). Te esperamos en el taller. 🎉`,
  },
  {
    key: 'entregada',
    label: 'Entrega / factura',
    build: c => `Hola ${c.nombre}, gracias por confiar en nosotros. La factura de tu ${vehiculo(c)}${c.total ? ` por ${colones(c.total)}` : ''} está lista. ¡Que disfrutes tu vehiculo!`,
  },
];

// Mensaje sugerido según el estado actual de la orden.
const ESTADO_A_MENSAJE: Record<string, string> = {
  recepcion: 'recibida',
  diagnostico: 'diagnostico',
  esperando_aprobacion: 'aprobacion',
  esperando_repuestos: 'repuestos',
  en_reparacion: 'reparacion',
  lista_entrega: 'lista',
  entregada: 'entregada',
};

export function mensajeSugerido(estado?: string): string {
  return (estado && ESTADO_A_MENSAJE[estado]) || 'recibida';
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

// Mensaje contextual para una CITA del día (recordatorio / lista / seguimiento),
// según el estado de la cita (distinto del estado de la orden).
export function mensajeCita(c: any): string {
  const nombre = (c?.cliente_nombre || '').trim();
  const vehiculo = `${c?.marca || ''} ${c?.modelo || ''}`.trim() || 'tu vehiculo';
  if (c?.estado === 'listo') {
    return `Hola ${nombre}, ¡buenas noticias! Tu ${vehiculo} ya está lista para retirar${c?.numero_orden ? ` (orden ${c.numero_orden})` : ''}. Te esperamos en el taller. 🎉`;
  }
  if (c?.estado === 'en_revision' || c?.estado === 'en_mantenimiento') {
    return `Hola ${nombre}, te contamos sobre el avance de tu ${vehiculo} en el taller.`;
  }
  const hora = (c?.hora || '').slice(0, 5);
  return `Hola ${nombre} 👋, te recordamos tu cita${hora ? ` hoy a las ${hora}` : ''} para ${vehiculo}. ¿Nos confirmás tu asistencia? 🏍️`;
}
