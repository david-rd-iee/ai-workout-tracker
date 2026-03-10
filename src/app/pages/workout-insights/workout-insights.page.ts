import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  IonButton,
  IonCard,
  IonCardContent,
  IonContent,
  IonHeader,
  IonTitle,
  IonToolbar,
  IonBackButton,
  IonButtons,
} from '@ionic/angular/standalone';
import { Health } from '@capgo/capacitor-health';
import { NgxChartsModule, ScaleType } from '@swimlane/ngx-charts';

@Component({
  selector: 'app-workout-insights',
  standalone: true,
  templateUrl: './workout-insights.page.html',
  styleUrls: ['./workout-insights.page.scss'],
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
export class WorkoutInsightsPage {
  healthStatus = 'Not connected';
  isConnectingHealth = false;

  latestHeartRate: number | null = null;
  latestHeartRateTime = '';

  avgHeartRate: number | null = null;
  maxHeartRate: number | null = null;

  heartRateChartData: { name: string; series: { name: string; value: number }[] }[] = [];

  chartView: [number, number] = [350, 220];

  colorScheme = {
    name: 'heartRateScheme',
    selectable: true,
    group: ScaleType.Ordinal,
    domain: ['#ff4d6d']
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

  get formattedHeartRateTime(): string {
    if (!this.latestHeartRateTime) return '';

    return new Date(this.latestHeartRateTime).toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
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

  async loadLatestHeartRate() {
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
  
      const validSamples = samples.filter((s: any) => typeof s?.value === 'number');
  
      if (validSamples.length === 0) {
        this.healthStatus = 'No valid heart rate samples';
        this.heartRateChartData = [];
        return;
      }
  
      const values = validSamples.map((s: any) => s.value);
      const sum = values.reduce((a: number, b: number) => a + b, 0);
  
      this.avgHeartRate = Math.round(sum / values.length);
      this.maxHeartRate = Math.round(Math.max(...values));
  
      const latestSample = validSamples[validSamples.length - 1] as any;
      this.latestHeartRate = latestSample?.value ?? null;
      this.latestHeartRateTime =
        latestSample?.endDate || latestSample?.startDate || '';
  
        this.heartRateChartData = [
            {
              name: 'Heart Rate',
              series: validSamples
                .sort((a: any, b: any) =>
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
}