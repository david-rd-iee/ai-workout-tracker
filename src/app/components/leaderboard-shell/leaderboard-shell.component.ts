import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import {
  IonAvatar,
  IonButton,
  IonCard,
  IonIcon,
  IonList,
  IonSelect,
  IonSelectOption,
  IonSpinner,
} from '@ionic/angular/standalone';
import { FormsModule } from '@angular/forms';
import { addIcons } from 'ionicons';
import { arrowBackOutline } from 'ionicons/icons';
import { LeaderboardEntry, Metric } from '../../services/leaderboard.service';

export type LeaderboardScope = 'city' | 'state' | 'country';

export type DistributionPoint = {
  binIndex: number;
  xPercent: number;
  yPercent: number;
  count: number;
  userIds: string[];
  rangeLabel: string;
};

@Component({
  selector: 'app-leaderboard-shell',
  standalone: true,
  templateUrl: './leaderboard-shell.component.html',
  styleUrls: ['./leaderboard-shell.component.scss'],
  imports: [
    CommonModule,
    FormsModule,
    IonButton,
    IonIcon,
    IonCard,
    IonSelect,
    IonSelectOption,
    IonList,
    IonAvatar,
    IonSpinner,
  ],
})
export class LeaderboardShellComponent {
  @Input() title = 'Leaderboard';
  @Input() graphLabel = 'Stats';
  @Input() loading = false;
  @Input() errorMsg = '';

  @Input() metric: Metric = 'total';
  @Input() scope: LeaderboardScope = 'city';
  @Input() showScopeSelect = false;

  @Input() entries: LeaderboardEntry[] = [];
  @Input() distributionCurvePath = '';
  @Input() distributionPoints: DistributionPoint[] = [];
  @Input() selectedPointBin: number | null = null;
  @Input() highlightedUserIds = new Set<string>();

  @Output() back = new EventEmitter<void>();
  @Output() metricChange = new EventEmitter<Metric>();
  @Output() scopeChange = new EventEmitter<LeaderboardScope>();
  @Output() distributionPointClick = new EventEmitter<DistributionPoint>();

  avatarLoadErrorUserIds = new Set<string>();

  constructor() {
    addIcons({ arrowBackOutline });
  }

  onMetricChange(value: Metric): void {
    this.metricChange.emit(value);
  }

  onScopeChange(value: LeaderboardScope): void {
    this.scopeChange.emit(value);
  }

  metricLabel(): string {
    if (this.metric === 'cardio') return 'Cardio';
    if (this.metric === 'strength') return 'Strength';
    return 'Total';
  }

  scoreFor(e: LeaderboardEntry): number {
    if (this.metric === 'cardio') return e.cardioWorkScore ?? 0;
    if (this.metric === 'strength') return e.strengthWorkScore ?? 0;
    return e.totalWorkScore ?? 0;
  }

  isPointSelected(point: DistributionPoint): boolean {
    return this.selectedPointBin === point.binIndex;
  }

  isEntryHighlighted(entry: LeaderboardEntry): boolean {
    return this.highlightedUserIds.size > 0 && this.highlightedUserIds.has(entry.userId);
  }

  avatarUrl(entry: LeaderboardEntry): string | null {
    const raw = (entry.profilePicUrl || '').trim();
    return raw.length > 0 ? raw : null;
  }

  hasAvatar(entry: LeaderboardEntry): boolean {
    return !!this.avatarUrl(entry) && !this.avatarLoadErrorUserIds.has(entry.userId);
  }

  avatarInitial(entry: LeaderboardEntry): string {
    const source = (entry.username || entry.displayName || 'User').trim();
    return source.charAt(0).toUpperCase() || 'U';
  }

  onAvatarError(entry: LeaderboardEntry): void {
    this.avatarLoadErrorUserIds.add(entry.userId);
  }
}
