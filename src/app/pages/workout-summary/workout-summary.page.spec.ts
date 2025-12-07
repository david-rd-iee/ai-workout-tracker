import { ComponentFixture, TestBed } from '@angular/core/testing';
import { WorkoutSummaryPage } from './workout-summary.page';

describe('WorkoutSummaryPage', () => {
  let component: WorkoutSummaryPage;
  let fixture: ComponentFixture<WorkoutSummaryPage>;

  beforeEach(() => {
    fixture = TestBed.createComponent(WorkoutSummaryPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
