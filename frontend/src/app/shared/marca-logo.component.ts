import { Component, Input, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MarcaService } from '../services/marca.service';
import { TallerService } from '../services/taller.service';
import { PRODUCTO } from './producto';

/**
 * Logo del taller, con sus iniciales como respaldo.
 *
 * Reemplaza a los `<img src="assets/logo/ms-*.png">` que estaban repartidos por la
 * app: eso mostraba la marca del taller original a todos los talleres del SaaS.
 *
 * Cuando el taller no cargó logo se pintan sus iniciales sobre su color de marca,
 * en vez de un logo genérico. Una imagen de relleno se lee como un error de carga;
 * las iniciales se leen como una decisión, y funcionan para cualquier empresa.
 */
@Component({
  selector: 'app-marca-logo',
  // Standalone, y no declarado en SharedModule: también lo necesita el menú del
  // portal, que vive en AppModule. Importar SharedModule entero allá habría metido
  // el chat, el 2FA y el recorte de fotos en el bundle de arranque por un logo.
  standalone: true,
  imports: [CommonModule],
  template: `
    <!-- Orden: el logo del taller manda; si no hay taller resuelto se muestra el de
         Motiq (estamos en su puerta); y si tampoco carga, las iniciales. -->
    <img *ngIf="src as url" [src]="url" [alt]="rotulo" class="marca-img"
         [style.height.px]="tamano" [style.width.px]="tamano" (error)="falloImagen = true" />
    <span *ngIf="!src" class="marca-iniciales"
          [style.height.px]="tamano" [style.width.px]="tamano"
          [style.font-size.px]="tamano * 0.4"
          [attr.aria-label]="rotulo">{{ marca.iniciales }}</span>
  `,
  styles: [`
    :host { display: inline-flex; align-items: center; }
    .marca-img {
      object-fit: contain;
      border-radius: 8px;
      background: #fff;
      padding: 6%;
      box-sizing: border-box;
    }
    .marca-iniciales {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: 8px;
      font-weight: 700;
      letter-spacing: .02em;
      line-height: 1;
      // Degradé y no un color plano: --ion-color-primary-shade ya sigue al color que
      // elija cada taller (lo calcula MarcaService.pintarColor), así que esto no
      // rompe con ningún color propio — solo le suma algo de relieve al que quedaba
      // chato pegado al fondo oscuro del menú.
      background: linear-gradient(135deg, var(--ion-color-primary), var(--ion-color-primary-shade));
      color: var(--ion-color-primary-contrast);
      box-shadow: 0 1px 4px rgba(0, 0, 0, .35), inset 0 1px 0 rgba(255, 255, 255, .12);
    }
  `],
})
export class MarcaLogoComponent {
  marca = inject(MarcaService);
  private taller = inject(TallerService);

  /** Lado en píxeles. Cuadrado a propósito: sirve igual para un isotipo o iniciales. */
  @Input() tamano = 36;

  // Si el archivo del logo no carga (todavía no lo subieron, ruta mal), se cae a
  // las iniciales en vez de dejar el ícono roto del navegador.
  falloImagen = false;

  get rotulo(): string { return this.marca.rotuloPublico; }

  /** Logo a mostrar, o null para que se pinten las iniciales. */
  get src(): string | null {
    if (this.falloImagen) return null;
    const delTaller = this.marca.actual.logo;
    if (delTaller) return delTaller;
    // Sin taller resuelto estamos en una pantalla de Motiq: va su isotipo.
    return this.taller.actual() ? null : PRODUCTO.logo;
  }
}
