import { Component, OnInit } from '@angular/core';
import { PortalService } from '../../services/portal.service';

// Tour de bienvenida (3 pasos) que se muestra una sola vez POR CUENTA.
// Overlay autocontenido: se monta en el Inicio del portal y se autogestiona
// con un flag en localStorage por cliente. Sin dependencias externas.
@Component({
  standalone: false,
  selector: 'app-portal-onboarding',
  templateUrl: './portal-onboarding.component.html',
  styleUrls: ['./portal-onboarding.component.scss'],
})
export class PortalOnboardingComponent implements OnInit {
  visible = false;
  paso = 0;

  constructor(private portal: PortalService) {}

  // Flag por cuenta: así un dispositivo ya usado muestra el tour a cada cuenta nueva
  // (antes era global y, visto una vez, no se mostraba a las cuentas siguientes).
  private get key(): string {
    const id = this.portal.getCliente()?.id ?? 'anon';
    return `tallerms_onboarding_visto_${id}`;
  }

  readonly pasos = [
    {
      icon: 'calendar-outline',
      titulo: 'Agenda en segundos',
      texto: 'Elige tu vehículo, el servicio y el horario. ¿Apurado? Toca “Sugerir próximo horario libre”.',
    },
    {
      icon: 'construct-outline',
      titulo: 'Sigue tu vehículo en vivo',
      texto: 'Mira el progreso, los avances y las fotos del taller. Confirma tu asistencia con un toque.',
    },
    {
      icon: 'gift-outline',
      titulo: 'Gana recompensas',
      texto: 'Cada varios servicios completados, el siguiente es de cortesía. Sigue tu progreso en Ofertas.',
    },
  ];

  ngOnInit() {
    this.visible = !localStorage.getItem(this.key);
  }

  get ultimo(): boolean { return this.paso === this.pasos.length - 1; }

  ir(i: number) { this.paso = i; }
  siguiente() { this.ultimo ? this.cerrar() : (this.paso++); }
  saltar() { this.cerrar(); }

  private cerrar() {
    localStorage.setItem(this.key, '1');
    this.visible = false;
  }
}
