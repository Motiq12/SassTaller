import { Component, inject } from '@angular/core';
import { MotiqService } from '../../../services/motiq.service';
import { ToastService } from '../../../services/toast.service';
import { PRODUCTO } from '../../../shared/producto';

/**
 * "Hablá con nosotros": el formulario de demo como un cupón para recortar (la
 * boleta que entrega un taller). Es el camino del grupo con varias sucursales, que
 * no se da de alta solo: lo que se deja acá cae en la bandeja del panel de Motiq.
 */
@Component({
  selector: 'lp-cupon',
  templateUrl: './cupon.component.html',
  styleUrls: ['./cupon.component.scss'],
  standalone: false,
})
export class CuponComponent {
  private motiq = inject(MotiqService);
  private toast = inject(ToastService);

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
        this.enviado = true;   // se reemplaza el formulario, no se limpia y ya
        this.toast.success(r.message, 4000);
      },
      error: (e) => {
        this.enviando = false;
        // El 429 no es un error del que escribe: ya mandó su mensaje. Decirle
        // "algo salió mal" lo haría reintentar para nada.
        if (e?.status === 429) {
          this.enviado = true;
          return;
        }
        this.error = e?.error?.error || 'No pudimos enviar tu mensaje. Probá de nuevo en un momento.';
      },
    });
  }
}
