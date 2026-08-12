import { NgModule } from '@angular/core';
import { VehiculoFormPageRoutingModule } from './vehiculo-form-routing.module';
import { VehiculoFormPage } from './vehiculo-form.page';
import { SharedModule } from '../../shared/shared.module';

@NgModule({
  imports: [SharedModule, VehiculoFormPageRoutingModule],
  declarations: [VehiculoFormPage],
})
export class VehiculoFormPageModule {}
