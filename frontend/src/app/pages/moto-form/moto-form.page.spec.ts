import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MotoFormPage } from './moto-form.page';

describe('MotoFormPage', () => {
  let component: MotoFormPage;
  let fixture: ComponentFixture<MotoFormPage>;

  beforeEach(() => {
    fixture = TestBed.createComponent(MotoFormPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
