import { Component, OnInit, inject } from '@angular/core';
import { Router } from '@angular/router';
import { MotiqService } from '../../services/motiq.service';
import { MarcaService } from '../../services/marca.service';
import { ToastService } from '../../services/toast.service';
import { PRODUCTO } from '../../shared/producto';

/**
 * La cara pública de Motiq: lo que ve alguien que llega sin saber qué es esto.
 *
 * Tiene DOS caminos a propósito, porque son dos ventas distintas:
 *
 *  · El taller de uno o dos mecánicos se registra solo. No va a hablar con nadie ni
 *    a esperar una llamada: si no puede probarlo en el momento, se va. Para ese está
 *    "Probá gratis", que lleva directo a /registro-taller.
 *
 *  · Un grupo con varias sucursales no se da de alta desde una página web. Decide
 *    por comité, pregunta por facturación, migración de datos y quién responde si
 *    algo falla. Para ese está el formulario: lo que deja acá cae en la bandeja del
 *    panel de Motiq y se cierra hablando.
 *
 * Es del PRODUCTO, no de ningún taller: acá manda la marca de Motiq (ver producto.ts).
 */
@Component({
  selector: 'app-landing',
  templateUrl: './landing.page.html',
  styleUrls: ['./landing.page.scss'],
  standalone: false,
})
export class LandingPage implements OnInit {
  private motiq = inject(MotiqService);
  private marca = inject(MarcaService);
  private toast = inject(ToastService);
  private router = inject(Router);

  producto = PRODUCTO;

  // Formulario de "hablá con nosotros"
  nombre = '';
  email = '';
  telefono = '';
  empresa = '';
  volumen = '';
  mensaje = '';
  enviando = false;
  enviado = false;
  error = '';

  readonly VOLUMENES = [
    { valor: '1-20', rotulo: 'Hasta 20 vehículos al mes' },
    { valor: '21-100', rotulo: 'Entre 20 y 100' },
    { valor: '100+', rotulo: 'Más de 100' },
    { valor: 'flota', rotulo: 'Manejamos flota propia' },
  ];

  ngOnInit() {
    // Puede quedar pintado el color de un taller de una sesión anterior en el mismo
    // navegador. Acá se muestra Motiq, no un cliente.
    this.marca.limpiar();
  }

  get formularioListo(): boolean {
    return !!this.nombre.trim() && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.email.trim());
  }

  probarGratis() {
    this.router.navigate(['/registro-taller']);
  }

  irA(id: string) {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
