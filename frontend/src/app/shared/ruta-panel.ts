import { Router } from '@angular/router';

// Órdenes, clientes y garantías se abren dentro del panel de administración
// (/admin/..., con el menú lateral) cuando se llega desde ahí. Las mismas
// pantallas, abiertas por recepción o el mecánico, siguen en sus rutas de siempre
// (/detalle-orden/5, /cliente-detalle/3...). Antes el panel enlazaba a estas
// rutas sueltas y el admin perdía el menú.
export function enPanel(router: Router): boolean {
  return router.url.startsWith('/admin/');
}

// '/detalle-orden' → '/admin/detalle-orden' si se está en el panel.
export function rutaPanel(router: Router, ruta: string): string {
  return enPanel(router) ? '/admin' + ruta : ruta;
}
