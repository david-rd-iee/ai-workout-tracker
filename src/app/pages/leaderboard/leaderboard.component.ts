import { Component, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';

import { UserStatsService } from '../../services/user-stats.service';
import { Subscription } from 'rxjs';
import { UserStats } from '../../models/user-stats.model';

import { Auth, onAuthStateChanged } from '@angular/fire/auth';

@Component({
  selector: 'app-leaderboard',
  standalone: true,
  templateUrl: './leaderboard.component.html',
  styleUrls: ['./leaderboard.component.scss'],
  imports: [CommonModule, IonicModule],
})
export class LeaderboardComponent implements OnDestroy {
  stats?: UserStats;
  errorMessage: string | null = null;

  private sub?: Subscription;
  private authUnsubscribe?: () => void;

  constructor(
    private userStatsService: UserStatsService,
    private auth: Auth
  ) {
    // 🔥 Listen for auth changes
    this.authUnsubscribe = onAuthStateChanged(this.auth, (user) => {
      if (!user) {
        console.warn('⚠ No user currently logged in.');
        this.errorMessage = 'No logged-in user.';
        this.stats = undefined;
        return;
      }

      console.log('👤 Current logged-in UID:', user.uid);

      // If an old subscription exists, clean it up before making a new one
      this.sub?.unsubscribe();

      // 🔥 Load the authenticated user's stats
      this.sub = this.userStatsService.getUserStats(user.uid).subscribe({
        next: (stats) => {
          console.log('🔥 Firestore returned stats:', stats);
          this.stats = stats;

          if (!stats) {
            this.errorMessage = 'No stats document found for this user.';
          } else {
            this.errorMessage = null;
          }
        },
        error: (err) => {
          console.error('❌ Firestore error:', err);
          this.errorMessage = err?.message ?? 'Unknown Firestore error';
        },
      });
    });
  }

  ngOnDestroy() {
    this.sub?.unsubscribe();
    this.authUnsubscribe?.();
  }
}