// src/app/pages/leaderboard/leaderboard.component.ts
import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { FormsModule } from '@angular/forms';
import { LeaderboardService, LeaderboardEntry, Metric } from '../../services/leaderboard.service';
import { Subscription } from 'rxjs';

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

  loading = true;
  errorMessage: string | null = null;

  private sub?: Subscription;

  constructor(private leaderboardService: LeaderboardService) {}

  ngOnInit() {
    this.loadLeaderboard();
  }

  ngOnDestroy() {
    this.sub?.unsubscribe();
  }

  loadLeaderboard() {
    this.loading = true;
    this.errorMessage = null;
    this.sub?.unsubscribe();

    this.sub = this.leaderboardService.getAllUserStats().subscribe({
      next: (entries) => {
        this.allEntries = entries;
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
    const regionField = this.regionSort === 'none' ? null : this.regionSort;
    const metricField = this.metricSort === 'total' ? 'totalWorkScore' : 
                       this.metricSort === 'cardio' ? 'cardioWorkScore' : 'strengthWorkScore';

    const sorted = [...this.allEntries].sort((a, b) => {
      // 1) Region sort (if any)
      if (regionField) {
        const aRegionVal = (a.region?.[regionField] ?? '').toLowerCase();
        const bRegionVal = (b.region?.[regionField] ?? '').toLowerCase();
        if (aRegionVal < bRegionVal) return -1;
        if (aRegionVal > bRegionVal) return 1;
      }

      // 2) Metric sort (descending)
      return (b[metricField] as number) - (a[metricField] as number);
    });

    // Update ranks
    sorted.forEach((entry, idx) => (entry.rank = idx + 1));
    this.entries = sorted;
  }
}