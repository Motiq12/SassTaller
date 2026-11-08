/**
 * Identidad del PRODUCTO, distinta de la de cada taller.
 *
 * Son dos marcas que conviven y es fácil confundirlas:
 *
 *  · Motiq es el SaaS. Aparece donde se identifica al producto: la pestaña del
 *    navegador, la app instalada, y el registro de un taller nuevo — quien entra
 *    ahí todavía no pertenece a ningún taller, se está dando de alta en Motiq.
 *
 *  · La marca del taller (MarcaService) aparece en todo lo demás: su panel, su
 *    portal de clientes, sus comprobantes y sus correos. Ahí Motiq no pinta nada;
 *    el cliente final del taller no tiene por qué saber qué software usan.
 *
 * Si esta constante empieza a aparecer dentro del panel de un taller, algo se
 * mezcló: revisar si ese lugar no debería usar MarcaService.
 */
export const PRODUCTO = {
  nombre: 'Motiq',
  descripcion: 'Gestión de talleres',
  // Isotipo del producto. Es el mismo archivo que usan el favicon y el ícono de la
  // app instalada: un solo asset para toda la identidad de Motiq. Si falta, la
  // interfaz cae a las iniciales y no queda una imagen rota.
  logo: 'assets/logo/motiq-iso.png',
  // La misma marca en blanco sobre transparente, para fondos oscuros. El PNG de
  // arriba es azul marino sobre BLANCO: puesto en el menú o en la pantalla de
  // acceso se veía como un cuadro blanco recortado, no como un logo.
  logoClaro: 'assets/logo/motiq-iso-white.svg',
  // Azul marino del isotipo. Es el color por defecto de la app; cada taller lo
  // pisa con el suyo desde su configuración.
  color: '#1e3a5f',
};
