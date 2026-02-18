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
import { arrowBackOutline } from 'ionicons/icons';
import { Color, NgxChartsModule, ScaleType } from '@swimlane/ngx-charts';
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

  @Input() showTopbar = true;
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
  @Output() memberClick = new EventEmitter<LeaderboardEntry>();

  distributionChartResults: DistributionChartSeries[] = [];
  chartView: [number, number] = [320, 170];
  readonly chartScaleType = ScaleType.Ordinal;
  readonly chartColorScheme: Color = {
    name: 'leaderboardDistribution',
    selectable: true,
    group: ScaleType.Ordinal,
    domain: ['#1a5ea4'],
  };

  avatarLoadErrorUserIds = new Set<string>();

  constructor() {
    addIcons({ arrowBackOutline });
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

  trackByDistributionPoint(_: number, point: DistributionPoint): number {
    return point.binIndex;
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
    if (series.length === 0) {
      return [];
    }

    return [
      {
        name: 'Normal Distribution',
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

  private syncChartView(): void {
    const host = this.chartHost?.nativeElement;
    if (!host) {
      return;
    }

    const width = Math.max(220, Math.floor(host.clientWidth));
    this.chartView = [width, 170];
  }

  private queueChartResize(): void {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => this.syncChartView());
    }
  }
}
