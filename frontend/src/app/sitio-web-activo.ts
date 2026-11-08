import { HttpClient } from '@angular/common/http';

// El interruptor del sitio web, como lo ve el panel.
//
// El dueño pidió por ahora solo el sistema de citas (oct. 2026). Con el sitio
// web apagado se esconde todo lo suyo:
//   - la sección "Sitio web" del panel (y la guardia la cierra si se escribe la
//     dirección; la API también la rechaza);
//   - los enlaces "Volver al sitio web" del portal, del panel y de los perfiles;
//   - el rol "Contenido del sitio web" y los permisos del sitio en Empleados.
// No se borra nada: lo cargado sigue en la base.
//
// Lo encienden o apagan los desarrolladores con la variable SITIO_WEB_ACTIVO
// del sistema en Railway (ver backend/src/utils/sitio-estado.js): no hay
// interruptor en el panel. El estado lo da el servidor (/api/sitio/estado) y se
// lee al arrancar la app; si no responde, el sitio cuenta como apagado.
// En ESTE proyecto el sitio web público no existe: no se trajo desde MS Motos, así
// que la bandera queda apagada de forma definitiva y nadie le pregunta al servidor.
//
// Antes consultaba /api/sitio/estado. Esa ruta se fue con el sitio, así que la
// llamada terminaba en 404 y el interceptor de errores le mostraba un aviso rojo a
// quien abría el login, sin que nada estuviera mal de verdad.
//
// La bandera se conserva (en vez de borrarla y tocar los seis archivos que la leen)
// porque es la forma de que los menús y las guardias del panel sigan escondiendo lo
// del sitio sin cambiarles una línea.
export const sitioWeb = { activo: false };

export function cargarEstadoSitioWeb(_http: HttpClient): () => Promise<void> {
  return () => Promise.resolve();
}
