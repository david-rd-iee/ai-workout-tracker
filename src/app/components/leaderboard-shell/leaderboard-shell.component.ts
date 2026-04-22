import { CommonModule } from '@angular/common';
import {
  AfterViewInit,
  Component,
  ElementRef,
  EventEmitter,
  HostListener,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  SimpleChanges,
  ViewChild,
} from '@angular/core';
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
import { arrowBackOutline, checkmarkCircle, settingsOutline } from 'ionicons/icons';
import { Color, NgxChartsModule, ScaleType } from '@swimlane/ngx-charts';
import {
  LeaderboardEntry,
  LeaderboardTrendSeries,
  Metric,
} from '../../services/leaderboard.service';

export type LeaderboardScope = 'city' | 'state' | 'country';
export type LeaderboardChartMode = 'distribution' | 'trend';

export type DistributionPoint = {
  binIndex: number;
  xPercent: number;
  yPercent: number;
  count: number;
  userIds: string[];
  rangeLabel: string;
};

type DistributionChartDatum = {
  name: number;
  value: number;
};

type DistributionChartSeries = {
  name: string;
  series: DistributionChartDatum[];
};

@Component({
  selector: 'app-leaderboard-shell',
  standalone: true,
  templateUrl: './leaderboard-shell.component.html',
  styleUrls: ['./leaderboard-shell.component.scss'],
  imports: [
    CommonModule,
    FormsModule,
    NgxChartsModule,
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
export class LeaderboardShellComponent implements OnChanges, AfterViewInit, OnDestroy {
  @ViewChild('chartHost') chartHost?: ElementRef<HTMLElement>;

  readonly chartHorizontalInset = 20;
  readonly chartVerticalInset = 10;

  @Input() showTopbar = true;
  @Input() title = 'Leaderboard';
  @Input() graphLabel = 'Stats';
  @Input() loading = false;
  @Input() errorMsg = '';

  @Input() metric: Metric = 'total';
  @Input() scope: LeaderboardScope = 'city';
  @Input() showScopeSelect = false;

  @Input() entries: LeaderboardEntry[] = [];
  @Input() chartMode: LeaderboardChartMode = 'distribution';
  @Input() availableChartModes: LeaderboardChartMode[] = ['distribution'];
  @Input() trendSeries: LeaderboardTrendSeries[] = [];
  @Input() distributionCurvePath = '';
  @Input() distributionPoints: DistributionPoint[] = [];
  @Input() medianMarkerXPercent: number | null = null;
  @Input() medianMarkerLabel = '';
  @Input() selectedPointBin: number | null = null;
  @Input() highlightedUserIds = new Set<string>();
  @Input() showActionButton = false;
  @Input() actionIconName = 'settings-outline';
  @Input() actionAriaLabel = 'Open settings';

  @Output() back = new EventEmitter<void>();
  @Output() actionClick = new EventEmitter<void>();
  @Output() metricChange = new EventEmitter<Metric>();
  @Output() scopeChange = new EventEmitter<LeaderboardScope>();
  @Output() chartModeChange = new EventEmitter<LeaderboardChartMode>();
  @Output() distributionPointClick = new EventEmitter<DistributionPoint>();
  @Output() memberClick = new EventEmitter<LeaderboardEntry>();

  distributionChartResults: DistributionChartSeries[] = [];
  private distributionCurveSeries: DistributionChartDatum[] = [];
  distributionChartView: [number, number] = [390, 284];
  trendChartView: [number, number] = [350, 264];
  readonly chartXMin = 0;
  readonly chartXMax = 100;
  readonly chartYMin = 0;
  readonly chartYMax = 100;
  readonly chartBottomPercent = 92;
  readonly chartScaleType = ScaleType.Ordinal;
  readonly chartColorScheme: Color = {
    name: 'leaderboardDistribution',
    selectable: true,
    group: ScaleType.Ordinal,
    domain: ['#1a5ea4'],
  };
  readonly trendColorScheme: Color = {
    name: 'leaderboardTrend',
    selectable: true,
    group: ScaleType.Ordinal,
    domain: [
      '#1a5ea4',
      '#da811a',
      '#2f9e44',
      '#8b5cf6',
      '#d946ef',
      '#ef4444',
      '#14b8a6',
      '#f59e0b',
      '#7c3aed',
      '#0ea5e9',
    ],
  };

  avatarLoadErrorUserIds = new Set<string>();
  activeTrainerVerifiedUserId: string | null = null;

  constructor() {
    addIcons({ arrowBackOutline, settingsOutline, checkmarkCircle });
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['distributionCurvePath']) {
      this.distributionChartResults = this.buildChartResults(this.distributionCurvePath);
      this.queueChartResize();
    }
  }

  ngAfterViewInit(): void {
    this.syncChartView();
    this.queueChartResize();
  }

  ngOnDestroy(): void {}

  @HostListener('window:resize')
  onWindowResize(): void {
    this.syncChartView();
  }

  onMetricChange(value: Metric): void {
    this.metricChange.emit(value);
  }

  onScopeChange(value: LeaderboardScope): void {
    this.scopeChange.emit(value);
  }

  onChartModeChange(value: LeaderboardChartMode): void {
    if (!this.availableChartModes.includes(value) || value === this.chartMode) {
      return;
    }
    this.chartModeChange.emit(value);
  }

  chartEmptyMessage(): string {
    return this.chartMode === 'trend'
      ? 'Load players to view added-score trends.'
      : 'Load players to view the distribution.';
  }

  trendYAxisLabel(): string {
    return `Added ${this.metricLabel()} Score`;
  }

  trendXAxisTickFormatting = (value: string | number | Date): string => {
    const raw = String(value ?? '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      return raw;
    }

    const parsed = new Date(`${raw}T00:00:00`);
    if (Number.isNaN(parsed.getTime())) {
      return raw;
    }

    return parsed.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

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

  onDistributionPointTapped(event: MouseEvent, point: DistributionPoint): void {
    event.stopPropagation();
    this.distributionPointClick.emit(point);
  }

  onMemberRowClick(entry: LeaderboardEntry): void {
    this.memberClick.emit(entry);
  }

  onMemberRowKeydown(event: KeyboardEvent, entry: LeaderboardEntry): void {
    if (event.key !== 'Enter' && event.key !== ' ') {
      return;
    }
    event.preventDefault();
    this.memberClick.emit(entry);
  }

  onTrainerVerifiedPressed(event: Event, entry: LeaderboardEntry): void {
    event.stopPropagation();
    this.activeTrainerVerifiedUserId =
      this.activeTrainerVerifiedUserId === entry.userId ? null : entry.userId;
  }

  isTrainerVerifiedExpanded(entry: LeaderboardEntry): boolean {
    return this.activeTrainerVerifiedUserId === entry.userId;
  }

  trackByDistributionPoint(_: number, point: DistributionPoint): number {
    return point.binIndex;
  }

  dotTopPercent(point: DistributionPoint): number {
    return this.curveTopPercent(point.xPercent, point.yPercent);
  }

  hasMedianMarker(): boolean {
    return (
      this.medianMarkerXPercent !== null &&
      this.medianMarkerLabel.trim().length > 0 &&
      this.distributionChartResults.length > 0
    );
  }

  medianMarkerTopPercent(): number {
    if (this.medianMarkerXPercent === null) {
      return 100;
    }

    return this.chartBottomPercent;
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

  private buildChartResults(path: string): DistributionChartSeries[] {
    const series = this.parseCurvePath(path);
    this.distributionCurveSeries = series;
    if (series.length === 0) {
      return [];
    }

    return [
      {
        name: 'Score Distribution',
        series,
      },
    ];
  }

  private parseCurvePath(path: string): DistributionChartDatum[] {
    const series: DistributionChartDatum[] = [];
    const segmentPattern = /(?:M|L)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/g;
    let match: RegExpExecArray | null = segmentPattern.exec(path);

    while (match) {
      const xPercent = Number(match[1]);
      const yPercent = Number(match[2]);

      if (!Number.isFinite(xPercent) || !Number.isFinite(yPercent)) {
        match = segmentPattern.exec(path);
        continue;
      }

      series.push({
        name: Number(xPercent.toFixed(2)),
        value: Number(Math.max(0, 100 - yPercent).toFixed(4)),
      });

      match = segmentPattern.exec(path);
    }

    return series;
  }

  private interpolateCurveValue(xPercent: number): number | null {
    const series = this.distributionCurveSeries;
    if (series.length === 0) {
      return null;
    }

    if (xPercent <= series[0].name) {
      return series[0].value;
    }

    const last = series[series.length - 1];
    if (xPercent >= last.name) {
      return last.value;
    }

    for (let i = 1; i < series.length; i += 1) {
      const prev = series[i - 1];
      const next = series[i];
      if (xPercent > next.name) {
        continue;
      }

      const deltaX = next.name - prev.name;
      if (deltaX <= 1e-6) {
        return next.value;
      }

      const t = (xPercent - prev.name) / deltaX;
      return prev.value + (next.value - prev.value) * t;
    }

    return last.value;
  }

  private curveTopPercent(xPercent: number, fallbackYPercent?: number): number {
    const interpolated = this.interpolateCurveValue(xPercent);
    if (interpolated === null) {
      return fallbackYPercent ?? 100;
    }

    return 100 - interpolated;
  }

  private syncChartView(): void {
    const host = this.chartHost?.nativeElement;
    if (!host) {
      return;
    }

    const width = Math.max(230, Math.floor(host.clientWidth));
    const height = Math.max(200, Math.floor(host.clientHeight));
    this.distributionChartView = [
      width + this.chartHorizontalInset * 2,
      height + this.chartVerticalInset * 2,
    ];
    this.trendChartView = [width, height];
  }

  private queueChartResize(): void {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => this.syncChartView());
    }
  }
}
