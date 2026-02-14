import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { NavController } from '@ionic/angular';
import { of } from 'rxjs';
import { LeaderboardPage } from './leaderboard.page';
import { LeaderboardService } from '../../../services/leaderboard.service';
import { GroupService } from '../../../services/group.service';

describe('LeaderboardPage', () => {
  let component: LeaderboardPage;
  let fixture: ComponentFixture<LeaderboardPage>;

  const activatedRouteMock = {
    snapshot: {
      paramMap: {
        get: (_key: string) => 'test-group-id',
      },
    },
  };

  const navControllerMock = {
    navigateBack: jasmine.createSpy('navigateBack'),
  };

  const leaderboardServiceMock = {
    getGroupLeaderboard: () => Promise.resolve([]),
  };

  const groupServiceMock = {
    getGroup: () => of({ groupId: 'test-group-id', name: 'Test Group' }),
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [LeaderboardPage],
      providers: [
        { provide: ActivatedRoute, useValue: activatedRouteMock },
        { provide: NavController, useValue: navControllerMock },
        { provide: LeaderboardService, useValue: leaderboardServiceMock },
        { provide: GroupService, useValue: groupServiceMock },
      ],
    });

    fixture = TestBed.createComponent(LeaderboardPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
