import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NavController } from '@ionic/angular';
import { of, Subject } from 'rxjs';
import { GroupsPage } from './groups.page';
import { GroupService } from '../../services/group.service';
import { AccountService } from '../../services/account/account.service';

describe('GroupsPage', () => {
  let component: GroupsPage;
  let fixture: ComponentFixture<GroupsPage>;

  const authStateChanges$ = new Subject<{ user: any; isAuthenticated: boolean }>();
  const accountServiceMock = {
    getCredentials: () => () => ({ uid: 'test-user-id', email: 'test@test.com' }),
    authStateChanges$: authStateChanges$.asObservable(),
  };
  const groupServiceMock = {
    getUserGroups: () => of({ user: { groupID: [] }, groups: [] }),
    getAllGroupsOnce: () => Promise.resolve([]),
  };
  const navControllerMock = {
    navigateBack: jasmine.createSpy('navigateBack'),
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [GroupsPage],
      providers: [
        { provide: AccountService, useValue: accountServiceMock },
        { provide: GroupService, useValue: groupServiceMock },
        { provide: NavController, useValue: navControllerMock },
      ],
    });

    fixture = TestBed.createComponent(GroupsPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
