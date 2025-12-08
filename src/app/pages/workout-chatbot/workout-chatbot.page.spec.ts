import { ComponentFixture, TestBed } from '@angular/core/testing';
import { WorkoutChatbotPage } from './workout-chatbot.page';

describe('WorkoutChatbotPage', () => {
  let component: WorkoutChatbotPage;
  let fixture: ComponentFixture<WorkoutChatbotPage>;

  beforeEach(() => {
    fixture = TestBed.createComponent(WorkoutChatbotPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
