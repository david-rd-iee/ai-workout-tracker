import { ComponentFixture, TestBed } from '@angular/core/testing';
import { GroupSettingsPage } from './group-settings.page';

describe('GroupSettingsPage', () => {
  let component: GroupSettingsPage;
  let fixture: ComponentFixture<GroupSettingsPage>;

  beforeEach(() => {
    fixture = TestBed.createComponent(GroupSettingsPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
