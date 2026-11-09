// Términos de servicio y política de privacidad de MOTIQ, el SaaS. Son los que acepta
// un taller al registrarse y los que rigen motiq12.com.
//
// No confundir con los de pages/portal/portal-legal.page.ts: esos son los del portal de
// clientes de CADA taller (la relación entre un taller y sus clientes).
//
// ESTADO: borrador pendiente de revisión legal. Cada afirmación describe lo que el
// sistema hace hoy; si el producto cambia (planes, proveedores, seguridad), este texto
// cambia con él. Falta completar la razón social y la cédula jurídica del titular.

export interface Seccion { titulo: string; parrafos: string[]; }
export interface Documento {
  titulo: string;
  bajada: string;
  actualizado: string;
  secciones: Seccion[];
}

export const DOCUMENTOS: Record<'terminos' | 'privacidad', Documento> = {
  terminos: {
    titulo: 'Términos de servicio',
    bajada: 'Las reglas para usar Motiq: qué te damos, qué te pedimos y qué pasa con tu taller en cada plan.',
    actualizado: 'noviembre de 2026',
    secciones: [
      { titulo: 'Qué es Motiq', parrafos: [
        'Motiq es un sistema en la nube para administrar talleres de vehículos: órdenes de trabajo, clientes, vehículos, agenda, personal, sucursales y un portal para que los clientes del taller sigan sus servicios.',
        'Estos términos rigen el uso de Motiq por parte del taller que crea una cuenta (en adelante, «el taller») y de las personas que el taller invita a usarlo. Al registrar un taller, quien lo registra declara tener autoridad para aceptarlos en su nombre.',
      ] },
      { titulo: 'La cuenta del taller', parrafos: [
        'Quien registra el taller queda como su administrador. Es responsable de que los datos de la cuenta sean veraces, de cuidar sus credenciales y de las personas a las que da acceso.',
        'Cada persona usa su propia cuenta. Si sospechás que alguien entró con tus datos, cambiá la contraseña y avisanos.',
      ] },
      { titulo: 'Planes', parrafos: [
        'Prueba: 30 días con el sistema completo, sin tarjeta y sin cobro.',
        'Gratis: al terminar la prueba, el taller pasa solo a este plan. No se borra nada y no hay que hacer ningún trámite. Incluye órdenes, clientes, vehículos y citas sin límite, y el portal de clientes. Tiene una sucursal, hasta dos usuarios, reportes de los últimos 30 días y no permite aplicar la marca propia del taller.',
        'Pro: usuarios sin límite, varias sucursales, la marca propia del taller en el portal y soporte directo. Su precio y condiciones se acuerdan por escrito con cada taller.',
        'Motiq no hace cobros automáticos: ningún plan se cobra sin un acuerdo previo con el taller.',
      ] },
      { titulo: 'Uso aceptable', parrafos: [
        'El taller se compromete a usar Motiq para administrar su negocio de forma lícita. No se permite intentar acceder a datos de otros talleres, interferir con el funcionamiento del servicio, automatizar el uso de forma abusiva ni cargar contenido ilegal o datos de personas sin una base legal para tratarlos.',
      ] },
      { titulo: 'Los datos del taller son del taller', parrafos: [
        'Los datos que el taller carga (sus clientes, vehículos, órdenes y citas) son del taller. Motiq los trata solo para prestar el servicio, por cuenta del taller, y no los vende ni los usa para publicidad.',
        'El taller puede pedir una copia de sus datos o su eliminación en cualquier momento. El detalle está en la Política de privacidad.',
      ] },
      { titulo: 'Disponibilidad del servicio', parrafos: [
        'Trabajamos para que Motiq esté disponible siempre, pero no podemos garantizar que funcione sin interrupciones ni errores: puede haber mantenimientos, fallas de los proveedores de infraestructura o causas fuera de nuestro control. Cuando un mantenimiento sea previsible, avisaremos con anticipación.',
      ] },
      { titulo: 'Responsabilidad', parrafos: [
        'Motiq se ofrece «tal como está». En la medida que lo permita la ley, Motiq no responde por daños indirectos, lucro cesante ni pérdida de datos causados por el uso o la imposibilidad de usar el servicio. Nada de esto limita los derechos que la ley costarricense le reconoce al taller y que no pueden renunciarse.',
      ] },
      { titulo: 'Baja y suspensión', parrafos: [
        'El taller puede dejar de usar Motiq cuando quiera y pedir que se eliminen su cuenta y sus datos.',
        'Motiq puede suspender o cerrar una cuenta que incumpla estos términos, avisando antes al taller salvo que el incumplimiento ponga en riesgo a otros talleres o al servicio.',
      ] },
      { titulo: 'Cambios en estos términos', parrafos: [
        'Si cambiamos estos términos, publicaremos la versión nueva en esta página con su fecha. Si el cambio es importante, se lo avisaremos a los administradores de los talleres antes de que entre en vigencia.',
      ] },
      { titulo: 'Ley aplicable', parrafos: [
        'Estos términos se rigen por las leyes de la República de Costa Rica.',
      ] },
      { titulo: 'Contacto', parrafos: [
        'Para cualquier consulta sobre estos términos, escribinos desde el formulario de contacto de motiq12.com.',
      ] },
    ],
  },

  privacidad: {
    titulo: 'Política de privacidad',
    bajada: 'Qué datos tratamos, para qué, con quién los compartimos y cómo podés ejercer tus derechos.',
    actualizado: 'noviembre de 2026',
    secciones: [
      { titulo: 'A quién aplica', parrafos: [
        'Esta política explica cómo Motiq trata los datos personales de quienes visitan motiq12.com, de los talleres que usan Motiq y de las personas que trabajan en ellos.',
        'Los datos de los clientes de cada taller (sus nombres, contactos, vehículos y servicios) los carga y decide el taller. Sobre esos datos, Motiq actúa por cuenta del taller y solo para prestarle el servicio. Cada taller tiene además su propia política para sus clientes, visible en su portal.',
        'Se aplica la Ley de Protección de la Persona frente al Tratamiento de sus Datos Personales de Costa Rica (Ley 8968) y su reglamento.',
      ] },
      { titulo: 'Qué datos tratamos', parrafos: [
        'De la cuenta: nombre, correo y contraseña de cada usuario. La contraseña se guarda cifrada y nadie, ni siquiera Motiq, puede leerla.',
        'Del taller: nombre, identificador, teléfono, dirección, tipos de vehículo que atiende y la configuración que elija.',
        'De la operación: lo que el taller registra al trabajar, como clientes, vehículos, órdenes, presupuestos, citas y fotos de garantía.',
        'Del formulario de contacto: nombre, correo, teléfono, empresa y el mensaje que nos escribís.',
        'Técnicos: tiempos de carga de las páginas (por ejemplo, cuánto tarda en aparecer la portada), con la dirección de la página y si es un teléfono. No incluyen tu nombre, tu correo ni datos de tu cuenta. Para frenar abusos, la dirección IP se usa de forma temporal en memoria y no se guarda.',
      ] },
      { titulo: 'Para qué los usamos', parrafos: [
        'Para crear y mantener las cuentas, prestar el servicio, enviar los correos que el sistema necesita (códigos de verificación y de recuperación de contraseña, recordatorios de citas y avisos del estado de las órdenes a los clientes del taller, y avisos sobre el plan del taller), responder consultas, proteger el servicio contra abusos y medir su velocidad para mejorarla.',
        'No vendemos datos, no los usamos para publicidad y no los compartimos con anunciantes.',
      ] },
      { titulo: 'Con quién los compartimos', parrafos: [
        'Solo con los proveedores que hacen falta para que Motiq funcione:',
        'Railway: alojamiento de la aplicación y de la base de datos.',
        'Resend: envío de correos.',
        'Cloudflare: gestión del dominio y verificación de que quien pide un código es una persona.',
        'Google Fonts: las tipografías de la interfaz. Al cargarlas, tu navegador se conecta con Google.',
        'Además, podemos entregar datos cuando una autoridad competente lo exija conforme a la ley.',
      ] },
      { titulo: 'Dónde se guardan', parrafos: [
        'Los proveedores de infraestructura pueden tener sus servidores fuera de Costa Rica, incluso en Estados Unidos. Al usar Motiq, los datos se transfieren a esos servidores, con las medidas de seguridad descritas abajo.',
      ] },
      { titulo: 'Cómo los protegemos', parrafos: [
        'Las conexiones van cifradas (HTTPS). Las contraseñas se guardan con un cifrado de una sola vía. Los datos de cada taller están separados de los de los demás, y el sistema verifica en cada consulta que solo se lean los del taller de quien la hace.',
        'El personal de los talleres puede activar la verificación en dos pasos, y los intentos de ingreso repetidos se frenan automáticamente.',
        'Ningún sistema es infalible. Si ocurriera un incidente que afecte tus datos, te lo comunicaremos y se lo informaremos a la autoridad como lo pide la ley.',
      ] },
      { titulo: 'Cuánto tiempo los conservamos', parrafos: [
        'Mientras la cuenta del taller exista. Cuando termina la prueba, los datos no se borran: el taller sigue en el plan Gratis.',
        'Si el taller pide la eliminación, borramos su cuenta y sus datos, salvo lo que una ley nos obligue a conservar.',
      ] },
      { titulo: 'Tus derechos', parrafos: [
        'Podés pedir acceso a tus datos, corregirlos, eliminarlos u oponerte a su uso. Escribinos desde el formulario de contacto de motiq12.com y te respondemos en los plazos que fija la Ley 8968.',
        'Si sos cliente de un taller y tu pedido es sobre los datos que ese taller cargó, podés hacerlo directamente con el taller o con nosotros, y lo coordinamos.',
        'También podés presentar un reclamo ante la Agencia de Protección de Datos de los Habitantes (PRODHAB).',
      ] },
      { titulo: 'Almacenamiento en tu navegador', parrafos: [
        'Motiq guarda en tu navegador la sesión iniciada y el taller al que pertenecés, para no pedirte que entres cada vez. No usamos cookies de publicidad ni de seguimiento. La verificación de Cloudflare puede usar sus propias cookies técnicas.',
      ] },
      { titulo: 'Menores de edad', parrafos: [
        'Motiq es un servicio para negocios y no está dirigido a menores de edad.',
      ] },
      { titulo: 'Cambios en esta política', parrafos: [
        'Si cambiamos esta política, publicaremos la versión nueva en esta página con su fecha y avisaremos a los administradores de los talleres si el cambio es importante.',
      ] },
      { titulo: 'Contacto', parrafos: [
        'Para consultas sobre privacidad o para ejercer tus derechos, escribinos desde el formulario de contacto de motiq12.com.',
      ] },
    ],
  },
};
