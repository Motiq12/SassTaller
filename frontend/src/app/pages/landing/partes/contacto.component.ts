import { Component, ElementRef, EventEmitter, HostListener, Input, OnChanges, Output, ViewChild, inject } from '@angular/core';
import { MotiqService } from '../../../services/motiq.service';
import { ToastService } from '../../../services/toast.service';
import { PRODUCTO } from '../../../shared/producto';

/**
 * "Hablá con nosotros", como ventana sobre la página. Es el camino del grupo con
 * varias sucursales, que no se da de alta solo: lo que se deja acá cae en la bandeja
 * del panel de Motiq (MotiqService.pedirDemo).
 *
 * Escape o el fondo cierran; al abrir, el foco va al nombre; al cerrar, el formulario
 * se limpia cuando ya no se ve.
 */
@Component({
  selector: 'app-lp-contacto',
  templateUrl: './contacto.component.html',
  styleUrls: ['./contacto.component.scss'],
  standalone: false,
})
export class ContactoComponent implements OnChanges {
  private motiq = inject(MotiqService);
  private toast = inject(ToastService);

  @Input() abierto = false;
  @Output() cerrar = new EventEmitter<void>();
  @ViewChild('campoNombre') campoNombre?: ElementRef<HTMLInputElement>;

  readonly producto = PRODUCTO;
  readonly VOLUMENES = [
    { valor: '1-20', rotulo: 'Hasta 20 vehículos al mes' },
    { valor: '21-100', rotulo: 'Entre 20 y 100' },
    { valor: '100+', rotulo: 'Más de 100' },
    { valor: 'flota', rotulo: 'Manejamos flota propia' },
  ];

  nombre = '';
  email = '';
  telefono = '';
  empresa = '';
  volumen = '';
  mensaje = '';
  enviando = false;
  enviado = false;
  error = '';

  ngOnChanges() {
    if (this.abierto) setTimeout(() => this.campoNombre?.nativeElement.focus(), 120);
    else setTimeout(() => this.limpiar(), 350);
  }

  @HostListener('document:keydown.escape')
  alEscape() { if (this.abierto) this.cerrar.emit(); }

  /** "Gracias, Ana" si dejó el nombre; si no, "Gracias". */
  get gracias(): string {
    const primero = this.nombre.trim().split(/\s+/)[0];
    return primero ? `Gracias, ${primero}.` : 'Gracias.';
  }

  get formularioListo(): boolean {
    return !!this.nombre.trim() && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.email.trim());
  }

  enviar() {
    if (!this.formularioListo || this.enviando) return;
    this.enviando = true;
    this.error = '';
    this.motiq.pedirDemo({
      nombre: this.nombre.trim(),
      email: this.email.trim(),
      telefono: this.telefono.trim(),
      empresa: this.empresa.trim(),
      volumen: this.volumen,
      mensaje: this.mensaje.trim(),
      origen: 'landing',
    }).subscribe({
      next: (r) => {
        this.enviando = false;
        this.enviado = true;
        this.toast.success(r.message, 4000);
      },
      error: (e) => {
        this.enviando = false;
        // El 429 no es un error del que escribe: ya mandó su mensaje. Decirle
        // "algo salió mal" lo haría reintentar para nada.
        if (e?.status === 429) { this.enviado = true; return; }
        this.error = e?.error?.error || 'No pudimos enviar tu mensaje. Probá de nuevo en un momento.';
      },
    });
  }

  private limpiar() {
    if (this.abierto) return;
    this.nombre = this.email = this.telefono = this.empresa = this.volumen = this.mensaje = '';
    this.enviado = false;
    this.error = '';
  }
}
