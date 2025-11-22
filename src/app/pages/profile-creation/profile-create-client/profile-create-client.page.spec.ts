import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ProfileCreateClientPage } from './profile-create-client.page';

describe('ProfileCreateClientPage', () => {
  let component: ProfileCreateClientPage;
  let fixture: ComponentFixture<ProfileCreateClientPage>;

  beforeEach(() => {
    fixture = TestBed.createComponent(ProfileCreateClientPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
