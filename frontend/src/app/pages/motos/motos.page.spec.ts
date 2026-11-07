import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MotosPage } from './motos.page';

describe('MotosPage', () => {
  let component: MotosPage;
  let fixture: ComponentFixture<MotosPage>;

  beforeEach(() => {
    fixture = TestBed.createComponent(MotosPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
