import { Component, OnInit } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute } from '@angular/router';
import { environment } from '../../../environments/environment';
import { Documento, copiaDocumento, seccionDeTexto, mesYAnio } from '../../shared/textos-legales';


@Component({
  standalone: false,
  selector: 'app-portal-legal',
  templateUrl: './portal-legal.page.html',
  styleUrls: ['./portal-legal.page.scss'],
})
export class PortalLegalPage implements OnInit {
  doc: Documento | null = null;

  constructor(private route: ActivatedRoute, private http: HttpClient) {}

  ngOnInit() {
    const key = this.route.snapshot.paramMap.get('doc') || 'terminos';
    this.doc = copiaDocumento(key === 'privacidad' ? 'privacidad' : 'terminos');
    if (key === 'privacidad') this.ponerContacto();
    else this.ponerCondiciones();
  }

  // Las condiciones que escribió el taller (Configuración → Textos del portal). Sin
  // escribir, quedan las de fábrica.
  private ponerCondiciones() {
    this.http.get<{ data: { condiciones: { titulo: string; texto: string }[]; condiciones_actualizado: string | null } }>(`${environment.apiUrl}/marca/portal`).subscribe({
      next: r => {
        const c = r.data?.condiciones || [];
        if (!c.length || !this.doc) return;
        this.doc.secciones = c.map(seccionDeTexto);
        if (r.data.condiciones_actualizado) this.doc.actualizado = mesYAnio(r.data.condiciones_actualizado);
      },
      error: () => {},
    });
  }

  // El contacto concreto (teléfono y correo) es el que el taller carga en
  // Configuración. Sin cargar, queda el mostrador de las sucursales.
  private ponerContacto() {
    this.http.get<{ data: { nombre_taller: string; telefono: string; email: string } }>(`${environment.apiUrl}/marca/contacto`).subscribe({
      next: r => {
        const c = r.data;
        const canales = [c.telefono ? `al ${c.telefono}` : '', c.email ? `al correo ${c.email}` : ''].filter(Boolean);
        if (!canales.length) return;
        const contacto = this.doc?.secciones.find(s => s.titulo === 'Contacto');
        if (contacto) {
          // Sin nombres de taller escritos acá. Esto es el aviso de privacidad de
          // CADA taller: decía "MS Motos" de respaldo y nombraba sus sucursales de
          // Liberia y Cañas, así que el documento legal de cualquier otro taller
          // remitía a las sedes de una empresa ajena.
          contacto.parrafos = [`Si tienes dudas sobre el manejo de tus datos o quieres ejercer tus derechos, comunícate con ${c.nombre_taller || 'el taller'} ${canales.join(' o ')}, o acércate al mostrador.`];
        }
      },
      error: () => {},
    });
  }
}
