import { NgModule } from '@angular/core';
import { PortalPageRoutingModule } from './portal-routing.module';
import { PortalLoginPage } from './portal-login.page';
import { PortalRegistroPage } from './portal-registro.page';
import { PortalRecuperarPage } from './portal-recuperar.page';
import { PortalTabsPage } from './portal-tabs.page';
import { PortalInicioPage } from './portal-inicio.page';
import { PortalAgendarPage } from './portal-agendar.page';
import { PortalCitasPage } from './portal-citas.page';
import { PortalVehiculosPage } from './portal-vehiculos.page';
import { PortalOfertasPage } from './portal-ofertas.page';
import { PortalPerfilPage } from './portal-perfil.page';
import { PortalLegalPage } from './portal-legal.page';
import { PortalCitaDetallePage } from './portal-cita-detalle.page';
import { PortalVehiculoHistorialPage } from './portal-vehiculo-historial.page';
import { PortalNotificacionesPage } from './portal-notificaciones.page';
import { PortalActionsComponent } from './portal-actions.component';
import { PortalOnboardingComponent } from './portal-onboarding.component';
import { SharedModule } from '../../shared/shared.module';

@NgModule({
  imports: [SharedModule, PortalPageRoutingModule],
  declarations: [
    PortalLoginPage, PortalRegistroPage, PortalRecuperarPage,
    PortalTabsPage, PortalInicioPage, PortalAgendarPage,
    PortalCitasPage, PortalVehiculosPage, PortalOfertasPage, PortalPerfilPage,
    PortalLegalPage, PortalCitaDetallePage, PortalVehiculoHistorialPage, PortalNotificacionesPage,
    PortalActionsComponent, PortalOnboardingComponent,
  ],
})
export class PortalPageModule {}
