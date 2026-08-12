import { ComponentFixture, TestBed } from '@angular/core/testing';
import { VehiculosPage } from './vehiculos.page';

describe('VehiculosPage', () => {
  let component: VehiculosPage;
  let fixture: ComponentFixture<VehiculosPage>;

  beforeEach(() => {
    fixture = TestBed.createComponent(VehiculosPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
