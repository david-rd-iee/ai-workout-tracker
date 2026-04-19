import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { IonicModule, NavController } from '@ionic/angular';
import { Subscription } from 'rxjs';

import { GroupLeaderboardEntry } from '../../../models/group-war.model';
import { GroupWarService } from '../../../services/group-war.service';

@Component({
  selector: 'app-global-group-leaderboard',
  standalone: true,
  templateUrl: './global-group-leaderboard.page.html',
  styleUrls: ['./global-group-leaderboard.page.scss'],
  imports: [CommonModule, IonicModule],
})
export class GlobalGroupLeaderboardPage implements OnInit, OnDestroy {
  private navCtrl = inject(NavController);
  private groupWarService = inject(GroupWarService);

  loading = true;
  errorMessage = '';

  exerciseFilter = 'all';
  allEntries: GroupLeaderboardEntry[] = [];
  filteredEntries: GroupLeaderboardEntry[] = [];
  exerciseOptions: string[] = [];

  private leaderboardSub?: Subscription;

  ngOnInit(): void {
    this.leaderboardSub = this.groupWarService.watchGlobalGroupLeaderboard(250).subscribe({
      next: (entries) => {
        this.loading = false;
        this.errorMessage = '';
        this.allEntries = entries;
        this.exerciseOptions = this.buildExerciseOptions(entries);
        this.applyFilter();
      },
      error: (error) => {
        console.error('[GlobalGroupLeaderboardPage] Failed to load leaderboard', error);
        this.loading = false;
        this.errorMessage = 'Could not load the global group leaderboard.';
        this.allEntries = [];
        this.filteredEntries = [];
        this.exerciseOptions = [];
      },
    });
  }

  ngOnDestroy(): void {
    this.leaderboardSub?.unsubscribe();
  }

  goToGroups(): void {
    this.navCtrl.navigateBack('/groups', {
      animated: true,
      animationDirection: 'back',
    });
  }

  onFilterChange(value: string | null | undefined): void {
    this.exerciseFilter = (value || 'all').trim() || 'all';
    this.applyFilter();
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

  private applyFilter(): void {
    if (this.exerciseFilter === 'all') {
      this.filteredEntries = [...this.allEntries];
      return;
    }

    this.filteredEntries = this.allEntries.filter((entry) =>
      (entry.dominantExerciseTag || '').toLowerCase() === this.exerciseFilter.toLowerCase()
    );
  }

  private buildExerciseOptions(entries: GroupLeaderboardEntry[]): string[] {
    const options = new Set<string>();
    entries.forEach((entry) => {
      const tag = (entry.dominantExerciseTag || '').trim();
      if (!tag) {
        return;
      }
      options.add(tag);
    });

    return Array.from(options).sort((left, right) => left.localeCompare(right));
  }
}
