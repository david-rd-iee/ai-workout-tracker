import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ClientAccountPage } from './client-account.page';

describe('ClientAccountPage', () => {
  let component: ClientAccountPage;
  let fixture: ComponentFixture<ClientAccountPage>;

  beforeEach(() => {
    fixture = TestBed.createComponent(ClientAccountPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
