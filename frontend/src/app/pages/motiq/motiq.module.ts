import { NgModule } from '@angular/core';
import { MotiqPageRoutingModule } from './motiq-routing.module';
import { MotiqLoginPage } from './login/motiq-login.page';
import { MotiqPanelPage } from './panel/motiq-panel.page';
import { SharedModule } from '../../shared/shared.module';

@NgModule({
  imports: [SharedModule, MotiqPageRoutingModule],
  declarations: [MotiqLoginPage, MotiqPanelPage],
})
export class MotiqPageModule {}
