import { Component, EventEmitter, Input, Output, ViewEncapsulation } from '@angular/core';
import { GrupoPerfil } from './perfil-lista.base';

// Cabecera (foto, nombre, correo, chips) y lista de ajustes de Mi perfil, igual en
// los tres roles. La sección que se abre la pone cada página al lado (.pf-detalle).
// Sin encapsulación: perfil-lista.scss también da el marco de la página (.pf) y lo de
// adentro de las secciones; todo va bajo .pf, así que no se escapa a otras pantallas.
@Component({
  standalone: false,
  selector: 'app-perfil-lista',
  template: `
    <div class="pf-quien">
      <button type="button" class="pf-avatar" (click)="foto.emit()" [disabled]="subiendoFoto" [attr.aria-label]="fotoUrl ? 'Cambiar la foto' : 'Subir una foto'">
        <img *ngIf="fotoUrl; else ini" [src]="fotoUrl" alt="">
        <ng-template #ini>{{ iniciales }}</ng-template>
        <span class="pf-avatar-velo"><ion-icon [name]="subiendoFoto ? 'hourglass-outline' : 'camera-outline'"></ion-icon></span>
      </button>
      <h1>{{ nombre || 'Sin nombre' }}</h1>
      <span class="pf-correo" *ngIf="email"><ion-icon name="mail-outline"></ion-icon> {{ email }}</span>
      <div class="pf-chips" *ngIf="chips.length">
        <span class="pf-chip" *ngFor="let c of chips; let primero = first" [class.rol]="primero">{{ c }}</span>
      </div>
      <ng-content></ng-content>
    </div>

    <nav class="pf-grupos" aria-label="Secciones de Mi perfil">
      <section class="pf-grupo" *ngFor="let g of grupos">
        <h2>{{ g.titulo }}</h2>
        <button type="button" class="pf-fila" *ngFor="let i of g.items" (click)="abrir.emit(i.id)"
                [class.on]="vista === i.id" [attr.aria-current]="vista === i.id ? 'page' : null">
          <ion-icon [name]="i.icono" class="pf-fila-ico" aria-hidden="true"></ion-icon>
          <span class="pf-fila-txt">{{ i.nombre }}</span>
          <span class="pf-fila-valor" [class.ok]="estados[i.id] === 'ok'" [class.aviso]="estados[i.id] === 'aviso'">{{ valores[i.id] }}</span>
          <ion-icon name="chevron-forward" class="pf-fila-chev" aria-hidden="true"></ion-icon>
        </button>
      </section>
      <section class="pf-grupo">
        <button type="button" class="pf-fila salir" (click)="salir.emit()">
          <ion-icon name="log-out-outline" class="pf-fila-ico" aria-hidden="true"></ion-icon>
          <span class="pf-fila-txt">Cerrar sesión</span>
        </button>
      </section>
    </nav>
  `,
  styleUrls: ['./perfil-lista.scss'],
  encapsulation: ViewEncapsulation.None,
})
export class PerfilListaComponent {
  @Input() grupos: GrupoPerfil[] = [];
  @Input() vista: string | null = null;
  @Input() valores: Record<string, string> = {};
  @Input() estados: Record<string, string> = {};
  @Input() nombre = '';
  @Input() email = '';
  @Input() fotoUrl: string | null = null;
  @Input() iniciales = '';
  @Input() chips: string[] = [];
  @Input() subiendoFoto = false;
  @Output() abrir = new EventEmitter<string>();
  @Output() salir = new EventEmitter<void>();
  @Output() foto = new EventEmitter<void>();
}
