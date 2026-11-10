import { Component, OnInit, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute } from '@angular/router';
import { environment } from '../../../environments/environment';
import { TallerService } from '../../services/taller.service';
import { Documento, copiaDocumento, seccionDeTexto, mesYAnio } from '../../shared/textos-legales';
import { MarcaService } from '../../services/marca.service';


@Component({
  standalone: false,
  selector: 'app-portal-legal',
  templateUrl: './portal-legal.page.html',
  styleUrls: ['./portal-legal.page.scss'],
})
export class PortalLegalPage implements OnInit {
  doc: Documento | null = null;

  private taller = inject(TallerService);

  constructor(private route: ActivatedRoute, private http: HttpClient, private marca: MarcaService) {}

  // Estos textos son de un taller: sin saber cuál, quedan los de fábrica.
  private get conTaller(): { params: { taller: string } } | null {
    const slug = this.taller.actual();
    return slug ? { params: { taller: slug } } : null;
  }

  ngOnInit() {
    const key = this.route.snapshot.paramMap.get('doc') || 'terminos';
    this.doc = copiaDocumento(key === 'privacidad' ? 'privacidad' : 'terminos');
    this.ponerNombreTaller();
    if (key === 'privacidad') this.ponerContacto();
    else this.ponerCondiciones();
  }

  // Los textos de fábrica traen `{taller}` donde va el nombre. Sale de MarcaService
  // y no de una petición nueva: ya lo tiene resuelto para el taller de esta sesión.
  private ponerNombreTaller() {
    if (!this.doc) return;
    const nombre = this.marca.rotuloPublico || 'el taller';
    for (const s of this.doc.secciones) {
      s.parrafos = s.parrafos.map(p => p.split('{taller}').join(nombre));
    }
  }

  // Las condiciones que escribió el taller (Configuración → Textos del portal). Sin
  // escribir, quedan las de fábrica.
  private ponerCondiciones() {
    const opciones = this.conTaller;
    if (!opciones) return;
    this.http.get<{ data: { condiciones: { titulo: string; texto: string }[]; condiciones_actualizado: string | null } }>(`${environment.apiUrl}/marca/portal`, opciones).subscribe({
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
    const opciones = this.conTaller;
    if (!opciones) return;
    this.http.get<{ data: { nombre_taller: string; telefono: string; email: string } }>(`${environment.apiUrl}/marca/contacto`, opciones).subscribe({
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
