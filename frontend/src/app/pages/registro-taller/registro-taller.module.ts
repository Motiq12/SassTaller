import { NgModule } from '@angular/core';
import { RegistroTallerPageRoutingModule } from './registro-taller-routing.module';
import { RegistroTallerPage } from './registro-taller.page';
import { SharedModule } from '../../shared/shared.module';

@NgModule({
  imports: [SharedModule, RegistroTallerPageRoutingModule],
  declarations: [RegistroTallerPage],
})
export class RegistroTallerPageModule {}
