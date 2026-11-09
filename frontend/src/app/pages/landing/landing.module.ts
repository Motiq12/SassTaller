import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { LandingPage } from './landing.page';
import { SharedModule } from '../../shared/shared.module';
import { ApareceDirective } from './partes/aparece.directive';
import { HeroComponent } from './partes/hero.component';
import { PantallaComponent } from './partes/pantalla.component';
import { VitrinaComponent } from './partes/vitrina.component';
import { EtapasComponent } from './partes/etapas.component';
import { AdaptaComponent } from './partes/adapta.component';
import { PreciosComponent } from './partes/precios.component';
import { CuponComponent } from './partes/cupon.component';
import { PieComponent } from './partes/pie.component';

const routes: Routes = [{ path: '', component: LandingPage }];

@NgModule({
  imports: [SharedModule, RouterModule.forChild(routes)],
  declarations: [
    LandingPage,
    ApareceDirective,
    HeroComponent,
    PantallaComponent,
    VitrinaComponent,
    EtapasComponent,
    AdaptaComponent,
    PreciosComponent,
    CuponComponent,
    PieComponent,
  ],
})
export class LandingPageModule {}
