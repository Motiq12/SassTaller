import { HttpClient } from '@angular/common/http';
import { firstValueFrom, timeout } from 'rxjs';
import { environment } from '../environments/environment';

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
export const sitioWeb = { activo: false };

export function cargarEstadoSitioWeb(http: HttpClient): () => Promise<void> {
  return () =>
    firstValueFrom(http.get<{ data: { activo: boolean } }>(`${environment.apiUrl}/sitio/estado`).pipe(timeout(5000)))
      .then(r => { sitioWeb.activo = r?.data?.activo === true; })
      .catch(() => { sitioWeb.activo = false; });
}
