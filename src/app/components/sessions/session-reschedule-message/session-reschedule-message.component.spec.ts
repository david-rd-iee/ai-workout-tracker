import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing';

import { SessionRescheduleMessageComponent } from './session-reschedule-message.component';

describe('SessionRescheduleMessageComponent', () => {
  let component: SessionRescheduleMessageComponent;
  let fixture: ComponentFixture<SessionRescheduleMessageComponent>;

  beforeEach(waitForAsync(() => {
    TestBed.configureTestingModule({
      imports: [SessionRescheduleMessageComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(SessionRescheduleMessageComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }));

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
