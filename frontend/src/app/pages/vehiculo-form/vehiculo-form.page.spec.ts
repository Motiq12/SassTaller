import { ComponentFixture, TestBed } from '@angular/core/testing';
import { VehiculoFormPage } from './vehiculo-form.page';

describe('VehiculoFormPage', () => {
  let component: VehiculoFormPage;
  let fixture: ComponentFixture<VehiculoFormPage>;

  beforeEach(() => {
    fixture = TestBed.createComponent(VehiculoFormPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
