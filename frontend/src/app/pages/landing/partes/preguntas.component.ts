import { Component, EventEmitter, Output } from '@angular/core';

interface Pregunta { q: string; a: string; }

/**
 * Preguntas frecuentes y el cierre con la acción final.
 *
 * Cada respuesta dice lo que el sistema hace hoy (revisado contra el código y contra
 * los términos). Si algo no está resuelto —la recuperación de contraseña del personal,
 * por ejemplo— no se promete acá.
 */
@Component({
  selector: 'app-lp-preguntas',
  templateUrl: './preguntas.component.html',
  styleUrls: ['./preguntas.component.scss'],
  standalone: false,
})
export class PreguntasComponent {
  @Output() hablar = new EventEmitter<void>();

  readonly preguntas: Pregunta[] = [
    { q: '¿Necesito tarjeta para probarlo?',
      a: 'No. Creás el taller con tu correo y una contraseña, y tenés 30 días con el sistema completo. No pedimos datos de pago.' },
    { q: '¿Qué pasa cuando terminan los 30 días?',
      a: 'Tu taller pasa solo al plan Gratis. No se borra nada, no hay cobros automáticos y seguís registrando órdenes, clientes y citas sin límite.' },
    { q: '¿Sirve para talleres de motos y de autos?',
      a: 'Sí. Al registrarte elegís qué atendés —motos, autos o los dos— y el catálogo de servicios y los datos de cada vehículo se arman según eso.' },
    { q: '¿Mis clientes tienen que instalar algo?',
      a: 'No. El portal se abre desde el navegador del celular con el enlace o el código QR que les compartís. Ahí siguen su vehículo, aprueban presupuestos y agendan citas.' },
    { q: '¿Lo puedo usar desde el celular?',
      a: 'Sí. Funciona en el navegador del celular, de la tablet o de la computadora. El mecánico puede trabajar desde su teléfono en el taller.' },
    { q: '¿Puedo pasar mis datos de otro sistema o de una hoja de Excel?',
      a: 'Escribinos y vemos tu caso. Para talleres con varias sedes armamos la migración con vos como parte del plan Pro.' },
    { q: '¿Mis datos están seguros?',
      a: 'Los datos de cada taller están separados de los demás, las conexiones van cifradas y las contraseñas se guardan con cifrado de una vía. Los detalles están en la Política de privacidad.' },
    { q: '¿Puedo irme y llevarme mis datos?',
      a: 'Sí. Podés pedir una copia de tus datos o que los borremos cuando quieras, desde el formulario de contacto.' },
  ];
}
