import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ProfileCreateTrainerPage } from './profile-create-trainer.page';

describe('ProfileCreateTrainerPage', () => {
  let component: ProfileCreateTrainerPage;
  let fixture: ComponentFixture<ProfileCreateTrainerPage>;

  beforeEach(() => {
    fixture = TestBed.createComponent(ProfileCreateTrainerPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
