// Textos legales del portal de clientes, los de fábrica. Revisar con asesoría legal
// antes de considerarlos definitivos.
//
// Las secciones de "Términos y condiciones" las puede reescribir el taller en
// Configuración → Textos del portal (backend/src/utils/textos-portal.js); la política
// de privacidad no, porque la pide la Ley 8968 (su contacto sale de Configuración).

export interface Seccion { titulo: string; parrafos: string[]; }
export interface Documento { titulo: string; actualizado: string; secciones: Seccion[]; }

export const DOCS_LEGALES: Record<string, Documento> = {
  terminos: {
    titulo: 'Términos y condiciones',
    actualizado: 'junio 2026',
    secciones: [
      { titulo: 'Aceptación de los términos', parrafos: [
        'Al crear una cuenta y usar el portal de MS Motos aceptas estos términos y condiciones. Si no estás de acuerdo, no utilices el servicio.',
      ] },
      { titulo: 'Servicios del taller', parrafos: [
        'MS Motos ofrece servicios de mantenimiento y reparación de motocicletas. La descripción de un trabajo, su alcance y su costo se confirman en el presupuesto de cada orden.',
      ] },
      { titulo: 'Citas y cancelaciones', parrafos: [
        'Puedes agendar, consultar y dar seguimiento a tus citas desde el portal, sujeto a la disponibilidad de horarios del taller.',
        'Si no puedes asistir, cancela o reprograma con anticipación para liberar el cupo a otros clientes.',
      ] },
      { titulo: 'Presupuestos y pagos', parrafos: [
        'Los trabajos que impliquen repuestos o mano de obra se informan mediante un presupuesto que debes aprobar antes de que el taller continúe.',
        'El monto final puede variar si, durante la reparación, se detectan trabajos adicionales; en ese caso se te informará para una nueva aprobación.',
      ] },
      { titulo: 'Garantía', parrafos: [
        'Los trabajos entregados pueden incluir una garantía cuya duración se indica al cierre de la orden. La garantía no cubre daños por mal uso, accidentes o intervención de terceros.',
      ] },
      { titulo: 'Responsabilidades del cliente', parrafos: [
        'Eres responsable de la veracidad de los datos de tu cuenta y de tus motocicletas. Mantén tu contraseña en un lugar seguro.',
      ] },
      { titulo: 'Cambios en los términos', parrafos: [
        'Podemos actualizar estos términos. Los cambios relevantes se reflejarán en esta misma sección con su fecha de actualización.',
      ] },
    ],
  },
  privacidad: {
    titulo: 'Política de privacidad',
    actualizado: 'octubre 2026',
    secciones: [
      { titulo: 'Datos que recopilamos', parrafos: [
        'Recopilamos los datos que nos brindas al registrarte y usar el portal: nombre, contacto (teléfono y correo), datos de tus motocicletas y el historial de citas y servicios.',
      ] },
      { titulo: 'Cómo usamos tus datos', parrafos: [
        'Usamos tus datos para gestionar tus citas y órdenes, comunicarte el avance de tus servicios, emitir presupuestos y mejorar la atención del taller.',
      ] },
      { titulo: 'Conservación de los datos', parrafos: [
        'Conservamos tu historial de servicios mientras tu cuenta esté activa y por el tiempo necesario para fines de garantía y obligaciones del taller.',
      ] },
      { titulo: 'Con quién compartimos', parrafos: [
        'No vendemos tus datos. Solo se comparten con el personal del taller que atiende tu servicio y con proveedores estrictamente necesarios para operar (por ejemplo, el envío de correos de recuperación de contraseña).',
      ] },
      { titulo: 'Tus derechos', parrafos: [
        'Puedes acceder y actualizar tus datos desde tu perfil. También puedes eliminar tu cuenta: se desactiva tu acceso al portal y tu historial queda únicamente en poder del taller para fines de garantía.',
        'Conforme a la Ley de Protección de la Persona frente al Tratamiento de sus Datos Personales (N.º 8968), puedes solicitar el acceso, la rectificación o la eliminación de tus datos.',
      ] },
      { titulo: 'Contacto', parrafos: [
        'Si tienes dudas sobre el manejo de tus datos o quieres ejercer tus derechos, acércate al mostrador de nuestras sucursales de Liberia o Cañas.',
      ] },
    ],
  },
};

// Una copia para modificar sin tocar la de fábrica.
export function copiaDocumento(clave: string): Documento {
  const d = DOCS_LEGALES[clave] || DOCS_LEGALES['terminos'];
  return { ...d, secciones: d.secciones.map(s => ({ titulo: s.titulo, parrafos: [...s.parrafos] })) };
}

// Una sección escrita por el taller (un texto con párrafos separados por una línea en
// blanco) como la muestra el portal.
export function seccionDeTexto(s: { titulo: string; texto: string }): Seccion {
  return { titulo: s.titulo, parrafos: s.texto.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean) };
}

// "octubre 2026" a partir de 'YYYY-MM-DD'.
export function mesYAnio(fecha: string): string {
  return new Date(`${fecha}T12:00:00Z`).toLocaleDateString('es-CR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}
