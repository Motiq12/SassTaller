import { NgModule } from '@angular/core';
import { RecepcionPageRoutingModule } from './recepcion-routing.module';
import { RecepcionTabsPage } from './recepcion-tabs.page';
import { RecepcionActionsComponent } from './recepcion-actions.component';
import { RecepcionPage } from './recepcion.page';
import { RecepcionAgendaPage } from './recepcion-agenda.page';
import { RecepcionOrdenesPage } from './recepcion-ordenes.page';
import { RecepcionCotizPage } from './recepcion-cotiz.page';
import { RecepcionMensajesPage } from './recepcion-mensajes.page';
import { RecepcionPerfilPage } from './recepcion-perfil.page';
import { SharedModule } from '../../shared/shared.module';

@NgModule({
  imports: [SharedModule, RecepcionPageRoutingModule],
  declarations: [
    RecepcionTabsPage,
    RecepcionActionsComponent,
    RecepcionPage,
    RecepcionAgendaPage,
    RecepcionOrdenesPage,
    RecepcionCotizPage,
    RecepcionMensajesPage,
    RecepcionPerfilPage,
  ],
})
export class RecepcionPageModule {}
