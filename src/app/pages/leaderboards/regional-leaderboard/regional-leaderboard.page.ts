import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import {
  NavController,
  IonContent,
} from '@ionic/angular/standalone';

import { Auth, onAuthStateChanged, User } from '@angular/fire/auth';
import { Firestore, doc, docData } from '@angular/fire/firestore';
import { Subscription } from 'rxjs';

import { LeaderboardService, LeaderboardEntry, Metric } from '../../../services/leaderboard.service';
import {
  DistributionPoint,
  LeaderboardScope,
  LeaderboardShellComponent,
} from '../../../components/leaderboard-shell/leaderboard-shell.component';

@Component({
  selector: 'app-regional-leaderboard',
  standalone: true,
  templateUrl: './regional-leaderboard.page.html',
  styleUrls: ['./regional-leaderboard.page.scss'],
  imports: [CommonModule, IonContent, LeaderboardShellComponent],
})
export class RegionalLeaderboardPage implements OnInit, OnDestroy {
  private auth = inject(Auth);
  private firestore = inject(Firestore);
  private leaderboard = inject(LeaderboardService);
  private navCtrl = inject(NavController);

  private sub?: Subscription;

  loading = true;
  errorMsg = '';

  authUser: User | null = null;

  // Anchor region (from current user's userStats)
  userRegion: any = null;

  // UI controls
  scope: LeaderboardScope = 'city';
  metric: Metric = 'total';

  // Data
  entries: LeaderboardEntry[] = [];
  distributionCurvePath = '';
  distributionPoints: DistributionPoint[] = [];
  selectedPointBin: number | null = null;
  selectedPointUserIds = new Set<string>();
  constructor() {}

  ngOnInit() {
    onAuthStateChanged(this.auth, (u) => {
      this.authUser = u;
      if (!u) {
        this.loading = false;
        this.errorMsg = 'Not signed in.';
        return;
      }

      // Subscribe to current user's userStats so region is always current
      const statsRef = doc(this.firestore, 'userStats', u.uid);
      this.sub?.unsubscribe();
      this.sub = docData(statsRef).subscribe({
        next: (stats: any) => {
          this.userRegion = stats?.region ?? null;
          this.refresh();
        },
        error: (err) => {
          console.warn('[RegionalLeaderboard] userStats read failed', err);
          this.loading = false;
          this.errorMsg = 'Failed to load your region.';
        },
      });
    });
  }

  ngOnDestroy() {
    this.sub?.unsubscribe();
  }

  async refresh() {
    this.errorMsg = '';

    if (!this.authUser) return;
    if (!this.userRegion?.countryCode) {
      this.loading = false;
      this.entries = [];
      this.errorMsg = 'Your userStats.region is missing (countryCode).';
      return;
    }

    this.loading = true;

    try {
      const regional =
        this.scope === 'country'
          ? {
              scope: 'country' as const,
              countryCode: this.userRegion.countryCode,
            }
          : this.scope === 'state'
          ? {
              scope: 'state' as const,
              countryCode: this.userRegion.countryCode,
              stateCode: this.userRegion.stateCode,
            }
          : {
              scope: 'city' as const,
              countryCode: this.userRegion.countryCode,
              stateCode: this.userRegion.stateCode,
              cityId: this.userRegion.cityId,
            };

      const raw = await this.leaderboard.getRegionalLeaderboard(regional, this.metric, 100);
      this.entries = raw;
      this.buildDistributionChart();
    } catch (err: any) {
      console.warn('[RegionalLeaderboard] refresh failed', err);
      this.errorMsg =
        err?.message ??
        'Failed to load regional leaderboard (check indexes + region fields).';
      this.entries = [];
      this.resetChartSelection();
      this.distributionCurvePath = '';
      this.distributionPoints = [];
    } finally {
      this.loading = false;
    }
  }

  goBack() {
    this.navCtrl.navigateBack('/profile-user');
  }

  regionLabel(): string {
    if (!this.userRegion) return 'Region';

    const country = this.userRegion.countryName || this.userRegion.countryCode;
    const state = this.userRegion.stateName || this.userRegion.stateCode;
    const city = this.userRegion.cityName || this.userRegion.cityId;

    if (this.scope === 'country') return `${country}`;
    if (this.scope === 'state') return `${state}, ${country}`;
    return `${city}, ${state}`;
  }

  graphRegionTitle(): string {
    if (!this.userRegion) return 'Region unavailable';

    if (this.scope === 'country') {
      return this.userRegion.countryName || this.userRegion.countryCode || 'Unknown country';
    }
    if (this.scope === 'state') {
      return this.userRegion.stateName || this.userRegion.stateCode || 'Unknown state';
    }
    return this.userRegion.cityName || this.userRegion.cityId || 'Unknown city';
  }

  scoreFor(e: LeaderboardEntry): number {
    if (this.metric === 'cardio') return e.cardioWorkScore ?? 0;
    if (this.metric === 'strength') return e.strengthWorkScore ?? 0;
    return e.totalWorkScore ?? 0;
  }

  onDistributionPointClick(point: DistributionPoint): void {
    if (this.selectedPointBin === point.binIndex) {
      this.resetChartSelection();
      return;
    }
    this.selectedPointBin = point.binIndex;
    this.selectedPointUserIds = new Set(point.userIds);
  }

  isPointSelected(point: DistributionPoint): boolean {
    return this.selectedPointBin === point.binIndex;
  }

  isEntryHighlighted(entry: LeaderboardEntry): boolean {
    return (
      this.selectedPointUserIds.size > 0 &&
      this.selectedPointUserIds.has(entry.userId)
    );
  }

  private resetChartSelection(): void {
    this.selectedPointBin = null;
    this.selectedPointUserIds.clear();
  }

  private buildDistributionChart(): void {
    this.resetChartSelection();

    if (this.entries.length === 0) {
      this.distributionCurvePath = '';
      this.distributionPoints = [];
      return;
    }

    const scores = this.entries.map((entry) => this.scoreFor(entry));
    const mean = scores.reduce((sum, value) => sum + value, 0) / scores.length;
    const variance =
      scores.reduce((sum, value) => sum + (value - mean) ** 2, 0) / scores.length;

    let stdDev = Math.sqrt(variance);
    if (!Number.isFinite(stdDev) || stdDev < 1e-6) {
      const fallback = Math.max(Math.abs(mean) * 0.1, 1);
      stdDev = Number.isFinite(fallback) && fallback > 0 ? fallback : 1;
    }

    const dataMin = Math.min(...scores);
    const dataMax = Math.max(...scores);
    const minScore = Math.min(dataMin, mean - 3 * stdDev);
    const maxScore = Math.max(dataMax, mean + 3 * stdDev);
    const scoreSpan = Math.max(maxScore - minScore, 1);

    const chartBottom = 92;
    const curveHeight = 70;
    const toXPct = (score: number): number =>
      4 + ((score - minScore) / scoreSpan) * 92;
    const normalPdf = (x: number): number => {
      const z = (x - mean) / stdDev;
      return Math.exp(-0.5 * z * z);
    };
    const toYPct = (score: number): number =>
      chartBottom - normalPdf(score) * curveHeight;

    const sampleCount = 80;
    const samples: string[] = [];
    for (let i = 0; i <= sampleCount; i += 1) {
      const score = minScore + (scoreSpan * i) / sampleCount;
      const x = toXPct(score).toFixed(2);
      const y = toYPct(score).toFixed(2);
      samples.push(`${i === 0 ? 'M' : 'L'} ${x} ${y}`);
    }
    this.distributionCurvePath = samples.join(' ');

    const binCount = Math.min(12, Math.max(6, Math.round(Math.sqrt(this.entries.length))));
    const binWidth = scoreSpan / binCount;
    const bins = Array.from({ length: binCount }, () => [] as LeaderboardEntry[]);

    for (const entry of this.entries) {
      const score = this.scoreFor(entry);
      const normalized = (score - minScore) / scoreSpan;
      const rawIndex = Math.floor(normalized * binCount);
      const clampedIndex = Math.min(binCount - 1, Math.max(0, rawIndex));
      bins[clampedIndex].push(entry);
    }

    this.distributionPoints = bins
      .map((bucketEntries, binIndex) => {
        if (bucketEntries.length === 0) {
          return null;
        }

        const rangeStart = minScore + binWidth * binIndex;
        const rangeEnd = rangeStart + binWidth;
        const midpoint = rangeStart + binWidth / 2;
        const userIds = bucketEntries.map((entry) => entry.userId);

        return {
          binIndex,
          xPercent: toXPct(midpoint),
          yPercent: toYPct(midpoint),
          count: bucketEntries.length,
          userIds,
          rangeLabel: `${Math.round(rangeStart)}-${Math.round(rangeEnd)}`,
        } satisfies DistributionPoint;
      })
      .filter((point): point is DistributionPoint => point !== null);
  }
}
