import { NgModule } from '@angular/core';
import { MotoFormPageRoutingModule } from './moto-form-routing.module';
import { MotoFormPage } from './moto-form.page';
import { SharedModule } from '../../shared/shared.module';

@NgModule({
  imports: [SharedModule, MotoFormPageRoutingModule],
  declarations: [MotoFormPage],
})
export class MotoFormPageModule {}
