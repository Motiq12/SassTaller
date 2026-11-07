import { NgModule } from '@angular/core';
import { MotoHistorialPageRoutingModule } from './moto-historial-routing.module';
import { MotoHistorialPage } from './moto-historial.page';
import { SharedModule } from '../../shared/shared.module';

@NgModule({
  imports: [SharedModule, MotoHistorialPageRoutingModule],
  declarations: [MotoHistorialPage],
})
export class MotoHistorialPageModule {}
