import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { IonicModule, NavController } from '@ionic/angular';
import { Subscription } from 'rxjs';

import { GroupLeaderboardEntry } from '../../../models/group-war.model';
import { GroupWarService } from '../../../services/group-war.service';
import { environment } from '../../../../environments/environment';
import { HeaderComponent } from '../../../components/header/header.component';

const DEV_SEED_GROUP_LEADERBOARD_ENTRIES: GroupLeaderboardEntry[] = [
  {
    groupId: 'gw_lb_atlas_legion',
    groupName: 'Atlas Legion',
    rank: 1,
    globalLeaderboardRank: 1,
    totalWarLeaderboardPoints: 1740,
    warRating: 1282,
    warWeight: 81620,
    wins: 24,
    losses: 5,
    ties: 2,
    dominantExerciseTag: 'strength',
  },
  {
    groupId: 'gw_lb_cardio_collective',
    groupName: 'Cardio Collective',
    rank: 2,
    globalLeaderboardRank: 2,
    totalWarLeaderboardPoints: 1625,
    warRating: 1248,
    warWeight: 80310,
    wins: 22,
    losses: 6,
    ties: 1,
    dominantExerciseTag: 'cardio',
  },
  {
    groupId: 'gw_lb_hoplite_union',
    groupName: 'Hoplite Union',
    rank: 3,
    globalLeaderboardRank: 3,
    totalWarLeaderboardPoints: 1510,
    warRating: 1214,
    warWeight: 78920,
    wins: 20,
    losses: 7,
    ties: 2,
    dominantExerciseTag: 'hybrid_strength',
  },
  {
    groupId: 'gw_lb_olympus_pulse',
    groupName: 'Olympus Pulse',
    rank: 4,
    globalLeaderboardRank: 4,
    totalWarLeaderboardPoints: 1440,
    warRating: 1190,
    warWeight: 78100,
    wins: 19,
    losses: 8,
    ties: 1,
    dominantExerciseTag: 'hybrid_cardio',
  },
  {
    groupId: 'gw_lb_spartan_engine',
    groupName: 'Spartan Engine',
    rank: 5,
    globalLeaderboardRank: 5,
    totalWarLeaderboardPoints: 1365,
    warRating: 1168,
    warWeight: 76840,
    wins: 17,
    losses: 8,
    ties: 3,
    dominantExerciseTag: 'strength',
  },
  {
    groupId: 'gw_lb_marathon_zero',
    groupName: 'Marathon Zero',
    rank: 6,
    globalLeaderboardRank: 6,
    totalWarLeaderboardPoints: 1298,
    warRating: 1152,
    warWeight: 75630,
    wins: 16,
    losses: 9,
    ties: 2,
    dominantExerciseTag: 'cardio',
  },
];

@Component({
  selector: 'app-global-group-leaderboard',
  standalone: true,
  templateUrl: './global-group-leaderboard.page.html',
  styleUrls: ['./global-group-leaderboard.page.scss'],
  imports: [CommonModule, IonicModule, HeaderComponent],
})
export class GlobalGroupLeaderboardPage implements OnInit, OnDestroy {
  private navCtrl = inject(NavController);
  private groupWarService = inject(GroupWarService);

  loading = true;
  errorMessage = '';

  entries: GroupLeaderboardEntry[] = [];

  private leaderboardSub?: Subscription;

  ngOnInit(): void {
    this.leaderboardSub = this.groupWarService.watchGlobalGroupLeaderboard(250).subscribe({
      next: (entries) => {
        const resolvedEntries = this.resolveLeaderboardSeed(entries);
        this.loading = false;
        this.errorMessage = '';
        this.entries = resolvedEntries;
      },
      error: (error) => {
        console.error('[GlobalGroupLeaderboardPage] Failed to load leaderboard', error);
        this.loading = false;
        this.errorMessage = 'Could not load the global group leaderboard.';
        this.entries = [];
      },
    });
  }

  ngOnDestroy(): void {
    this.leaderboardSub?.unsubscribe();
  }

  openGroup(groupId: string): void {
    const normalizedGroupId = String(groupId ?? '').trim();
    if (!normalizedGroupId) {
      return;
    }

    this.navCtrl.navigateForward(`/leaderboard/${normalizedGroupId}`, {
      animated: true,
      animationDirection: 'forward',
    });
  }

  private resolveLeaderboardSeed(entries: GroupLeaderboardEntry[]): GroupLeaderboardEntry[] {
    if (entries.length > 0) {
      return entries;
    }

    if (environment.production) {
      return [];
    }

    return DEV_SEED_GROUP_LEADERBOARD_ENTRIES.map((entry) => ({ ...entry }));
  }
}
