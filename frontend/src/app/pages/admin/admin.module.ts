import { NgModule } from '@angular/core';
import { SharedModule } from '../../shared/shared.module';
import { AdminPageRoutingModule } from './admin-routing.module';
import { AdminShellPage } from './admin-shell.page';
import { AdminResumenPage } from './admin-resumen.page';
import { AdminCitasPage } from './admin-citas.page';
import { AdminEmpleadosPage } from './admin-empleados.page';
import { AdminRolesPage } from './admin-roles.page';
import { AdminTareasPage } from './admin-tareas.page';
import { AdminReportesPage } from './admin-reportes.page';
import { AdminOpinionesPage } from './admin-opiniones.page';
import { AdminPromosPage } from './admin-promos.page';
import { AdminCalendarioPage } from './admin-calendario.page';
import { AdminConfigPage } from './admin-config.page';
import { AdminServiciosPage } from './admin-servicios.page';
import { AdminMensajesPage } from './admin-mensajes.page';
import { AdminPerfilPage } from './admin-perfil.page';
import { AdminActionsComponent } from './admin-actions.component';
import { AdminWebCatalogoPage } from './admin-web-catalogo.page';
import { AdminWebPromoPage } from './admin-web-promo.page';
import { AdminWebPublicarPage } from './admin-web-publicar.page';
import { AdminWebConsultasPage } from './admin-web-consultas.page';
import { AdminWebResenasPage } from './admin-web-resenas.page';
import { AdminWebInicioPage } from './admin-web-inicio.page';
import { AdminWebNegocioPage } from './admin-web-negocio.page';
import { AdminWebGaleriaPage } from './admin-web-galeria.page';
import { AdminWebOfertasPage } from './admin-web-ofertas.page';
import { AdminWebFaqPage } from './admin-web-faq.page';
import { AdminWebNosotrosPage } from './admin-web-nosotros.page';
import { AdminWebServiciosPage } from './admin-web-servicios.page';

@NgModule({
  imports: [SharedModule, AdminPageRoutingModule],
  declarations: [
    AdminShellPage,
    AdminResumenPage,
    AdminCitasPage,
    AdminEmpleadosPage,
    AdminRolesPage,
    AdminTareasPage,
    AdminReportesPage,
    AdminOpinionesPage,
    AdminPromosPage,
    AdminCalendarioPage,
    AdminConfigPage,
    AdminServiciosPage,
    AdminMensajesPage,
    AdminPerfilPage,
    AdminActionsComponent,
    AdminWebCatalogoPage,
    AdminWebPromoPage,
    AdminWebPublicarPage,
    AdminWebConsultasPage,
    AdminWebResenasPage,
    AdminWebInicioPage,
    AdminWebNegocioPage,
    AdminWebGaleriaPage,
    AdminWebOfertasPage,
    AdminWebFaqPage,
    AdminWebNosotrosPage,
    AdminWebServiciosPage,
  ],
})
export class AdminPageModule {}
