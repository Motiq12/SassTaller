import { Component, Input, OnInit } from '@angular/core';
import { ModalController } from '@ionic/angular';

// Lado del recuadro en pantalla y de la foto que se guarda.
const VISTA = 280;
const SALIDA = 400;

// Recorte de la foto de perfil: se arrastra para encuadrar y se acerca con la barra
// (o la rueda del mouse). Devuelve un JPEG cuadrado de 400 px, o null si se cancela.
export async function recortarFoto(modal: ModalController, archivo: File): Promise<string | null> {
  const src = await new Promise<string>((ok, mal) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result));
    r.onerror = () => mal(r.error);
    r.readAsDataURL(archivo);
  });
  const m = await modal.create({ component: RecortarFotoComponent, componentProps: { src } });
  await m.present();
  const { data } = await m.onWillDismiss();
  return typeof data === 'string' ? data : null;
}

@Component({
  standalone: false,
  selector: 'app-recortar-foto',
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start"><ion-button (click)="cancelar()">Cancelar</ion-button></ion-buttons>
        <ion-title>Encuadrá tu foto</ion-title>
        <ion-buttons slot="end"><ion-button strong (click)="usar()" [disabled]="!lista">Usar</ion-button></ion-buttons>
      </ion-toolbar>
    </ion-header>
    <ion-content>
      <div class="rf">
        <div class="rf-vista" [style.width.px]="vista" [style.height.px]="vista"
             (pointerdown)="bajar($event)" (pointermove)="mover($event)" (pointerup)="subir()" (pointercancel)="subir()"
             (wheel)="rueda($event)">
          <img *ngIf="lista" [src]="src" alt="" draggable="false"
               [style.width.px]="ancho * escala" [style.height.px]="alto * escala"
               [style.transform]="'translate(' + x + 'px,' + y + 'px)'">
          <span class="rf-mascara" aria-hidden="true"></span>
        </div>
        <label class="rf-zoom">
          <ion-icon name="remove-outline"></ion-icon>
          <input type="range" min="1" max="4" step="0.01" [value]="zoom" (input)="acercar(+$any($event.target).value)" aria-label="Acercar">
          <ion-icon name="add-outline"></ion-icon>
        </label>
        <p class="rf-pista">Arrastrá la foto para encuadrarla.</p>
      </div>
    </ion-content>
  `,
  styles: [`
    .rf { display: flex; flex-direction: column; align-items: center; gap: 18px; padding: 24px 16px; }
    .rf-vista { position: relative; overflow: hidden; border-radius: 4px; background: #0b0d10; touch-action: none; cursor: grab; user-select: none; }
    .rf-vista:active { cursor: grabbing; }
    .rf-vista img { position: absolute; top: 0; left: 0; max-width: none; pointer-events: none; }
    /* Fuera del círculo se oscurece: así se ve en el avatar. */
    .rf-mascara { position: absolute; inset: 0; border-radius: 50%; box-shadow: 0 0 0 999px rgba(0, 0, 0, .55); outline: 2px solid rgba(255, 255, 255, .85); pointer-events: none; }
    .rf-zoom { display: flex; align-items: center; gap: 10px; width: 280px; max-width: 100%; color: var(--n-500); }
    .rf-zoom input { flex: 1; accent-color: var(--ion-color-primary); }
    .rf-pista { margin: 0; font-size: 12.5px; color: var(--n-500); }
  `],
})
export class RecortarFotoComponent implements OnInit {
  @Input() src = '';
  readonly vista = VISTA;
  private img = new Image();
  lista = false;
  ancho = 0;
  alto = 0;
  private base = 1;   // escala que cubre el recuadro con zoom 1
  zoom = 1;
  x = 0;
  y = 0;
  private arrastre: { px: number; py: number; x: number; y: number } | null = null;

  constructor(private modal: ModalController) {}

  get escala(): number { return this.base * this.zoom; }

  ngOnInit() {
    this.img.onload = () => {
      this.ancho = this.img.naturalWidth;
      this.alto = this.img.naturalHeight;
      this.base = VISTA / Math.min(this.ancho, this.alto);
      // Centrada.
      this.x = (VISTA - this.ancho * this.base) / 2;
      this.y = (VISTA - this.alto * this.base) / 2;
      this.lista = true;
    };
    this.img.src = this.src;
  }

  // La foto siempre tapa el recuadro entero.
  private limitar() {
    this.x = Math.min(0, Math.max(VISTA - this.ancho * this.escala, this.x));
    this.y = Math.min(0, Math.max(VISTA - this.alto * this.escala, this.y));
  }

  acercar(z: number) {
    const nuevo = Math.min(4, Math.max(1, z));
    // Acerca hacia el centro del recuadro.
    const cx = (VISTA / 2 - this.x) / this.escala;
    const cy = (VISTA / 2 - this.y) / this.escala;
    this.zoom = nuevo;
    this.x = VISTA / 2 - cx * this.escala;
    this.y = VISTA / 2 - cy * this.escala;
    this.limitar();
  }

  rueda(ev: WheelEvent) {
    ev.preventDefault();
    this.acercar(this.zoom - Math.sign(ev.deltaY) * 0.1);
  }

  bajar(ev: PointerEvent) {
    (ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId);
    this.arrastre = { px: ev.clientX, py: ev.clientY, x: this.x, y: this.y };
  }

  mover(ev: PointerEvent) {
    if (!this.arrastre) return;
    this.x = this.arrastre.x + ev.clientX - this.arrastre.px;
    this.y = this.arrastre.y + ev.clientY - this.arrastre.py;
    this.limitar();
  }

  subir() { this.arrastre = null; }

  cancelar() { this.modal.dismiss(null); }

  usar() {
    const c = document.createElement('canvas');
    c.width = SALIDA;
    c.height = SALIDA;
    const ctx = c.getContext('2d');
    if (!ctx) { this.modal.dismiss(null); return; }
    const lado = VISTA / this.escala;
    ctx.drawImage(this.img, -this.x / this.escala, -this.y / this.escala, lado, lado, 0, 0, SALIDA, SALIDA);
    this.modal.dismiss(c.toDataURL('image/jpeg', 0.85));
  }
}
