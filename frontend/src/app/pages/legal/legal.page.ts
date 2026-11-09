import { Component, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Title } from '@angular/platform-browser';
import { PRODUCTO } from '../../shared/producto';
import { DOCUMENTOS, Documento } from './documentos';

/**
 * Términos de servicio y política de privacidad de Motiq (/legal/terminos y
 * /legal/privacidad). Públicas, sin sesión, con la estética de la landing: son lo
 * que un taller lee antes de registrarse.
 */
@Component({
  selector: 'app-legal',
  templateUrl: './legal.page.html',
  styleUrls: ['./legal.page.scss'],
  standalone: false,
})
export class LegalPage {
  private route = inject(ActivatedRoute);
  private titulo = inject(Title);

  producto = PRODUCTO;
  doc: Documento = DOCUMENTOS.terminos;
  clave: 'terminos' | 'privacidad' = 'terminos';

  constructor() {
    this.route.paramMap.subscribe((p) => {
      this.clave = p.get('doc') === 'privacidad' ? 'privacidad' : 'terminos';
      this.doc = DOCUMENTOS[this.clave];
      this.titulo.setTitle(`${this.doc.titulo} · ${PRODUCTO.nombre}`);
    });
  }
}
