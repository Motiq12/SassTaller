import { NgModule } from '@angular/core';
import { Routes, RouterModule } from '@angular/router';

import { RegistroTallerPage } from './registro-taller.page';

const routes: Routes = [
  {
    path: '',
    component: RegistroTallerPage,
  },
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class RegistroTallerPageRoutingModule {}
