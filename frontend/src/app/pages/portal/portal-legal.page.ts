import { Component, DestroyRef, OnInit, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { MarcaService } from '../../services/marca.service';

interface Seccion { titulo: string; parrafos: string[]; }
interface Documento { titulo: string; actualizado: string; secciones: Seccion[]; }

@Component({
  standalone: false,
  selector: 'app-portal-legal',
  templateUrl: './portal-legal.page.html',
  styleUrls: ['./portal-legal.page.scss'],
})
export class PortalLegalPage implements OnInit {
  private route = inject(ActivatedRoute);
  private marca = inject(MarcaService);
  private destroyRef = inject(DestroyRef);

  doc: Documento | null = null;

  // Plantilla de los textos legales del portal de CADA taller: la relación entre el
  // taller y sus clientes. «{taller}» se reemplaza por el nombre del taller vigente
  // (antes decía «{taller}» a mano, y lo veían los clientes de todos los talleres).
  // Revisar con asesoría legal antes de considerarla definitiva. Los términos y la
  // privacidad de Motiq, el software, están en pages/legal/documentos.ts.
  private readonly DOCS: Record<string, Documento> = {
    terminos: {
      titulo: 'Términos y condiciones',
      actualizado: 'junio 2026',
      secciones: [
        { titulo: 'Aceptación de los términos', parrafos: [
          'Al crear una cuenta y usar el portal de {taller} aceptás estos términos y condiciones. Si no estás de acuerdo, no utilices el servicio.',
        ] },
        { titulo: 'Servicios del taller', parrafos: [
          '{taller} ofrece servicios de mantenimiento y reparación de vehículos. La descripción de un trabajo, su alcance y su costo se confirman en el presupuesto de cada orden.',
        ] },
        { titulo: 'Citas y cancelaciones', parrafos: [
          'Podés agendar, consultar y dar seguimiento a tus citas desde el portal, sujeto a la disponibilidad de horarios del taller.',
          'Si no podés asistir, cancelá o reprogramá con anticipación para liberar el cupo a otros clientes.',
        ] },
        { titulo: 'Presupuestos y pagos', parrafos: [
          'Los trabajos que impliquen repuestos o mano de obra se informan mediante un presupuesto que debés aprobar antes de que el taller continúe.',
          'El monto final puede variar si, durante la reparación, se detectan trabajos adicionales; en ese caso se te informará para una nueva aprobación.',
        ] },
        { titulo: 'Garantía', parrafos: [
          'Los trabajos entregados pueden incluir una garantía cuya duración se indica al cierre de la orden. La garantía no cubre daños por mal uso, accidentes o intervención de terceros.',
        ] },
        { titulo: 'Responsabilidades del cliente', parrafos: [
          'Sos responsable de la veracidad de los datos de tu cuenta y de tus vehículos. Mantené tu contraseña en un lugar seguro.',
        ] },
        { titulo: 'Cambios en los términos', parrafos: [
          'Podemos actualizar estos términos. Los cambios relevantes se reflejarán en esta misma sección con su fecha de actualización.',
        ] },
      ],
    },
    privacidad: {
      titulo: 'Política de privacidad',
      actualizado: 'junio 2026',
      secciones: [
        { titulo: 'Datos que recopilamos', parrafos: [
          'Recopilamos los datos que nos brindás al registrarte y usar el portal: nombre, contacto (teléfono y correo), datos de tus vehículos y el historial de citas y servicios.',
        ] },
        { titulo: 'Cómo usamos tus datos', parrafos: [
          'Usamos tus datos para gestionar tus citas y órdenes, comunicarte el avance de tus servicios, emitir presupuestos y mejorar la atención del taller.',
        ] },
        { titulo: 'Conservación de los datos', parrafos: [
          'Conservamos tu historial de servicios mientras tu cuenta esté activa y por el tiempo necesario para fines de garantía y obligaciones del taller.',
        ] },
        { titulo: 'El sistema que usamos', parrafos: [
          'Este portal funciona con Motiq, un sistema para talleres. Motiq guarda y procesa tus datos por cuenta de {taller} y solo para prestar este servicio; su política está en motiq12.com/legal/privacidad.',
        ] },
        { titulo: 'Con quién compartimos', parrafos: [
          'No vendemos tus datos. Solo se comparten con el personal del taller que atiende tu servicio y con proveedores estrictamente necesarios para operar (por ejemplo, el envío de correos de recuperación de contraseña).',
        ] },
        { titulo: 'Tus derechos', parrafos: [
          'Podés acceder y actualizar tus datos desde tu perfil. También podés eliminar tu cuenta: se desactiva tu acceso al portal y tu historial queda únicamente en poder del taller para fines de garantía.',
        ] },
        { titulo: 'Contacto', parrafos: [
          'Si tenés dudas sobre el manejo de tus datos, escribinos a través de los canales de contacto del taller.',
        ] },
      ],
    },
  };

  ngOnInit() {
    const key = this.route.snapshot.paramMap.get('doc') || 'terminos';
    const base = this.DOCS[key] || this.DOCS['terminos'];
    // El nombre del taller se resuelve con la marca vigente; si todavía no cargó, se
    // escribe «el taller» y se corrige en cuanto llega.
    this.marca.marca$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((m) => {
      const nombre = m?.nombre_taller?.trim() || 'el taller';
      const poner = (t: string) => t.split('{taller}').join(nombre);
      this.doc = {
        ...base,
        titulo: poner(base.titulo),
        secciones: base.secciones.map((sec) => ({ titulo: poner(sec.titulo), parrafos: sec.parrafos.map(poner) })),
      };
    });
  }
}
