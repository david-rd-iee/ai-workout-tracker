import { Component, HostListener, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import {
  IonButton,
  IonCard,
  IonCardContent,
  IonContent,
} from '@ionic/angular/standalone';
import { Health } from '@capgo/capacitor-health';
import { NgxChartsModule, ScaleType } from '@swimlane/ngx-charts';
import { HeaderComponent } from '../../components/header/header.component';

@Component({
  selector: 'app-workout-insights',
  standalone: true,
  templateUrl: './workout-insights.page.html',
  styleUrls: ['./workout-insights.page.scss'],
  imports: [
    CommonModule,
    HeaderComponent,
    IonContent,
    IonButton,
    IonCard,
    IonCardContent,
    NgxChartsModule,
  ],
})
export class WorkoutInsightsPage implements OnInit {
  backHref = '/workout-history';
  healthStatus = 'Not connected';
  isConnectingHealth = false;

  latestHeartRate: number | null = null;
  latestHeartRateTime = '';

  avgHeartRate: number | null = null;
  maxHeartRate: number | null = null;

  heartRateChartData: { name: string; series: { name: string; value: number }[] }[] = [];

  chartView: [number, number] = [600, 240];

  colorScheme = {
    name: 'heartRateScheme',
    selectable: true,
    group: ScaleType.Ordinal,
    domain: ['#2e6ef5'],
  };

  showXAxis = true;
  showYAxis = true;
  gradient = false;
  showLegend = false;

  showXAxisLabel = true;
  xAxisLabel = 'Time';

  showYAxisLabel = true;
  yAxisLabel = 'Heart Rate (BPM)';

  autoScale = true;

  constructor(private route: ActivatedRoute) {}

  ngOnInit(): void {
    const requestedUserId = (this.route.snapshot.queryParamMap.get('userId') || '').trim();
    const clientName = (this.route.snapshot.queryParamMap.get('clientName') || '').trim();
    this.backHref = this.buildBackHref(requestedUserId, clientName);
    this.updateChartView();
  }

  @HostListener('window:resize')
  onWindowResize(): void {
    this.updateChartView();
  }

  get formattedHeartRateTime(): string {
    if (!this.latestHeartRateTime) {
      return '';
    }

    return new Date(this.latestHeartRateTime).toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  }

  async connectAppleHealth(): Promise<void> {
    if (this.isConnectingHealth) {
      return;
    }

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

  async loadLatestHeartRate(): Promise<void> {
    try {
      const endDate = new Date();
      const startDate = new Date(Date.now() - 24 * 60 * 60 * 1000);

      const { samples } = await Health.readSamples({
        dataType: 'heartRate',
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        limit: 50,
      });

      if (!samples || samples.length === 0) {
        this.healthStatus = 'No heart rate samples found';
        this.avgHeartRate = null;
        this.maxHeartRate = null;
        this.latestHeartRate = null;
        this.latestHeartRateTime = '';
        this.heartRateChartData = [];
        return;
      }

      const validSamples = samples.filter((sample: unknown) => {
        const record = sample as { value?: unknown };
        return typeof record.value === 'number';
      });

      if (validSamples.length === 0) {
        this.healthStatus = 'No valid heart rate samples';
        this.heartRateChartData = [];
        return;
      }

      const values = validSamples.map((sample: any) => sample.value as number);
      const sum = values.reduce((a, b) => a + b, 0);

      this.avgHeartRate = Math.round(sum / values.length);
      this.maxHeartRate = Math.round(Math.max(...values));

      const latestSample = validSamples[validSamples.length - 1] as any;
      this.latestHeartRate = latestSample?.value ?? null;
      this.latestHeartRateTime = latestSample?.endDate || latestSample?.startDate || '';

      this.heartRateChartData = [
        {
          name: 'Heart Rate',
          series: validSamples
            .sort(
              (a: any, b: any) =>
                new Date(a.endDate || a.startDate).getTime() -
                new Date(b.endDate || b.startDate).getTime()
            )
            .map((sample: any) => ({
              name: new Date(sample.endDate || sample.startDate).toLocaleTimeString([], {
                hour: 'numeric',
                minute: '2-digit',
              }),
              value: sample.value,
            })),
        },
      ];

      this.healthStatus = 'Apple Health connected';
    } catch (error) {
      console.error('Heart rate read error:', error);
      this.healthStatus = 'Failed to load heart rate';
    }
  }

  private updateChartView(): void {
    if (typeof window === 'undefined') {
      return;
    }

    const width = Math.min(Math.max(window.innerWidth - 64, 280), 760);
    this.chartView = [width, 240];
  }

  private buildBackHref(userId: string, clientName: string): string {
    const params = new URLSearchParams();
    if (userId) {
      params.set('userId', userId);
    }
    if (clientName) {
      params.set('clientName', clientName);
    }

    const query = params.toString();
    return query ? `/workout-history?${query}` : '/workout-history';
  }
}
