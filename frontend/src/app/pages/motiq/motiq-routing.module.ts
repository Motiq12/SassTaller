import { NgModule } from '@angular/core';
import { Routes, RouterModule } from '@angular/router';
import { MotiqGuard } from '../../guards/motiq.guard';
import { MotiqLoginPage } from './login/motiq-login.page';
import { MotiqPanelPage } from './panel/motiq-panel.page';

const routes: Routes = [
  { path: '', redirectTo: 'panel', pathMatch: 'full' },
  { path: 'login', component: MotiqLoginPage },
  { path: 'panel', canActivate: [MotiqGuard], component: MotiqPanelPage },
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class MotiqPageRoutingModule {}
