import { NgModule } from '@angular/core';
import { Routes, RouterModule } from '@angular/router';

import { MotoFormPage } from './moto-form.page';

const routes: Routes = [
  {
    path: '',
    component: MotoFormPage
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class MotoFormPageRoutingModule {}
