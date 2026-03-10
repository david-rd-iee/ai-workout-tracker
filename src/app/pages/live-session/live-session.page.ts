import { Component, OnDestroy, OnInit } from '@angular/core';
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
import WorkoutSession from '../../services/workout-session.plugin';
import { PluginListenerHandle } from '@capacitor/core';

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
export class LiveSessionPage implements OnInit, OnDestroy {
  healthStatus = 'Not connected';
  isConnectingHealth = false;

  sessionStarted = false;
  sessionStartTime: number | null = null;
  elapsedSeconds = 0;

  currentHeartRate: number | null = null;
  avgHeartRate: number | null = null;
  maxHeartRate: number | null = null;

  timerInterval: any = null;
  heartRateListener: PluginListenerHandle | null = null;
  workoutStateListener: PluginListenerHandle | null = null;

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

  async ngOnInit() {
    // Check if HealthKit is available
    try {
      const { available } = await WorkoutSession.checkAvailability();
      if (!available) {
        this.healthStatus = 'HealthKit not available on this device';
      }
    } catch (error) {
      console.error('Error checking HealthKit availability:', error);
    }
  }

  async connectAppleHealth() {
    if (this.isConnectingHealth) return;

    this.isConnectingHealth = true;
    this.healthStatus = 'Connecting...';

    try {
      await WorkoutSession.requestAuthorization();
      this.healthStatus = 'Apple Health connected';
    } catch (error) {
      this.healthStatus = 'Apple Health connection failed';
      console.error('Apple Health authorization error:', error);
    } finally {
      this.isConnectingHealth = false;
    }
  }

  async startSession() {
    if (this.sessionStarted) return;

    this.sessionStarted = true;
    this.sessionStartTime = Date.now();
    this.elapsedSeconds = 0;
    this.heartRateSamples = [];
    this.heartRateChartData = [];
    this.currentHeartRate = null;
    this.avgHeartRate = null;
    this.maxHeartRate = null;

    // Start elapsed time timer
    this.timerInterval = setInterval(() => {
      this.elapsedSeconds += 1;
    }, 1000);

    // Set up real-time heart rate listener
    this.heartRateListener = await WorkoutSession.addListener(
      'heartRateUpdate',
      (data) => {
        this.handleHeartRateUpdate(data.heartRate, data.timestamp);
      }
    );

    // Set up workout state listener
    this.workoutStateListener = await WorkoutSession.addListener(
      'workoutStateChanged',
      (data) => {
        console.log('Workout state changed:', data.state);
      }
    );

    // Start the HKWorkoutSession
    try {
      await WorkoutSession.startWorkout();
      console.log('HKWorkoutSession started successfully');
    } catch (error) {
      console.error('Failed to start workout session:', error);
      this.healthStatus = 'Failed to start workout session';
      this.finishSession();
    }
  }

  handleHeartRateUpdate(heartRate: number, timestamp: string) {
    const roundedHeartRate = Math.round(heartRate);
    
    console.log('Real-time heart rate update:', {
      heartRate: roundedHeartRate,
      timestamp
    });

    this.currentHeartRate = roundedHeartRate;

    this.heartRateSamples.push({
      timestamp,
      value: roundedHeartRate,
    });

    // Calculate statistics
    const values = this.heartRateSamples.map((s) => s.value);
    const sum = values.reduce((a, b) => a + b, 0);

    this.avgHeartRate = Math.round(sum / values.length);
    this.maxHeartRate = Math.round(Math.max(...values));

    // Update chart with last 20 samples
    const recentSamples = this.heartRateSamples.slice(-20);

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
  }

  async finishSession() {
    // Stop HKWorkoutSession
    if (this.sessionStarted) {
      try {
        await WorkoutSession.stopWorkout();
        console.log('Workout saved to HealthKit');
      } catch (error) {
        console.error('Error stopping workout:', error);
      }
    }

    this.cleanup();
    this.sessionStarted = false;
    
    console.log('Session finished', {
      durationSeconds: this.elapsedSeconds,
      avgHeartRate: this.avgHeartRate,
      maxHeartRate: this.maxHeartRate,
      totalSamples: this.heartRateSamples.length,
    });
  }

  private async cleanup() {
    // Stop timer
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }

    // Remove listeners
    if (this.heartRateListener) {
      await this.heartRateListener.remove();
      this.heartRateListener = null;
    }

    if (this.workoutStateListener) {
      await this.workoutStateListener.remove();
      this.workoutStateListener = null;
    }
  }

  async ngOnDestroy() {
    if (this.sessionStarted) {
      await this.finishSession();
    } else {
      await this.cleanup();
    }
  }
}