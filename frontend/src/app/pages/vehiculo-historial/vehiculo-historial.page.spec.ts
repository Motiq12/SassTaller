import { ComponentFixture, TestBed } from '@angular/core/testing';
import { VehiculoHistorialPage } from './vehiculo-historial.page';

describe('VehiculoHistorialPage', () => {
  let component: VehiculoHistorialPage;
  let fixture: ComponentFixture<VehiculoHistorialPage>;

  beforeEach(() => {
    fixture = TestBed.createComponent(VehiculoHistorialPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
