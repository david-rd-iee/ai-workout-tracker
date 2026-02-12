import { TestBed } from '@angular/core/testing';
import { ProfileUserPage } from './profile-user.page';

describe('ProfileUserPage', () => {
  let component: ProfileUserPage;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ProfileUserPage],
    }).compileComponents();

    const fixture = TestBed.createComponent(ProfileUserPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
