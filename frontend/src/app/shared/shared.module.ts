import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { EstadoLabelPipe, EstadoColorPipe } from './estado.pipe';
import { ChatContactosComponent } from './chat/chat-contactos.component';
import { ChatHiloComponent } from './chat/chat-hilo.component';
import { DosFaComponent } from './dosfa/dosfa.component';
import { MarcaLogoComponent } from './marca-logo.component';

@NgModule({
  declarations: [EstadoLabelPipe, EstadoColorPipe, ChatContactosComponent, ChatHiloComponent, DosFaComponent, MarcaLogoComponent],
  imports: [CommonModule, FormsModule, IonicModule],
  exports: [
    CommonModule, FormsModule, IonicModule, EstadoLabelPipe, EstadoColorPipe,
    ChatContactosComponent, ChatHiloComponent, DosFaComponent, MarcaLogoComponent,
  ],
})
export class SharedModule {}
