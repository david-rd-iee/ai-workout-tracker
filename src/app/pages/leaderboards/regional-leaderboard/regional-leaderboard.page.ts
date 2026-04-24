import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import {
  AlertController,
  IonContent,
} from '@ionic/angular/standalone';

import { Auth, onAuthStateChanged, User } from '@angular/fire/auth';
import { Firestore, doc, docData } from '@angular/fire/firestore';
import { Subscription } from 'rxjs';

import {
  LeaderboardService,
  LeaderboardEntry,
  LeaderboardTrendSeries,
  Metric,
  RegionalQuery,
} from '../../../services/leaderboard.service';
import {
  DistributionPoint,
  LeaderboardChartMode,
  LeaderboardScope,
  LeaderboardShellComponent,
} from '../../../components/leaderboard-shell/leaderboard-shell.component';
import {
  buildLeaderboardDistributionChart,
  emptyLeaderboardDistributionChart,
} from '../../../components/leaderboard-shell/leaderboard-distribution.util';
import { HeaderComponent } from '../../../components/header/header.component';

@Component({
  selector: 'app-regional-leaderboard',
  standalone: true,
  templateUrl: './regional-leaderboard.page.html',
  styleUrls: ['./regional-leaderboard.page.scss'],
  imports: [CommonModule, IonContent, LeaderboardShellComponent, HeaderComponent],
})
export class RegionalLeaderboardPage implements OnInit, OnDestroy {
  private static readonly SMALL_POPULATION_THRESHOLD = 10;

  private auth = inject(Auth);
  private firestore = inject(Firestore);
  private leaderboard = inject(LeaderboardService);
  private alertController = inject(AlertController);

  private sub?: Subscription;
  private leaderboardSub?: Subscription;
  private trendSub?: Subscription;

  loading = true;
  errorMsg = '';

  authUser: User | null = null;

  // Anchor region (from current user's userStats)
  userRegion: any = null;

  // UI controls
  scope: LeaderboardScope = 'city';
  metric: Metric = 'total';
  chartMode: LeaderboardChartMode = 'distribution';
  availableChartModes: LeaderboardChartMode[] = ['distribution'];

  // Data
  entries: LeaderboardEntry[] = [];
  trendSeries: LeaderboardTrendSeries[] = [];
  distributionCurvePath = '';
  distributionPoints: DistributionPoint[] = [];
  distributionMedianXPercent: number | null = null;
  distributionMedianLabel = '';
  selectedPointBin: number | null = null;
  selectedPointUserIds = new Set<string>();
  constructor() {}

  ngOnInit() {
    onAuthStateChanged(this.auth, (u) => {
      this.authUser = u;
      if (!u) {
        this.sub?.unsubscribe();
        this.sub = undefined;
        this.leaderboardSub?.unsubscribe();
        this.leaderboardSub = undefined;
        this.trendSub?.unsubscribe();
        this.trendSub = undefined;
        this.entries = [];
        this.trendSeries = [];
        this.resetChartSelection();
        this.clearDistributionChart();
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
          this.subscribeToRegionalLeaderboard();
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
    this.leaderboardSub?.unsubscribe();
    this.trendSub?.unsubscribe();
  }

  private subscribeToRegionalLeaderboard(): void {
    this.leaderboardSub?.unsubscribe();
    this.errorMsg = '';

    if (!this.authUser) {
      return;
    }

    const regional = this.resolveRegionalQuery();
    if (!regional) {
      this.loading = false;
      return;
    }

    this.loading = true;
    this.leaderboardSub = this.leaderboard
      .watchRegionalLeaderboard(regional, this.metric, 100)
      .subscribe({
        next: (entries) => {
          this.entries = entries;
          this.errorMsg = '';
          this.loading = false;
          this.syncChartOptionsByPopulation();
          this.syncChartForCurrentMode();
        },
        error: (err: any) => {
          console.warn('[RegionalLeaderboard] subscription failed', err);
          this.errorMsg =
            err?.message ??
            'Failed to load regional leaderboard (check indexes + region fields).';
          this.entries = [];
          this.trendSeries = [];
          this.trendSub?.unsubscribe();
          this.trendSub = undefined;
          this.resetChartSelection();
          this.clearDistributionChart();
          this.loading = false;
        },
      });
  }

  onMetricChanged(metric: Metric): void {
    this.metric = metric;
    this.subscribeToRegionalLeaderboard();
  }

  onScopeChanged(scope: LeaderboardScope): void {
    this.scope = scope;
    this.subscribeToRegionalLeaderboard();
  }

  onChartModeChanged(mode: LeaderboardChartMode): void {
    if (!this.availableChartModes.includes(mode) || this.chartMode === mode) {
      return;
    }

    this.chartMode = mode;
    this.syncChartForCurrentMode();
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

  async showRegionalInfo(): Promise<void> {
    const alert = await this.alertController.create({
      mode: 'ios',
      header: 'Regional leaderboard help',
      subHeader: 'Compare your work score by city, state, or country',
      message: [
        '• Switch scope to compare against your city, state, or country.',
        '• Change metrics to view total, strength, or cardio score.',
        '• Tap chart points and members to highlight the same score range.'
      ].join('\n'),
      buttons: ['Got it'],
      translucent: true,
    });

    await alert.present();
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

  onMemberClick(entry: LeaderboardEntry): void {
    const point = this.distributionPoints.find((candidate) =>
      candidate.userIds.includes(entry.userId)
    );
    if (!point) {
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

  private resolveRegionalQuery(): RegionalQuery | null {
    if (!this.userRegion?.countryCode) {
      this.entries = [];
      this.trendSeries = [];
      this.trendSub?.unsubscribe();
      this.trendSub = undefined;
      this.resetChartSelection();
      this.clearDistributionChart();
      this.errorMsg = 'Your userStats.region is missing (countryCode).';
      return null;
    }

    if (this.scope === 'country') {
      return {
        scope: 'country',
        countryCode: this.userRegion.countryCode,
      };
    }

    if (!this.userRegion.stateCode) {
      this.entries = [];
      this.trendSeries = [];
      this.trendSub?.unsubscribe();
      this.trendSub = undefined;
      this.resetChartSelection();
      this.clearDistributionChart();
      this.errorMsg = 'Your userStats.region is missing (stateCode).';
      return null;
    }

    if (this.scope === 'state') {
      return {
        scope: 'state',
        countryCode: this.userRegion.countryCode,
        stateCode: this.userRegion.stateCode,
      };
    }

    if (!this.userRegion.cityId) {
      this.entries = [];
      this.trendSeries = [];
      this.trendSub?.unsubscribe();
      this.trendSub = undefined;
      this.resetChartSelection();
      this.clearDistributionChart();
      this.errorMsg = 'Your userStats.region is missing (cityId).';
      return null;
    }

    return {
      scope: 'city',
      countryCode: this.userRegion.countryCode,
      stateCode: this.userRegion.stateCode,
      cityId: this.userRegion.cityId,
    };
  }

  private buildDistributionChart(): void {
    this.resetChartSelection();
    const chart = buildLeaderboardDistributionChart(this.entries, (entry) => this.scoreFor(entry));
    this.distributionCurvePath = chart.curvePath;
    this.distributionPoints = chart.points;
    this.distributionMedianXPercent = chart.medianXPercent;
    this.distributionMedianLabel = chart.medianLabel;
  }

  private syncChartOptionsByPopulation(): void {
    this.availableChartModes = ['distribution', 'trend'];
    if (!this.availableChartModes.includes(this.chartMode)) {
      this.chartMode = 'distribution';
    }

    if (this.entries.length === 0) {
      this.chartMode = 'distribution';
    }
  }

  private syncChartForCurrentMode(): void {
    if (this.chartMode === 'trend') {
      this.resetChartSelection();
      this.clearDistributionChart();
      this.subscribeToTrendSeries();
      return;
    }

    this.trendSub?.unsubscribe();
    this.trendSub = undefined;
    this.trendSeries = [];
    this.buildDistributionChart();
  }

  private subscribeToTrendSeries(): void {
    this.trendSub?.unsubscribe();
    this.trendSub = undefined;

    if (this.entries.length === 0) {
      this.trendSeries = [];
      return;
    }

    this.trendSub = this.leaderboard.watchAddedScoreTrend(this.entries, this.metric).subscribe({
      next: (series) => {
        if (series.length === 0 && this.entries.length > 0) {
          this.fallbackToDistributionChart();
          return;
        }
        this.trendSeries = series;
      },
      error: (error) => {
        console.warn('[RegionalLeaderboard] Failed to load trend chart data', error);
        this.fallbackToDistributionChart();
      },
    });
  }

  private fallbackToDistributionChart(): void {
    if (this.chartMode !== 'trend') {
      this.trendSeries = [];
      return;
    }

    this.trendSub?.unsubscribe();
    this.trendSub = undefined;
    this.trendSeries = [];
    this.chartMode = 'distribution';
    this.availableChartModes = ['distribution', 'trend'];
    this.buildDistributionChart();
  }

  private clearDistributionChart(): void {
    const chart = emptyLeaderboardDistributionChart();
    this.distributionCurvePath = chart.curvePath;
    this.distributionPoints = chart.points;
    this.distributionMedianXPercent = chart.medianXPercent;
    this.distributionMedianLabel = chart.medianLabel;
  }
}
