import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ProfileCreationPage } from './profile-creation.page';

describe('ProfileCreationPage', () => {
  let component: ProfileCreationPage;
  let fixture: ComponentFixture<ProfileCreationPage>;

  beforeEach(() => {
    fixture = TestBed.createComponent(ProfileCreationPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
