import { NgModule } from '@angular/core';
import { Routes, RouterModule } from '@angular/router';

import { MotoHistorialPage } from './moto-historial.page';

const routes: Routes = [
  {
    path: '',
    component: MotoHistorialPage
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class MotoHistorialPageRoutingModule {}
