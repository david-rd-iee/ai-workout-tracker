import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TrainerCalendarPage } from './trainer-calendar.page';

describe('TrainerCalendarPage', () => {
  let component: TrainerCalendarPage;
  let fixture: ComponentFixture<TrainerCalendarPage>;

  beforeEach(() => {
    fixture = TestBed.createComponent(TrainerCalendarPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
