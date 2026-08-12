import { NgModule } from '@angular/core';
import { Routes, RouterModule } from '@angular/router';

import { VehiculoHistorialPage } from './vehiculo-historial.page';

const routes: Routes = [
  {
    path: '',
    component: VehiculoHistorialPage
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class VehiculoHistorialPageRoutingModule {}
