import { NgModule } from '@angular/core';
import { VehiculoHistorialPageRoutingModule } from './vehiculo-historial-routing.module';
import { VehiculoHistorialPage } from './vehiculo-historial.page';
import { SharedModule } from '../../shared/shared.module';

@NgModule({
  imports: [SharedModule, VehiculoHistorialPageRoutingModule],
  declarations: [VehiculoHistorialPage],
})
export class VehiculoHistorialPageModule {}
