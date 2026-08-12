import { Component, OnInit, OnDestroy } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { VehiculosService } from '../../services/vehiculos.service';
import { Vehiculo } from '../../models/vehiculo.model';
import { Orden } from '../../models/orden.model';

@Component({ standalone: false,
  selector: 'app-vehiculo-historial',
  templateUrl: './vehiculo-historial.page.html',
  styleUrls: ['./vehiculo-historial.page.scss'],
})
export class VehiculoHistorialPage implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  vehiculo: Vehiculo | null = null;
  historial: Orden[] = [];
  cargando = true;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private motoSvc: VehiculosService
  ) {}

  ngOnInit() {
    const id = +(this.route.snapshot.paramMap.get('id') || 0);
    this.motoSvc.getById(id).pipe(takeUntil(this.destroy$)).subscribe(res => { this.vehiculo = res.data; this.cargando = false; });
    this.motoSvc.getHistorial(id).pipe(takeUntil(this.destroy$)).subscribe(res => this.historial = res.data);
  }

  ngOnDestroy() { this.destroy$.next(); this.destroy$.complete(); }

  abrirOrden(id: number) { this.router.navigate(['/detalle-orden', id]); }
}
