import { NgModule } from '@angular/core';
import { Routes, RouterModule } from '@angular/router';
import { RecepcionTabsPage } from './recepcion-tabs.page';
import { RecepcionPage } from './recepcion.page';
import { RecepcionAgendaPage } from './recepcion-agenda.page';
import { RecepcionOrdenesPage } from './recepcion-ordenes.page';
import { RecepcionCotizPage } from './recepcion-cotiz.page';
import { RecepcionMensajesPage } from './recepcion-mensajes.page';
import { RecepcionPerfilPage } from './recepcion-perfil.page';

const routes: Routes = [
  {
    path: '',
    component: RecepcionTabsPage,
    children: [
      { path: '', redirectTo: 'inicio', pathMatch: 'full' },
      { path: 'inicio', component: RecepcionPage },
      { path: 'agenda', component: RecepcionAgendaPage },
      { path: 'recibir', loadChildren: () => import('./recepcion-agendar.module').then(m => m.RecepcionAgendarPageModule) },
      { path: 'agendar', redirectTo: 'recibir', pathMatch: 'full' },
      { path: 'walkin', redirectTo: 'recibir', pathMatch: 'full' },
      { path: 'ordenes', component: RecepcionOrdenesPage },
      { path: 'cotizaciones', component: RecepcionCotizPage },
      { path: 'mensajes', component: RecepcionMensajesPage },
      // La misma pantalla de Clientes del panel (un solo diseño para todos).
      { path: 'clientes', loadChildren: () => import('../clientes/clientes.module').then(m => m.ClientesPageModule) },
      { path: 'perfil', component: RecepcionPerfilPage },
    ],
  },
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class RecepcionPageRoutingModule {}
