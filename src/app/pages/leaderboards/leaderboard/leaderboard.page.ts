import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import {
  NavController,
  IonContent,
} from '@ionic/angular/standalone';
import { Firestore, doc, onSnapshot } from '@angular/fire/firestore';

import {
  LeaderboardService,
  LeaderboardEntry,
  Metric,
} from '../../../services/leaderboard.service';
import {
  DistributionPoint,
  LeaderboardShellComponent,
} from '../../../components/leaderboard-shell/leaderboard-shell.component';
import { AccountService } from '../../../services/account/account.service';

@Component({
  selector: 'app-leaderboard',
  standalone: true,
  templateUrl: './leaderboard.page.html',
  styleUrls: ['./leaderboard.page.scss'],
  imports: [CommonModule, IonContent, LeaderboardShellComponent],
})
export class LeaderboardPage implements OnInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private navCtrl = inject(NavController);
  private leaderboard = inject(LeaderboardService);
  private accountService = inject(AccountService);
  private firestore = inject(Firestore);

  groupId = '';
  groupName = 'Group';
  showSettingsButton = false;

  loading = true;
  errorMsg = '';
  metric: Metric = 'total';

  entries: LeaderboardEntry[] = [];
  distributionCurvePath = '';
  distributionPoints: DistributionPoint[] = [];
  selectedPointBin: number | null = null;
  selectedPointUserIds = new Set<string>();
  private groupUnsubscribe: (() => void) | null = null;
  private statsUnsubscribes = new Map<string, () => void>();
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private lastGroupUsersSignature = '';

  constructor() {}

  async ngOnInit(): Promise<void> {
    const groupId = this.route.snapshot.paramMap.get('groupID');

    if (!groupId) {
      this.loading = false;
      this.errorMsg = 'Missing group ID.';
      return;
    }

    this.groupId = groupId;
    this.startGroupSubscription();
    await this.refresh();
  }

  async refresh(): Promise<void> {
    this.errorMsg = '';
    this.loading = true;

    try {
      const raw = await this.leaderboard.getGroupLeaderboard(this.groupId, this.metric);
      this.entries = raw;
      this.buildDistributionChart();
    } catch (err: any) {
      console.warn('[GroupLeaderboard] refresh failed', err);
      this.errorMsg = err?.message ?? 'Failed to load group leaderboard.';
      this.entries = [];
      this.resetChartSelection();
      this.distributionCurvePath = '';
      this.distributionPoints = [];
    } finally {
      this.loading = false;
    }
  }

  goBack(): void {
    this.navCtrl.navigateBack('/groups', {
      animated: true,
      animationDirection: 'back',
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
          this.showSettingsButton = false;
          this.clearUserStatsListeners();
          this.lastGroupUsersSignature = '';
          return;
        }

        const group = snap.data() as any;
        this.groupName = typeof group?.name === 'string' && group.name.trim() ? group.name : 'Group';

        const ownerUserId = typeof group?.ownerUserId === 'string' ? group.ownerUserId.trim() : '';
        const currentUserId = this.accountService.getCredentials()().uid;
        this.showSettingsButton = !!currentUserId && ownerUserId === currentUserId;

        const userIDs = Array.isArray(group?.userIDs) ? group.userIDs.map((id: any) => String(id)) : [];
        this.rewireUserStatsListeners(userIDs);
        const nextSignature = userIDs.slice().sort().join('|');
        if (this.lastGroupUsersSignature && this.lastGroupUsersSignature !== nextSignature) {
          void this.refresh();
        }
        this.lastGroupUsersSignature = nextSignature;
      },
      () => {
        this.groupName = 'Group';
        this.showSettingsButton = false;
        this.clearUserStatsListeners();
      }
    );
  }

  private rewireUserStatsListeners(userIds: string[]): void {
    const nextIds = new Set(userIds.filter(Boolean));

    for (const [uid, unsubscribe] of this.statsUnsubscribes.entries()) {
      if (!nextIds.has(uid)) {
        unsubscribe();
        this.statsUnsubscribes.delete(uid);
      }
    }

    for (const uid of nextIds) {
      if (this.statsUnsubscribes.has(uid)) {
        continue;
      }

      const statsRef = doc(this.firestore, 'userStats', uid);
      const unsubscribe = onSnapshot(statsRef, () => {
        this.scheduleRefreshFromRealtime();
      });

      this.statsUnsubscribes.set(uid, unsubscribe);
    }
  }

  private clearUserStatsListeners(): void {
    for (const unsubscribe of this.statsUnsubscribes.values()) {
      unsubscribe();
    }
    this.statsUnsubscribes.clear();
  }

  private scheduleRefreshFromRealtime(): void {
    if (this.refreshTimer) {
      return;
    }

    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      void this.refresh();
    }, 120);
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
    this.clearUserStatsListeners();
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
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
    const toXPct = (score: number): number => 4 + ((score - minScore) / scoreSpan) * 92;
    const normalPdf = (x: number): number => {
      const z = (x - mean) / stdDev;
      return Math.exp(-0.5 * z * z);
    };
    const toYPct = (score: number): number => chartBottom - normalPdf(score) * curveHeight;

    const sampleCount = 80;
    const samples: string[] = [];
    for (let i = 0; i <= sampleCount; i += 1) {
      const score = minScore + (scoreSpan * i) / sampleCount;
      const x = toXPct(score).toFixed(2);
      const y = toYPct(score).toFixed(2);
      samples.push(`${i === 0 ? 'M' : 'L'} ${x} ${y}`);
    }
    this.distributionCurvePath = samples.join(' ');

    if (this.entries.length === 1) {
      const entry = this.entries[0];
      const score = this.scoreFor(entry);
      this.distributionPoints = [
        {
          binIndex: 0,
          xPercent: toXPct(score),
          yPercent: toYPct(score),
          count: 1,
          userIds: [entry.userId],
          rangeLabel: `${Math.round(score)}-${Math.round(score)}`,
        },
      ];
      return;
    }

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
