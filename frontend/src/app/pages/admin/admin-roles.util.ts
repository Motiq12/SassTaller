// Texto de la fila "Sitio web" en la pantalla de Roles: esas casillas se marcan por
// persona en Gestión de empleados (utils/permisos-web.js en el servidor).
export const PERMISOS_WEB_INFO: Record<string, string> = {
  admin: 'Todo',
  contenido: 'Lo que se le marque a cada persona en Gestión de empleados',
  recepcion: 'Nada, salvo lo que se le marque a cada persona (con el sitio encendido)',
  tecnico: 'Nada',
};
