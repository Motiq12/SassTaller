import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { PrecargaPorRol } from './shared/precarga-por-rol';
import { AuthGuard } from './guards/auth.guard';
import { RolHomeGuard } from './guards/rol-home.guard';
import { RolGuard } from './guards/rol.guard';
import { PanelAdminGuard } from './guards/panel-admin.guard';

const routes: Routes = [
  { path: '', redirectTo: 'tabs', pathMatch: 'full' },
  // Login unificado (personal + clientes): vive en /portal/login. /login redirige ahí.
  { path: 'login', redirectTo: 'portal/login', pathMatch: 'full' },
    // Alta de un taller nuevo en el SaaS. Pública y sin guard a propósito: quien entra
  // acá todavía no tiene cuenta ni taller — crearlos es justamente lo que viene a hacer.
  {
    path: 'registro-taller',
    loadChildren: () => import('./pages/registro-taller/registro-taller.module').then(m => m.RegistroTallerPageModule),
  },
  // Panel de la plataforma. Va suelto, sin AuthGuard: no es un rol más dentro de un
  // taller sino una sesión aparte, con su propio token y su propio guard.
  {
    path: 'motiq',
    loadChildren: () => import('./pages/motiq/motiq.module').then(m => m.MotiqPageModule),
  },
{
    path: 'portal',
    loadChildren: () => import('./pages/portal/portal.module').then(m => m.PortalPageModule),
  },
  {
    path: 'tabs',
    canActivate: [AuthGuard, RolHomeGuard],
    loadChildren: () => import('./pages/tabs/tabs.module').then(m => m.TabsPageModule),
  },
  {
    path: 'mecanico',
    canActivate: [AuthGuard, RolGuard],
    data: { roles: ['tecnico', 'admin'] },
    loadChildren: () => import('./pages/mecanico/mecanico.module').then(m => m.MecanicoPageModule),
  },
  {
    path: 'recepcion',
    canActivate: [AuthGuard, RolGuard],
    data: { roles: ['recepcion', 'admin'] },
    loadChildren: () => import('./pages/recepcion/recepcion.module').then(m => m.RecepcionPageModule),
  },
  {
    // El panel es del admin, pero la sección "Sitio web" también la usan el rol
    // `contenido` y quien tenga permisos web (ver PanelAdminGuard).
    path: 'admin',
    canActivate: [AuthGuard, PanelAdminGuard],
    loadChildren: () => import('./pages/admin/admin.module').then(m => m.AdminPageModule),
  },
  {
    path: 'nueva-orden',
    canActivate: [AuthGuard, RolGuard],
    data: { roles: ['admin'] },
    loadChildren: () => import('./pages/nueva-orden/nueva-orden.module').then(m => m.NuevaOrdenPageModule),
  },
  {
    path: 'detalle-orden/:id',
    canActivate: [AuthGuard],
    loadChildren: () => import('./pages/detalle-orden/detalle-orden.module').then(m => m.DetalleOrdenPageModule),
  },
  {
    path: 'cliente-form',
    canActivate: [AuthGuard],
    loadChildren: () => import('./pages/cliente-form/cliente-form.module').then(m => m.ClienteFormPageModule),
  },
  {
    path: 'cliente-form/:id',
    canActivate: [AuthGuard],
    loadChildren: () => import('./pages/cliente-form/cliente-form.module').then(m => m.ClienteFormPageModule),
  },
  {
    path: 'cliente-detalle/:id',
    canActivate: [AuthGuard],
    loadChildren: () => import('./pages/cliente-detalle/cliente-detalle.module').then(m => m.ClienteDetallePageModule),
  },
  {
    path: 'moto-form',
    // Registrar y editar motos: mostrador y administración (el servidor también lo exige).
    canActivate: [AuthGuard, RolGuard],
    data: { roles: ['admin', 'recepcion'] },
    loadChildren: () => import('./pages/moto-form/moto-form.module').then(m => m.MotoFormPageModule),
  },
  {
    path: 'moto-form/:id',
    // Registrar y editar motos: mostrador y administración (el servidor también lo exige).
    canActivate: [AuthGuard, RolGuard],
    data: { roles: ['admin', 'recepcion'] },
    loadChildren: () => import('./pages/moto-form/moto-form.module').then(m => m.MotoFormPageModule),
  },
  {
    path: 'moto-historial/:id',
    canActivate: [AuthGuard],
    loadChildren: () => import('./pages/moto-historial/moto-historial.module').then(m => m.MotoHistorialPageModule),
  },
  {
    path: 'cita-form',
    canActivate: [AuthGuard, RolGuard],
    data: { roles: ['admin'] },
    loadChildren: () => import('./pages/cita-form/cita-form.module').then(m => m.CitaFormPageModule),
  },
  {
    path: 'cita-form/:id',
    canActivate: [AuthGuard, RolGuard],
    data: { roles: ['admin'] },
    loadChildren: () => import('./pages/cita-form/cita-form.module').then(m => m.CitaFormPageModule),
  },
  {
    path: 'garantias',
    canActivate: [AuthGuard, RolGuard],
    data: { roles: ['admin'] },
    loadChildren: () => import('./pages/garantias/garantias.module').then(m => m.GarantiasPageModule),
  },
  {
    path: 'factura/:id',
    canActivate: [AuthGuard, RolGuard],
    data: { roles: ['admin', 'recepcion'] },
    loadChildren: () => import('./pages/factura/factura.module').then(m => m.FacturaPageModule),
  },
  {
    path: 'promociones',
    canActivate: [AuthGuard, RolGuard],
    data: { roles: ['admin'] },
    loadChildren: () => import('./pages/promos/promos.module').then(m => m.PromosPageModule),
  },
];

@NgModule({
  // PrecargaPorRol en vez de PreloadAllModules: este descargaba los 83 chunks a todo
  // el mundo, incluido el cliente del portal, que nunca va a abrir el panel de
  // administración. Eran 825 KiB de JavaScript sin usar compitiendo con el pintado.
  imports: [RouterModule.forRoot(routes, { preloadingStrategy: PrecargaPorRol })],
  exports: [RouterModule],
})
export class AppRoutingModule {}
