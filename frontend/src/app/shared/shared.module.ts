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

@NgModule({
  declarations: [EstadoLabelPipe, EstadoColorPipe, ChatContactosComponent, ChatHiloComponent, DosFaComponent, VolverWebComponent, EntregarOrdenComponent,
    MisSesionesComponent, MiActividadComponent, MiFirmaComponent, MisPreferenciasComponent, RecortarFotoComponent, PerfilListaComponent,
    ElegirServiciosComponent],
  imports: [CommonModule, FormsModule, IonicModule, RouterModule],
  exports: [
    CommonModule, FormsModule, IonicModule, EstadoLabelPipe, EstadoColorPipe,
    ChatContactosComponent, ChatHiloComponent, DosFaComponent, VolverWebComponent,
    MisSesionesComponent, MiActividadComponent, MiFirmaComponent, MisPreferenciasComponent, PerfilListaComponent,
    ElegirServiciosComponent,
  ],
})
export class SharedModule {}
