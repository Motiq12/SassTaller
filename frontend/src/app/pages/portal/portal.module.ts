import { NgModule } from '@angular/core';
import { PortalPageRoutingModule } from './portal-routing.module';
import { PortalLoginPage } from './portal-login.page';
import { PortalRegistroPage } from './portal-registro.page';
import { PortalBuscarTallerPage } from './portal-buscar-taller.page';
import { PortalRecuperarPage } from './portal-recuperar.page';
import { PortalTabsPage } from './portal-tabs.page';
import { PortalInicioPage } from './portal-inicio.page';
import { PortalAgendarPage } from './portal-agendar.page';
import { PortalCitasPage } from './portal-citas.page';
import { PortalMotosPage } from './portal-motos.page';
import { PortalOfertasPage } from './portal-ofertas.page';
import { PortalPerfilPage } from './portal-perfil.page';
import { PortalLegalPage } from './portal-legal.page';
import { PortalCitaDetallePage } from './portal-cita-detalle.page';
import { PortalMotoHistorialPage } from './portal-moto-historial.page';
import { PortalNotificacionesPage } from './portal-notificaciones.page';
import { PortalActionsComponent } from './portal-actions.component';
import { PortalOnboardingComponent } from './portal-onboarding.component';
import { AccesoMarcaComponent } from './acceso-marca.component';
import { GoogleBotonComponent } from './google-boton.component';
import { SharedModule } from '../../shared/shared.module';

@NgModule({
  imports: [SharedModule, PortalPageRoutingModule],
  declarations: [
    PortalLoginPage, PortalRegistroPage, PortalBuscarTallerPage, PortalRecuperarPage,
    PortalTabsPage, PortalInicioPage, PortalAgendarPage,
    PortalCitasPage, PortalMotosPage, PortalOfertasPage, PortalPerfilPage,
    PortalLegalPage, PortalCitaDetallePage, PortalMotoHistorialPage, PortalNotificacionesPage,
    PortalActionsComponent, PortalOnboardingComponent, AccesoMarcaComponent, GoogleBotonComponent,
  ],
})
export class PortalPageModule {}
