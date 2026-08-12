import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { LandingPage } from './landing.page';
import { SharedModule } from '../../shared/shared.module';

const routes: Routes = [{ path: '', component: LandingPage }];

@NgModule({
  imports: [SharedModule, RouterModule.forChild(routes)],
  declarations: [LandingPage],
})
export class LandingPageModule {}
