import { NgModule } from '@angular/core';
import { RouterModule } from '@angular/router';
import { SharedModule } from '../../shared/shared.module';
import { RecepcionAgendarPage } from './recepcion-agendar.page';

// "Recibir cliente" / "Nueva cita": la misma pantalla para recepción y para el panel
// de administración, por eso va en un módulo aparte que cargan las dos rutas.
@NgModule({
  imports: [SharedModule, RouterModule.forChild([{ path: '', component: RecepcionAgendarPage }])],
  declarations: [RecepcionAgendarPage],
})
export class RecepcionAgendarPageModule {}
