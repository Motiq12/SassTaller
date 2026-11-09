import { NgModule } from '@angular/core';
import { RouterModule } from '@angular/router';
import { SharedModule } from '../../shared/shared.module';
import { LegalPage } from './legal.page';

@NgModule({
  imports: [SharedModule, RouterModule.forChild([{ path: ':doc', component: LegalPage }, { path: '', redirectTo: 'terminos', pathMatch: 'full' }])],
  declarations: [LegalPage],
})
export class LegalPageModule {}
