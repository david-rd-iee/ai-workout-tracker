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
import { Health } from '@capgo/capacitor-health';

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
  healthStatus = 'Not connected';
  isConnectingHealth = false;

  sessionStarted = false;
  sessionStartTime: number | null = null;
  elapsedSeconds = 0;

  currentHeartRate: number | null = null;
  avgHeartRate: number | null = null;
  maxHeartRate: number | null = null;

  timerInterval: any = null;
  heartRateInterval: any = null;

  heartRateSamples: { timestamp: string; value: number }[] = [];

  heartRateChartData: { name: string; series: { name: string; value: number }[] }[] = [];

  chartView: [number, number] = [300, 220];
  showXAxis = true;
  showYAxis = true;
  gradient = false;
  showLegend = false;
  showXAxisLabel = true;
  xAxisLabel = 'Time';
  showYAxisLabel = true;
  yAxisLabel = 'Heart Rate (BPM)';
  autoScale = true;
  xAxisTickFormatting = (value: string) => value;
  yAxisTickFormatting = (value: number) => `${Math.round(value)}`;

  colorScheme = {
    name: 'heartRateScheme',
    selectable: true,
    group: ScaleType.Ordinal,
    domain: ['#ff4d6d']
  };

  get formattedElapsedTime(): string {
    const hrs = Math.floor(this.elapsedSeconds / 3600);
    const mins = Math.floor((this.elapsedSeconds % 3600) / 60);
    const secs = this.elapsedSeconds % 60;

    return [hrs, mins, secs]
      .map((unit) => unit.toString().padStart(2, '0'))
      .join(':');
  }

  async connectAppleHealth() {
    if (this.isConnectingHealth) return;

    this.isConnectingHealth = true;
    this.healthStatus = 'Connecting...';

    try {
      await Health.requestAuthorization({
        read: ['heartRate'],
        write: [],
      });

      this.healthStatus = 'Apple Health connected';
    } catch (error) {
      this.healthStatus = 'Apple Health connection failed';
      console.error('Apple Health authorization error:', error);
    } finally {
      this.isConnectingHealth = false;
    }
  }

  startSession() {
    if (this.sessionStarted) return;

    this.sessionStarted = true;
    this.sessionStartTime = Date.now();
    this.elapsedSeconds = 0;
    this.heartRateSamples = [];
    this.heartRateChartData = [];
    this.currentHeartRate = null;
    this.avgHeartRate = null;
    this.maxHeartRate = null;

    this.timerInterval = setInterval(() => {
      this.elapsedSeconds += 1;
    }, 1000);

    this.fetchLatestHeartRate();
    this.heartRateInterval = setInterval(() => {
      this.fetchLatestHeartRate();
    }, 5000);
  }

  async fetchLatestHeartRate() {
    try {
      const endDate = new Date();
      const startDate = new Date(Date.now() - 10 * 60 * 1000);
  
      const { samples } = await Health.readSamples({
        dataType: 'heartRate',
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        limit: 10,
      });
  
      if (!samples || samples.length === 0) {
        return;
      }
  
      const validSamples = samples
        .filter((s: any) => typeof s?.value === 'number')
        .sort(
          (a: any, b: any) =>
            new Date(a.endDate || a.startDate).getTime() -
            new Date(b.endDate || b.startDate).getTime()
        );
  
      if (validSamples.length === 0) return;
  
      const latestSample = validSamples[validSamples.length - 1];
      const latestValue = Math.round(latestSample.value);

      console.log('Latest Health sample:', {
        timestamp: latestSample.endDate || latestSample.startDate,
        value: latestSample.value,
      });
  
      this.currentHeartRate = latestValue;
  
      this.heartRateSamples.push({
        timestamp: new Date().toISOString(),
        value: latestValue,
      });
  
      const values = this.heartRateSamples.map((s) => s.value);
      const sum = values.reduce((a, b) => a + b, 0);
  
      this.avgHeartRate = Math.round(sum / values.length);
      this.maxHeartRate = Math.round(Math.max(...values));
  
      const recentSamples = this.heartRateSamples.slice(-10);

      this.heartRateChartData = [
        {
          name: 'Heart Rate',
          series: recentSamples.map((sample) => ({
            name: new Date(sample.timestamp).toLocaleTimeString([], {
              minute: '2-digit',
              second: '2-digit',
            }),
            value: Math.round(sample.value),
          })),
        },
      ];
    } catch (error) {
      console.error('Live heart rate fetch error:', error);
    }
  }

  finishSession() {
    this.stopIntervals();
    this.sessionStarted = false;
    console.log('Session finished', {
      durationSeconds: this.elapsedSeconds,
      avgHeartRate: this.avgHeartRate,
      maxHeartRate: this.maxHeartRate,
      samples: this.heartRateSamples,
    });
  }

  private stopIntervals() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }

    if (this.heartRateInterval) {
      clearInterval(this.heartRateInterval);
      this.heartRateInterval = null;
    }
  }

  ngOnDestroy(): void {
    this.stopIntervals();
  }
}