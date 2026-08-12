import { NgModule } from '@angular/core';
import { Routes, RouterModule } from '@angular/router';

import { VehiculoFormPage } from './vehiculo-form.page';

const routes: Routes = [
  {
    path: '',
    component: VehiculoFormPage
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class VehiculoFormPageRoutingModule {}
