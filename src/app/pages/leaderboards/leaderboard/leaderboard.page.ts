import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import {
  NavController,
  IonContent,
} from '@ionic/angular/standalone';
import { firstValueFrom } from 'rxjs';

import {
  LeaderboardService,
  LeaderboardEntry,
  Metric,
} from '../../../services/leaderboard.service';
import { GroupService } from '../../../services/group.service';
import {
  DistributionPoint,
  LeaderboardShellComponent,
} from '../../../components/leaderboard-shell/leaderboard-shell.component';

@Component({
  selector: 'app-leaderboard',
  standalone: true,
  templateUrl: './leaderboard.page.html',
  styleUrls: ['./leaderboard.page.scss'],
  imports: [CommonModule, IonContent, LeaderboardShellComponent],
})
export class LeaderboardPage implements OnInit {
  private route = inject(ActivatedRoute);
  private navCtrl = inject(NavController);
  private leaderboard = inject(LeaderboardService);
  private groupService = inject(GroupService);

  groupId = '';
  groupName = 'Group';

  loading = true;
  errorMsg = '';
  metric: Metric = 'total';

  entries: LeaderboardEntry[] = [];
  distributionCurvePath = '';
  distributionPoints: DistributionPoint[] = [];
  selectedPointBin: number | null = null;
  selectedPointUserIds = new Set<string>();

  constructor() {}

  async ngOnInit(): Promise<void> {
    const groupId = this.route.snapshot.paramMap.get('groupID');

    if (!groupId) {
      this.loading = false;
      this.errorMsg = 'Missing group ID.';
      return;
    }

    this.groupId = groupId;
    await this.loadGroupName();
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

  isPointSelected(point: DistributionPoint): boolean {
    return this.selectedPointBin === point.binIndex;
  }

  isEntryHighlighted(entry: LeaderboardEntry): boolean {
    return this.selectedPointUserIds.size > 0 && this.selectedPointUserIds.has(entry.userId);
  }

  private async loadGroupName(): Promise<void> {
    try {
      const group = await firstValueFrom(this.groupService.getGroup(this.groupId));
      this.groupName = group?.name || 'Group';
    } catch {
      this.groupName = 'Group';
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
