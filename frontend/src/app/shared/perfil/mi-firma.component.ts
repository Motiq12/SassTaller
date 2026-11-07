import { Component, ElementRef, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { ToastController } from '@ionic/angular';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { MiPerfilService } from '../../services/mi-perfil.service';

// Tamaño interno del lienzo: fijo, para que la firma guardada pese lo mismo en
// cualquier pantalla (PNG transparente de ~10-30 KB).
const ANCHO = 900;
const ALTO = 300;

// Firma de la persona, dibujada con el dedo o el mouse. Sale en las facturas que emite.
@Component({
  standalone: false,
  selector: 'app-mi-firma',
  template: `
    <div class="px">
      <div class="px-titulo">
        <ion-icon name="pencil-outline"></ion-icon>
        <div><strong>Mi firma</strong><span>Sale en las facturas que emitís.</span></div>
      </div>

      <p class="px-vacio" *ngIf="cargando">Cargando…</p>

      <ng-container *ngIf="!cargando && !editando">
        <div class="firma-vista" *ngIf="firma; else sinFirma"><img [src]="firma" alt="Tu firma"></div>
        <ng-template #sinFirma><p class="px-vacio">Todavía no guardaste tu firma.</p></ng-template>
        <div class="px-acciones">
          <button type="button" class="px-btn" (click)="empezar()"><ion-icon name="create-outline"></ion-icon> {{ firma ? 'Cambiar firma' : 'Dibujar mi firma' }}</button>
          <button type="button" class="px-btn peligro" *ngIf="firma" (click)="borrar()" [disabled]="guardando">Borrar</button>
        </div>
      </ng-container>

      <div [hidden]="!editando">
        <div class="firma-papel">
          <canvas #lienzo [attr.width]="ancho" [attr.height]="alto" aria-label="Espacio para firmar"
                  (pointerdown)="bajar($event)" (pointermove)="mover($event)" (pointerup)="subir($event)" (pointercancel)="subir($event)"></canvas>
          <span class="firma-linea" aria-hidden="true"></span>
          <span class="firma-pista" *ngIf="vacio">Firmá acá con el dedo o el mouse</span>
        </div>
        <div class="px-acciones">
          <button type="button" class="px-btn" (click)="limpiar()" [disabled]="vacio">Limpiar</button>
          <button type="button" class="px-btn" (click)="editando = false">Cancelar</button>
          <button type="button" class="px-btn primario" (click)="guardar()" [disabled]="vacio || guardando">{{ guardando ? 'Guardando…' : 'Guardar firma' }}</button>
        </div>
      </div>
    </div>
  `,
  styleUrls: ['./perfil-extra.scss'],
  styles: [`
    /* Papel blanco en los dos temas: la firma se imprime en tinta oscura. */
    .firma-vista, .firma-papel { position: relative; background: #fff; border: 1px solid var(--hairline); border-radius: 4px; }
    .firma-vista { padding: 8px 12px; text-align: center; }
    .firma-vista img { max-width: 100%; max-height: 110px; }
    .firma-papel canvas { display: block; width: 100%; height: auto; aspect-ratio: 3 / 1; touch-action: none; cursor: crosshair; position: relative; z-index: 1; }
    .firma-linea { position: absolute; left: 8%; right: 8%; bottom: 24%; border-bottom: 1px dashed #c3c8d0; }
    .firma-pista { position: absolute; left: 0; right: 0; bottom: 8%; text-align: center; font-size: 12px; color: #8a93a0; pointer-events: none; }
  `],
})
export class MiFirmaComponent implements OnInit, OnDestroy {
  @ViewChild('lienzo', { static: true }) lienzo!: ElementRef<HTMLCanvasElement>;
  private destroy$ = new Subject<void>();
  readonly ancho = ANCHO;
  readonly alto = ALTO;
  firma: string | null = null;
  cargando = true;
  editando = false;
  guardando = false;
  vacio = true;
  private dibujando = false;
  private ultimo: { x: number; y: number } | null = null;

  constructor(private perfil: MiPerfilService, private toast: ToastController) {}

  ngOnInit() {
    this.perfil.get().pipe(takeUntil(this.destroy$)).subscribe({
      next: r => { this.firma = r.data.firma; this.cargando = false; },
      error: () => { this.cargando = false; },
    });
  }
  ngOnDestroy() { this.destroy$.next(); this.destroy$.complete(); }

  empezar() { this.limpiar(); this.editando = true; }

  limpiar() {
    const ctx = this.lienzo.nativeElement.getContext('2d');
    ctx?.clearRect(0, 0, ANCHO, ALTO);
    this.vacio = true;
  }

  // Del punto de la pantalla al del lienzo (que se muestra achicado).
  private punto(ev: PointerEvent) {
    const r = this.lienzo.nativeElement.getBoundingClientRect();
    return { x: (ev.clientX - r.left) * (ANCHO / r.width), y: (ev.clientY - r.top) * (ALTO / r.height) };
  }

  bajar(ev: PointerEvent) {
    ev.preventDefault();
    this.lienzo.nativeElement.setPointerCapture(ev.pointerId);
    this.dibujando = true;
    this.ultimo = this.punto(ev);
    this.trazar(this.ultimo, this.ultimo);
  }

  mover(ev: PointerEvent) {
    if (!this.dibujando || !this.ultimo) return;
    const p = this.punto(ev);
    this.trazar(this.ultimo, p);
    this.ultimo = p;
  }

  subir(_ev: PointerEvent) { this.dibujando = false; this.ultimo = null; }

  private trazar(a: { x: number; y: number }, b: { x: number; y: number }) {
    const ctx = this.lienzo.nativeElement.getContext('2d');
    if (!ctx) return;
    ctx.strokeStyle = '#141a26';
    ctx.lineWidth = 4.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x + 0.01, b.y + 0.01);
    ctx.stroke();
    this.vacio = false;
  }

  guardar() {
    if (this.vacio) return;
    this.enviar(this.lienzo.nativeElement.toDataURL('image/png'));
  }

  borrar() { this.enviar(null); }

  private enviar(firma: string | null) {
    this.guardando = true;
    this.perfil.guardarFirma(firma).pipe(takeUntil(this.destroy$)).subscribe({
      next: r => { this.guardando = false; this.firma = r.data.firma; this.editando = false; this.aviso(r.message); },
      error: e => { this.guardando = false; this.aviso(e.error?.error || 'No se pudo guardar', 'danger'); },
    });
  }

  private async aviso(message: string, color = 'success') {
    const t = await this.toast.create({ message, duration: 1800, color });
    await t.present();
  }
}
