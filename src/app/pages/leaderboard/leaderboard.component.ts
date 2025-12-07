// src/app/pages/leaderboard/leaderboard.component.ts
import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { FormsModule } from '@angular/forms';
import {
  LeaderboardService,
  LeaderboardEntry,
  Metric,
} from '../../services/leaderboard.service';
import { Subscription } from 'rxjs';
import { Auth, onAuthStateChanged } from '@angular/fire/auth';
import { Region } from '../../models/user-stats.model';

export type RegionSort = 'none' | 'city' | 'state' | 'country';

@Component({
  selector: 'app-leaderboard',
  standalone: true,
  templateUrl: './leaderboard.component.html',
  styleUrls: ['./leaderboard.component.scss'],
  imports: [CommonModule, IonicModule, FormsModule],
})
export class LeaderboardComponent implements OnInit, OnDestroy {
  // Sort controls
  regionSort: RegionSort = 'none';
  metricSort: Metric = 'total';

  // Data
  allEntries: LeaderboardEntry[] = [];
  entries: LeaderboardEntry[] = [];

  // Current user info for region filtering
  currentUserId: string | null = null;
  currentUserRegion: Region | null = null;

  loading = true;
  errorMessage: string | null = null;

  private sub?: Subscription;
  private authUnsub?: () => void;

  constructor(
    private leaderboardService: LeaderboardService,
    private auth: Auth
  ) {}

  ngOnInit() {
    // Listen for auth state changes so we reliably know who is logged in
    this.authUnsub = onAuthStateChanged(this.auth, (user) => {
      if (user) {
        this.currentUserId = user.uid;
        // If we already have entries, update region + re-apply sort
        const me = this.allEntries.find((e) => e.userId === user.uid);
        this.currentUserRegion = me?.region ?? null;
      } else {
        this.currentUserId = null;
        this.currentUserRegion = null;
      }

      this.applySorting();
    });

    this.loadLeaderboard();
  }

  ngOnDestroy() {
    this.sub?.unsubscribe();
    if (this.authUnsub) {
      this.authUnsub();
    }
  }

  loadLeaderboard() {
    this.loading = true;
    this.errorMessage = null;
    this.sub?.unsubscribe();

    this.sub = this.leaderboardService.getAllUserStats().subscribe({
      next: (entries) => {
        this.allEntries = entries;

        // If we already know the current user, set their region now
        if (this.currentUserId) {
          const me = entries.find((e) => e.userId === this.currentUserId);
          this.currentUserRegion = me?.region ?? null;
        }

        this.applySorting();
        this.loading = false;
      },
      error: (err) => {
        console.error(err);
        this.errorMessage = 'Could not load leaderboard.';
        this.loading = false;
      },
    });
  }

  onRegionSortChange(event: Event) {
    const customEvent = event as CustomEvent;
    const value = customEvent.detail?.value;
    if (value === 'none' || value === 'city' || value === 'state' || value === 'country') {
      this.regionSort = value;
      this.applySorting();
    }
  }

  onMetricSortChange(event: Event) {
    const customEvent = event as CustomEvent;
    const value = customEvent.detail?.value;
    if (value === 'total' || value === 'cardio' || value === 'strength') {
      this.metricSort = value;
      this.applySorting();
    }
  }

  private applySorting() {
    if (!this.allEntries || this.allEntries.length === 0) {
      this.entries = [];
      return;
    }

    // Map metric selection to field name on LeaderboardEntry
    const metricField =
      this.metricSort === 'total'
        ? 'totalWorkScore'
        : this.metricSort === 'cardio'
        ? 'cardioWorkScore'
        : 'strengthWorkScore';

    // 1) Region FILTER
    let filtered = this.allEntries;

    if (this.regionSort !== 'none' && this.currentUserRegion) {
      const field = this.regionSort; // 'city' | 'state' | 'country'
      const myVal = (this.currentUserRegion[field] ?? '').toLowerCase();

      filtered = filtered.filter((entry) => {
        const entryVal = (entry.region?.[field] ?? '').toLowerCase();
        return entryVal === myVal;
      });
    }
    // If regionSort != 'none' but we *still* don't know the user's region,
    // we just show all entries (no filter) so it's never empty by accident.

    // 2) Metric SORT (descending: highest score at rank #1)
    const sorted = [...filtered].sort((a, b) => {
      const aVal = (a as any)[metricField] as number | undefined;
      const bVal = (b as any)[metricField] as number | undefined;
      return (bVal ?? 0) - (aVal ?? 0);
    });

    // 3) Update ranks
    sorted.forEach((entry, idx) => {
      entry.rank = idx + 1;
    });

    this.entries = sorted;
  }
}
