import { Component, OnInit, inject } from '@angular/core';
import { Router } from '@angular/router';
import { DirectorioService, TallerDirectorio, Ubicaciones } from '../../services/directorio.service';
import { MarcaService } from '../../services/marca.service';
import { TallerService } from '../../services/taller.service';

/**
 * Cómo llega al portal quien no tiene el enlace de su taller: lo busca por zona o por
 * nombre, lo elige y crea su cuenta ahí. Se usa una sola vez; después entra con el login
 * de siempre.
 */
@Component({
  standalone: false,
  selector: 'app-portal-buscar-taller',
  templateUrl: './portal-buscar-taller.page.html',
  styleUrls: ['./portal-login.page.scss', './portal-buscar-taller.page.scss'],
})
export class PortalBuscarTallerPage implements OnInit {
  private directorio = inject(DirectorioService);
  private taller = inject(TallerService);
  private router = inject(Router);
  marca = inject(MarcaService);

  ubicaciones: Ubicaciones = {};
  provincia = '';
  canton = '';
  q = '';

  buscando = false;
  buscado = false;
  error = '';
  resultados: TallerDirectorio[] = [];
  sinLogo = new Set<string>();

  get provincias(): string[] { return Object.keys(this.ubicaciones); }
  get cantones(): string[] { return this.ubicaciones[this.provincia] || []; }
  get puedeBuscar(): boolean { return !!this.provincia || this.q.trim().length >= 2; }

  ngOnInit(): void {
    // En el subdominio de un taller ya se sabe cuál es: no hay nada que buscar.
    if (this.taller.deSubdominio()) {
      this.router.navigate(['/portal/registro'], { replaceUrl: true });
      return;
    }
    // Vino a elegir: la pantalla deja de llevar la marca del taller anterior.
    this.taller.limpiar();
    this.marca.cargarPublica().subscribe({ error: () => {} });
    this.directorio.ubicaciones().subscribe({
      next: r => { this.ubicaciones = r.data; },
      error: () => { this.error = 'No pudimos cargar las provincias. Recargá la página.'; },
    });
  }

  cambiarProvincia(): void { this.canton = ''; }

  buscar(): void {
    if (!this.puedeBuscar || this.buscando) return;
    this.buscando = true;
    this.error = '';
    this.directorio.buscar({ provincia: this.provincia, canton: this.canton, q: this.q }).subscribe({
      next: r => { this.resultados = r.data; this.buscado = true; this.buscando = false; },
      error: e => {
        this.buscando = false;
        this.resultados = [];
        this.error = e?.error?.error || 'No se pudo buscar. Probá de nuevo.';
      },
    });
  }

  elegir(t: TallerDirectorio): void {
    this.taller.fijar(t.slug);
    this.marca.cargarPublica().subscribe({ error: () => {} });
    this.router.navigate(['/portal/registro']);
  }

  logo(t: TallerDirectorio): string | null {
    return t.tiene_logo && !this.sinLogo.has(t.slug) ? this.directorio.logoDe(t.slug) : null;
  }

  iniciales(nombre: string): string {
    return nombre.trim().split(/\s+/).slice(0, 2).map(p => p[0]).join('').toUpperCase();
  }
}
