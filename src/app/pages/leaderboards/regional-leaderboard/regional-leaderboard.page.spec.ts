import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RegionalLeaderboardPage } from './regional-leaderboard.page';

describe('RegionalLeaderboardPage', () => {
  let component: RegionalLeaderboardPage;
  let fixture: ComponentFixture<RegionalLeaderboardPage>;

  beforeEach(() => {
    fixture = TestBed.createComponent(RegionalLeaderboardPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
