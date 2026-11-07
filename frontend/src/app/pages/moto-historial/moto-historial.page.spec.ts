import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MotoHistorialPage } from './moto-historial.page';

describe('MotoHistorialPage', () => {
  let component: MotoHistorialPage;
  let fixture: ComponentFixture<MotoHistorialPage>;

  beforeEach(() => {
    fixture = TestBed.createComponent(MotoHistorialPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
