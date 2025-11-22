import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ClientCalendarPage } from './client-calendar.page';

describe('ClientCalendarPage', () => {
  let component: ClientCalendarPage;
  let fixture: ComponentFixture<ClientCalendarPage>;

  beforeEach(() => {
    fixture = TestBed.createComponent(ClientCalendarPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
