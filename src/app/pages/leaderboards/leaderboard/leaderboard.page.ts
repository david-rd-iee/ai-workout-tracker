import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import {
  NavController,
  IonContent,
  IonButton,
  IonIcon,
  ToastController,
} from '@ionic/angular/standalone';
import { Firestore, doc, onSnapshot } from '@angular/fire/firestore';
import { Subscription } from 'rxjs';
import { addIcons } from 'ionicons';
import { chatbubblesOutline } from 'ionicons/icons';

import {
  LeaderboardService,
  LeaderboardEntry,
  LeaderboardTrendSeries,
  Metric,
} from '../../../services/leaderboard.service';
import {
  DistributionPoint,
  LeaderboardChartMode,
  LeaderboardShellComponent,
} from '../../../components/leaderboard-shell/leaderboard-shell.component';
import { AccountService } from '../../../services/account/account.service';
import {
  buildLeaderboardDistributionChart,
  emptyLeaderboardDistributionChart,
} from '../../../components/leaderboard-shell/leaderboard-distribution.util';
import { HeaderComponent } from '../../../components/header/header.component';
import { ChatsService } from '../../../services/chats.service';

@Component({
  selector: 'app-leaderboard',
  standalone: true,
  templateUrl: './leaderboard.page.html',
  styleUrls: ['./leaderboard.page.scss'],
  imports: [CommonModule, IonContent, IonButton, IonIcon, LeaderboardShellComponent, HeaderComponent],
})
export class LeaderboardPage implements OnInit, OnDestroy {
  private static readonly SMALL_POPULATION_THRESHOLD = 10;

  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private navCtrl = inject(NavController);
  private leaderboard = inject(LeaderboardService);
  private accountService = inject(AccountService);
  private firestore = inject(Firestore);
  private chatsService = inject(ChatsService);
  private toastCtrl = inject(ToastController);

  groupId = '';
  groupName = 'Group';
  isPTGroup = false;
  showSettingsButton = false;
  openingGroupChat = false;

  loading = true;
  errorMsg = '';
  metric: Metric = 'total';
  chartMode: LeaderboardChartMode = 'distribution';
  availableChartModes: LeaderboardChartMode[] = ['distribution'];

  entries: LeaderboardEntry[] = [];
  trendSeries: LeaderboardTrendSeries[] = [];
  distributionCurvePath = '';
  distributionPoints: DistributionPoint[] = [];
  distributionMedianXPercent: number | null = null;
  distributionMedianLabel = '';
  selectedPointBin: number | null = null;
  selectedPointUserIds = new Set<string>();
  private groupUnsubscribe: (() => void) | null = null;
  private leaderboardSub?: Subscription;
  private trendSub?: Subscription;

  constructor() {
    addIcons({ chatbubblesOutline });
  }

  async ngOnInit(): Promise<void> {
    const groupId = this.route.snapshot.paramMap.get('groupID');

    if (!groupId) {
      this.loading = false;
      this.errorMsg = 'Missing group ID.';
      return;
    }

    this.groupId = groupId;
    this.startGroupSubscription();
    this.subscribeToLeaderboard();
  }

  onMetricChanged(metric: Metric): void {
    this.metric = metric;
    this.subscribeToLeaderboard();
  }

  onChartModeChanged(mode: LeaderboardChartMode): void {
    if (!this.availableChartModes.includes(mode) || this.chartMode === mode) {
      return;
    }

    this.chartMode = mode;
    this.syncChartForCurrentMode();
  }

  private subscribeToLeaderboard(): void {
    this.leaderboardSub?.unsubscribe();
    this.errorMsg = '';
    this.loading = true;

    this.leaderboardSub = this.leaderboard.watchGroupLeaderboard(this.groupId, this.metric).subscribe({
      next: (entries) => {
        this.entries = entries;
        this.loading = false;
        this.errorMsg = '';
        this.syncChartOptionsByPopulation();
        this.syncChartForCurrentMode();
      },
      error: (err: any) => {
        console.warn('[GroupLeaderboard] subscription failed', err);
        this.errorMsg = err?.message ?? 'Failed to load group leaderboard.';
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
    return this.selectedPointUserIds.size > 0 && this.selectedPointUserIds.has(entry.userId);
  }

  private startGroupSubscription(): void {
    this.groupUnsubscribe?.();
    const groupRef = doc(this.firestore, 'groupID', this.groupId);
    this.groupUnsubscribe = onSnapshot(
      groupRef,
      (snap) => {
        if (!snap.exists()) {
          this.groupName = 'Group';
          this.isPTGroup = false;
          this.showSettingsButton = false;
          this.entries = [];
          this.trendSeries = [];
          this.trendSub?.unsubscribe();
          this.trendSub = undefined;
          this.resetChartSelection();
          this.clearDistributionChart();
          return;
        }

        const group = snap.data() as any;
        this.groupName = typeof group?.name === 'string' && group.name.trim() ? group.name : 'Group';
        this.isPTGroup = group?.isPTGroup === true;

        const ownerUserId = typeof group?.ownerUserId === 'string' ? group.ownerUserId.trim() : '';
        const currentUserId = this.accountService.getCredentials()().uid;
        this.showSettingsButton = !!currentUserId && ownerUserId === currentUserId;
      },
      () => {
        this.groupName = 'Group';
        this.isPTGroup = false;
        this.showSettingsButton = false;
      }
    );
  }

  async openGroupChat(): Promise<void> {
    if (!this.groupId || this.openingGroupChat) {
      return;
    }

    if (this.isPTGroup) {
      await this.showToast('Group chat is unavailable for PT groups.');
      return;
    }

    this.openingGroupChat = true;
    try {
      const currentUserId = this.accountService.getCredentials()().uid;
      if (!currentUserId) {
        await this.showToast('Please sign in again to open group chat.');
        return;
      }

      const chatId = await this.chatsService.ensureGroupChatForGroup(this.groupId);

      await this.router.navigate(['/chat', chatId], {
        state: {
          isGroupChat: true,
          groupId: this.groupId,
        },
      });
    } catch (error) {
      console.error('[GroupLeaderboard] Failed to open group chat:', error);
      const errorCode = typeof error === 'object' && error && 'code' in error
        ? String((error as { code?: unknown }).code ?? '')
        : '';
      if (errorCode.includes('failed-precondition')) {
        await this.showToast('Group chat is unavailable for this group.');
        return;
      }

      if (errorCode.includes('permission-denied')) {
        await this.showToast('You are not a member of this group chat.');
        return;
      }

      if (errorCode.includes('not-found')) {
        await this.showToast('This group no longer exists.');
        return;
      }

      await this.showToast('Could not open group chat.');
    } finally {
      this.openingGroupChat = false;
    }
  }

  openGroupSettings(): void {
    this.navCtrl.navigateForward(`/group-settings/${this.groupId}`, {
      animated: true,
      animationDirection: 'forward',
    });
  }

  ngOnDestroy(): void {
    this.groupUnsubscribe?.();
    this.groupUnsubscribe = null;
    this.leaderboardSub?.unsubscribe();
    this.trendSub?.unsubscribe();
  }

  private resetChartSelection(): void {
    this.selectedPointBin = null;
    this.selectedPointUserIds.clear();
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
        console.warn('[GroupLeaderboard] Failed to load trend chart data', error);
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

  private async showToast(message: string): Promise<void> {
    const toast = await this.toastCtrl.create({
      message,
      duration: 1800,
      position: 'bottom',
    });
    await toast.present();
  }
}
