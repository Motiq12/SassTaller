import { Component, OnInit, OnDestroy } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Location } from '@angular/common';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { OrdenesService } from '../../services/ordenes.service';
import { Orden, OrdenRepuesto } from '../../models/orden.model';
import { MarcaService, Marca } from '../../services/marca.service';
import { MiPerfilService } from '../../services/mi-perfil.service';
import { AuthService } from '../../services/auth.service';

@Component({
  standalone: false,
  selector: 'app-factura',
  templateUrl: './factura.page.html',
  styleUrls: ['./factura.page.scss'],
})
export class FacturaPage implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  orden: Orden | null = null;
  repuestos: OrdenRepuesto[] = [];
  cargando = true;
  // Identidad del taller: el logo y el nombre salen de la configuracion, no del
  // archivo que viene con la app. Sin esto, subir un logo nuevo no cambiaba la factura.
  marca: Marca | null = null;
  // Firma de quien emite (Mi perfil → Mi firma). Sin firma guardada, no sale nada.
  firma: string | null = null;

  constructor(
    private route: ActivatedRoute,
    private location: Location,
    private ordenSvc: OrdenesService,
    private marcaSvc: MarcaService,
    private miPerfil: MiPerfilService,
    private auth: AuthService,
  ) {}

  ngOnInit() {
    this.marcaSvc.get().pipe(takeUntil(this.destroy$)).subscribe(m => this.marca = m);
    this.miPerfil.get().pipe(takeUntil(this.destroy$)).subscribe({ next: r => this.firma = r.data.firma, error: () => {} });
    const id = +(this.route.snapshot.paramMap.get('id') || 0);
    this.ordenSvc.getById(id).pipe(takeUntil(this.destroy$)).subscribe(res => { this.orden = res.data; this.cargando = false; });
    this.ordenSvc.getRepuestos(id).pipe(takeUntil(this.destroy$)).subscribe(res => this.repuestos = res.data);
  }

  get totalRepuestos(): number {
    return this.repuestos.reduce((s, r) => s + (Number(r.cantidad) || 0) * (Number(r.costo_unitario) || 0), 0);
  }

  get descuento(): number { return Number(this.orden?.descuento) || 0; }

  get total(): number {
    if (!this.orden) return 0;
    // Los montos llegan de MySQL como texto: sin Number() se pegaban en vez de sumarse.
    return (Number(this.orden.costo_mano_obra) || 0) + this.totalRepuestos - this.descuento;
  }

  ngOnDestroy() { this.destroy$.next(); this.destroy$.complete(); }

  imprimir() { window.print(); }
  volver() { this.location.back(); }

  // null cuando el taller no cargó logo: la factura sale sin imagen, no con la de
  // otro taller. La plantilla oculta el <img> en ese caso.
  get logo(): string | null { return this.marcaSvc.logoParaDocumento(this.marca); }
  // Sin respaldo a un nombre propio: si el taller no cargó el suyo, va el genérico.
  get nombreTaller(): string { return this.marca?.nombre_taller || 'Taller'; }
  get emisor(): string { return this.auth.getUsuario()?.nombre || ''; }
}
