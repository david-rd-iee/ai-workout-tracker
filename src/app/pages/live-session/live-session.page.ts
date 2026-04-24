import { Component, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  IonButton,
  IonButtons,
  IonCard,
  IonCardContent,
  IonContent,
  IonHeader,
  IonTitle,
  IonToolbar,
  IonBackButton,
} from '@ionic/angular/standalone';
import { NgxChartsModule, ScaleType } from '@swimlane/ngx-charts';
import { Preferences } from '@capacitor/preferences';

@Component({
  selector: 'app-live-session',
  standalone: true,
  templateUrl: './live-session.page.html',
  styleUrls: ['./live-session.page.scss'],
  imports: [
    CommonModule,
    IonContent,
    IonHeader,
    IonTitle,
    IonToolbar,
    IonButton,
    IonCard,
    IonCardContent,
    IonBackButton,
    IonButtons,
    NgxChartsModule,
  ],
})
export class LiveSessionPage implements OnDestroy {
  sessionStarted = false;
  elapsedSeconds = 0;

  currentHeartRate: number | null = null;
  displayedHeartRate: number | null = null;
  avgHeartRate: number | null = null;
  maxHeartRate: number | null = null;

  timerInterval: any = null;
  watchHeartRateInterval: any = null;
  smoothingInterval: any = null;

  lastWatchTimestamp: number | null = null;

  heartRateSamples: { timestamp: number; value: number }[] = [];
  heartRateChartData: { name: string; series: { name: string; value: number }[] }[] = [];

  chartView: [number, number] = [300, 160];
  showXAxis = true;
  showYAxis = true;
  gradient = false;
  showLegend = false;
  showXAxisLabel = true;
  xAxisLabel = 'Time';
  showYAxisLabel = true;
  yAxisLabel = 'Heart Rate (BPM)';
  autoScale = false;
  xAxisTickFormatting = (value: string) => value;
  yAxisTickFormatting = (value: number) => `${Math.round(value)}`;
  yScaleMin = 60;
  yScaleMax = 180;

  colorScheme = {
    name: 'heartRateScheme',
    selectable: true,
    group: ScaleType.Ordinal,
    domain: ['#ff4d6d']
  };

  estimatedMaxHeartRate = 190;

  get formattedElapsedTime(): string {
    const hrs = Math.floor(this.elapsedSeconds / 3600);
    const mins = Math.floor((this.elapsedSeconds % 3600) / 60);
    const secs = this.elapsedSeconds % 60;

    return [hrs, mins, secs]
      .map((unit) => unit.toString().padStart(2, '0'))
      .join(':');
  }

  get heartRatePercent(): number | null {
    if (this.displayedHeartRate === null) return null;
    return Math.round((this.displayedHeartRate / this.estimatedMaxHeartRate) * 100);
  }

  get currentZone() {
    if (this.displayedHeartRate === null) {
      return {
        name: 'No Zone',
        color: '#9ca3af',
        percent: 0,
      };
    }

    const pct = this.displayedHeartRate / this.estimatedMaxHeartRate;

    if (pct < 0.60) {
      return { name: 'Warm Up', color: '#60a5fa', percent: Math.round(pct * 100) };
    }
    if (pct < 0.70) {
      return { name: 'Fat Burn', color: '#34d399', percent: Math.round(pct * 100) };
    }
    if (pct < 0.80) {
      return { name: 'Aerobic', color: '#f59e0b', percent: Math.round(pct * 100) };
    }
    if (pct < 0.90) {
      return { name: 'Anaerobic', color: '#f97316', percent: Math.round(pct * 100) };
    }

    return { name: 'Max Effort', color: '#ef4444', percent: Math.round(pct * 100) };
  }

  startSession() {
    if (this.sessionStarted) return;

    this.sessionStarted = true;
    this.elapsedSeconds = 0;
    this.currentHeartRate = null;
    this.displayedHeartRate = null;
    this.avgHeartRate = null;
    this.maxHeartRate = null;
    this.heartRateSamples = [];
    this.heartRateChartData = [];
    this.lastWatchTimestamp = null;
    this.colorScheme = {
      ...this.colorScheme,
      domain: ['#ff4d6d']
    };

    this.timerInterval = setInterval(() => {
      this.elapsedSeconds += 1;
    }, 1000);

    void this.readLatestWatchHeartRate();

    this.watchHeartRateInterval = setInterval(() => {
      void this.readLatestWatchHeartRate();
    }, 1000);

    this.smoothingInterval = setInterval(() => {
      this.smoothHeartRate();
    }, 1000);
  }

  async readLatestWatchHeartRate() {
    try {
      const hrResult = await Preferences.get({ key: 'latestWatchHeartRate' });
      const tsResult = await Preferences.get({ key: 'latestWatchHeartRateTimestamp' });

      if (!hrResult.value || !tsResult.value) return;

      const heartRate = Number(hrResult.value);
      const timestamp = Number(tsResult.value);

      if (!heartRate || !timestamp) return;

      this.currentHeartRate = heartRate;

      if (this.lastWatchTimestamp === timestamp) {
        return;
      }

      this.lastWatchTimestamp = timestamp;

      const values = [...this.heartRateSamples.map((s) => s.value), heartRate];
      const sum = values.reduce((a, b) => a + b, 0);

      this.avgHeartRate = Math.round(sum / values.length);
      this.maxHeartRate = Math.round(Math.max(...values));

      if (this.displayedHeartRate === null) {
        this.displayedHeartRate = heartRate;
      }

      this.updateChart();
    } catch (error) {
      console.error('Error reading watch heart rate:', error);
    }
  }

  smoothHeartRate() {
    if (this.currentHeartRate === null) return;

    if (this.displayedHeartRate === null) {
      this.displayedHeartRate = this.currentHeartRate;
    } else {
      const diff = this.currentHeartRate - this.displayedHeartRate;

      if (Math.abs(diff) <= 1) {
        this.displayedHeartRate = this.currentHeartRate;
      } else {
        this.displayedHeartRate += diff * 0.35;
      }
    }

    const displayValue = Math.round(this.displayedHeartRate);
    const now = Date.now() / 1000;

    const lastPoint = this.heartRateSamples[this.heartRateSamples.length - 1];

    if (!lastPoint || now - lastPoint.timestamp >= 1) {
      this.heartRateSamples.push({
        timestamp: now,
        value: displayValue,
      });

      if (this.heartRateSamples.length > 30) {
        this.heartRateSamples = this.heartRateSamples.slice(-30);
      }

      this.updateChart();
    }
  }

  updateChart() {
    const recentSamples = this.heartRateSamples.slice(-20);

    if (recentSamples.length === 0) return;

    const values = recentSamples.map((s) => s.value);
    const minVal = Math.min(...values);
    const maxVal = Math.max(...values);

    this.yScaleMin = Math.max(40, Math.floor(minVal - 5));
    this.yScaleMax = Math.ceil(maxVal + 5);

    this.colorScheme = {
      ...this.colorScheme,
      domain: [this.currentZone.color]
    };

    this.heartRateChartData = [
      {
        name: 'Heart Rate',
        series: recentSamples.map((sample) => ({
          name: new Date(sample.timestamp * 1000).toLocaleTimeString([], {
            minute: '2-digit',
            second: '2-digit',
          }),
          value: Math.round(sample.value),
        })),
      },
    ];
  }

  finishSession() {
    this.stopIntervals();
    this.sessionStarted = false;
  }

  private stopIntervals() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }

    if (this.watchHeartRateInterval) {
      clearInterval(this.watchHeartRateInterval);
      this.watchHeartRateInterval = null;
    }

    if (this.smoothingInterval) {
      clearInterval(this.smoothingInterval);
      this.smoothingInterval = null;
    }
  }

  ngOnDestroy(): void {
    this.stopIntervals();
  }
}
