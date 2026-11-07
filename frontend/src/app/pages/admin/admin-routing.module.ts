import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { AdminShellPage } from './admin-shell.page';
import { AdminResumenPage } from './admin-resumen.page';
import { AdminCitasPage } from './admin-citas.page';
import { AdminEmpleadosPage } from './admin-empleados.page';
import { AdminRolesPage } from './admin-roles.page';
import { AdminTareasPage } from './admin-tareas.page';
import { AdminReportesPage } from './admin-reportes.page';
import { AdminOpinionesPage } from './admin-opiniones.page';
import { AdminPromosPage } from './admin-promos.page';
import { AdminCalendarioPage } from './admin-calendario.page';
import { AdminConfigPage } from './admin-config.page';
import { AdminServiciosPage } from './admin-servicios.page';
import { AdminMensajesPage } from './admin-mensajes.page';
import { AdminPerfilPage } from './admin-perfil.page';
import { AdminWebCatalogoPage } from './admin-web-catalogo.page';
import { AdminWebPromoPage } from './admin-web-promo.page';
import { AdminWebPublicarPage } from './admin-web-publicar.page';
import { AdminWebConsultasPage } from './admin-web-consultas.page';
import { AdminWebResenasPage } from './admin-web-resenas.page';
import { AdminWebInicioPage } from './admin-web-inicio.page';
import { AdminWebNegocioPage } from './admin-web-negocio.page';
import { AdminWebGaleriaPage } from './admin-web-galeria.page';
import { AdminWebOfertasPage } from './admin-web-ofertas.page';
import { AdminWebFaqPage } from './admin-web-faq.page';
import { AdminWebNosotrosPage } from './admin-web-nosotros.page';
import { AdminWebServiciosPage } from './admin-web-servicios.page';
import { PanelAdminGuard } from '../../guards/panel-admin.guard';

const routes: Routes = [
  {
    path: '',
    component: AdminShellPage,
    canActivateChild: [PanelAdminGuard],
    children: [
      { path: '', redirectTo: 'resumen', pathMatch: 'full' },
      { path: 'resumen', component: AdminResumenPage },
      { path: 'citas', component: AdminCitasPage },
      { path: 'empleados', component: AdminEmpleadosPage },
      { path: 'roles', component: AdminRolesPage },
      // Nueva cita u orden: el mismo flujo de recepción (buscar o registrar cliente y moto, y después agendar o abrir la orden).
      { path: 'recibir', loadChildren: () => import('../recepcion/recepcion-agendar.module').then(m => m.RecepcionAgendarPageModule) },
      { path: 'tareas', component: AdminTareasPage },
      { path: 'mensajes', component: AdminMensajesPage },
      { path: 'reportes', component: AdminReportesPage },
      { path: 'opiniones', component: AdminOpinionesPage },
      { path: 'promos', component: AdminPromosPage },
      { path: 'calendario', component: AdminCalendarioPage },
      { path: 'servicios', component: AdminServiciosPage },
      // Configuración va en partes (una por opción de la carpeta del menú).
      { path: 'config', redirectTo: 'config/taller', pathMatch: 'full' },
      { path: 'config/:seccion', component: AdminConfigPage },
      { path: 'perfil', component: AdminPerfilPage },
      // Operación: las mismas pantallas que usa recepción, pero dentro del panel
      // (con el menú lateral). Ver shared/ruta-panel.ts.
      // La lista de órdenes vive en Gestión de citas (pestaña Órdenes); la dirección vieja lleva ahí.
      { path: 'ordenes', redirectTo: 'citas', pathMatch: 'full' },
      { path: 'nueva-orden', loadChildren: () => import('../nueva-orden/nueva-orden.module').then(m => m.NuevaOrdenPageModule) },
      { path: 'detalle-orden/:id', loadChildren: () => import('../detalle-orden/detalle-orden.module').then(m => m.DetalleOrdenPageModule) },
      { path: 'factura/:id', loadChildren: () => import('../factura/factura.module').then(m => m.FacturaPageModule) },
      { path: 'clientes', loadChildren: () => import('../clientes/clientes.module').then(m => m.ClientesPageModule) },
      { path: 'cliente-detalle/:id', loadChildren: () => import('../cliente-detalle/cliente-detalle.module').then(m => m.ClienteDetallePageModule) },
      { path: 'cliente-form', loadChildren: () => import('../cliente-form/cliente-form.module').then(m => m.ClienteFormPageModule) },
      { path: 'cita-form', loadChildren: () => import('../cita-form/cita-form.module').then(m => m.CitaFormPageModule) },
      { path: 'cita-form/:id', loadChildren: () => import('../cita-form/cita-form.module').then(m => m.CitaFormPageModule) },
      { path: 'cliente-form/:id', loadChildren: () => import('../cliente-form/cliente-form.module').then(m => m.ClienteFormPageModule) },
      { path: 'moto-form', loadChildren: () => import('../moto-form/moto-form.module').then(m => m.MotoFormPageModule) },
      { path: 'moto-form/:id', loadChildren: () => import('../moto-form/moto-form.module').then(m => m.MotoFormPageModule) },
      { path: 'moto-historial/:id', loadChildren: () => import('../moto-historial/moto-historial.module').then(m => m.MotoHistorialPageModule) },
      { path: 'garantias', loadChildren: () => import('../garantias/garantias.module').then(m => m.GarantiasPageModule) },
      // Sitio web (msmotors-web): catálogo, promoción y publicar.
      { path: 'web', redirectTo: 'web/inicio', pathMatch: 'full' },
      { path: 'web/inicio', component: AdminWebInicioPage },
      { path: 'web/negocio', component: AdminWebNegocioPage },
      { path: 'web/catalogo', component: AdminWebCatalogoPage },
      { path: 'web/promo', component: AdminWebPromoPage },
      { path: 'web/publicar', component: AdminWebPublicarPage },
      { path: 'web/consultas', component: AdminWebConsultasPage },
      { path: 'web/galeria', component: AdminWebGaleriaPage },
      { path: 'web/ofertas', component: AdminWebOfertasPage },
      { path: 'web/resenas', component: AdminWebResenasPage },
      { path: 'web/preguntas', component: AdminWebFaqPage },
      { path: 'web/nosotros', component: AdminWebNosotrosPage },
      { path: 'web/servicios', component: AdminWebServiciosPage },
    ],
  },
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class AdminPageRoutingModule {}
