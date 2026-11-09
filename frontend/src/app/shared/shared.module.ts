import { CuentaFranjaComponent } from './cuenta-franja.component';
import { ArranqueComponent } from './arranque.component';
import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { RouterModule } from '@angular/router';
import { EstadoLabelPipe, EstadoColorPipe } from './estado.pipe';
import { ChatContactosComponent } from './chat/chat-contactos.component';
import { ChatHiloComponent } from './chat/chat-hilo.component';
import { DosFaComponent } from './dosfa/dosfa.component';
import { VolverWebComponent } from './volver-web.component';
import { EntregarOrdenComponent } from './entregar-orden/entregar-orden.component';
import { MisSesionesComponent } from './perfil/mis-sesiones.component';
import { MiActividadComponent } from './perfil/mi-actividad.component';
import { MiFirmaComponent } from './perfil/mi-firma.component';
import { MisPreferenciasComponent } from './perfil/mis-preferencias.component';
import { RecortarFotoComponent } from './perfil/recortar-foto.component';
import { PerfilListaComponent } from './perfil/perfil-lista.component';
import { ElegirServiciosComponent } from './elegir-servicios.component';
// Pinta el logo del taller (o sus iniciales si no cargó ninguno). Lo usan el panel
// y el portal, que son de CADA taller, así que no puede ser un <img> a un archivo.
import { MarcaLogoComponent } from './marca-logo.component';

@NgModule({
  declarations: [CuentaFranjaComponent, ArranqueComponent, EstadoLabelPipe, EstadoColorPipe, ChatContactosComponent, ChatHiloComponent, DosFaComponent, VolverWebComponent, EntregarOrdenComponent,
    MisSesionesComponent, MiActividadComponent, MiFirmaComponent, MisPreferenciasComponent, RecortarFotoComponent, PerfilListaComponent,
    ElegirServiciosComponent],
  imports: [CommonModule, FormsModule, IonicModule, RouterModule, MarcaLogoComponent],
  exports: [CuentaFranjaComponent, ArranqueComponent, 
    CommonModule, FormsModule, IonicModule, EstadoLabelPipe, EstadoColorPipe,
    ChatContactosComponent, ChatHiloComponent, DosFaComponent, VolverWebComponent,
    MisSesionesComponent, MiActividadComponent, MiFirmaComponent, MisPreferenciasComponent, PerfilListaComponent, MarcaLogoComponent,
    ElegirServiciosComponent,
  ],
})
export class SharedModule {}
