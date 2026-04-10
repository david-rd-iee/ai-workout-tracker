import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import {
  IonBackButton,
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonItem,
  IonLabel,
  IonList,
  IonTitle,
  IonToolbar,
} from '@ionic/angular/standalone';
import { Auth } from '@angular/fire/auth';
import { onAuthStateChanged } from 'firebase/auth';
import type { WorkoutHistoryDateGroup } from '../../models/workout-history.model';
import { WorkoutSummaryService } from '../../services/workout-summary.service';

@Component({
  selector: 'app-workout-history',
  standalone: true,
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button defaultHref="/tabs/home"></ion-back-button>
        </ion-buttons>
        <ion-title>{{ pageTitle }}</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content class="ion-padding">
      <ion-button
        expand="block"
        fill="outline"
        (click)="viewInsights()"
        style="margin-bottom: 12px;"
      >
        Workout Insights
      </ion-button>

      <ion-button
        expand="block"
        (click)="viewCsv()"
        [disabled]="isLoading || historyGroups.length === 0"
        style="margin-bottom: 12px;"
      >
        View CSV
      </ion-button>

      <ion-list>
        <ion-item *ngIf="isLoading">
          <ion-label>Loading workouts...</ion-label>
        </ion-item>

        <ion-item *ngIf="!isLoading && historyGroups.length === 0">
          <ion-label>No workouts saved yet.</ion-label>
        </ion-item>

        <ion-item *ngFor="let day of historyGroups" button detail (click)="openSummary(day.date)">
          <ion-label class="ion-text-wrap">
            <p><strong>{{ day.date }}</strong></p>

            <div *ngIf="day.strength.length > 0" style="margin-top: 8px;">
              <p><strong>Strength:</strong></p>
              <div *ngFor="let entry of day.strength" style="margin-left: 12px;">
                <p><strong>{{ entry.exercise }}</strong></p>
                <p style="margin-left: 12px;">Sets: {{ entry.sets }}</p>
                <p style="margin-left: 12px;">Reps: {{ entry.reps }}</p>
                <p style="margin-left: 12px;">Weights: {{ entry.weights }}</p>
                <p style="margin-left: 12px;">Calories Burned: {{ entry.caloriesBurned }}</p>
              </div>
            </div>

            <div *ngIf="day.cardio.length > 0" style="margin-top: 8px;">
              <p><strong>Cardio:</strong></p>
              <div *ngFor="let entry of day.cardio" style="margin-left: 12px;">
                <p><strong>{{ entry.exercise }}</strong></p>
                <p style="margin-left: 12px;">Distance: {{ entry.distance || 'N/A' }}</p>
                <p style="margin-left: 12px;">Time: {{ entry.time || 'N/A' }}</p>
                <p style="margin-left: 12px;">Calories Burned: {{ entry.caloriesBurned }}</p>
              </div>
            </div>

            <div *ngIf="day.other.length > 0" style="margin-top: 8px;">
              <p><strong>Other:</strong></p>
              <div *ngFor="let entry of day.other" style="margin-left: 12px;">
                <p><strong>{{ entry.exercise }}</strong></p>
                <p style="margin-left: 12px;">Details: {{ entry.details }}</p>
                <p style="margin-left: 12px;">Calories Burned: {{ entry.caloriesBurned }}</p>
              </div>
            </div>

            <p style="margin-top: 10px;">
              <strong>Total Calories Burned:</strong> {{ day.totalCaloriesBurned }}
            </p>

            <p *ngIf="day.trainerNotes" style="margin-top: 8px;">
              <strong>Trainer Notes:</strong> {{ day.trainerNotes }}
            </p>
          </ion-label>
        </ion-item>
      </ion-list>
    </ion-content>
  `,
  imports: [
    CommonModule,
    IonContent,
    IonHeader,
    IonTitle,
    IonToolbar,
    IonButtons,
    IonBackButton,
    IonList,
    IonItem,
    IonLabel,
    IonButton,
  ],
})
export class WorkoutHistoryPage implements OnInit {
  historyGroups: WorkoutHistoryDateGroup[] = [];
  isLoading = false;
  pageTitle = 'Workout History';
  private requestedUserId = '';
  private clientName = '';

  constructor(
    private auth: Auth,
    private route: ActivatedRoute,
    private router: Router,
    private workoutSummaryService: WorkoutSummaryService
  ) {}

  async ngOnInit(): Promise<void> {
    this.isLoading = true;

    try {
      this.requestedUserId = (this.route.snapshot.queryParamMap.get('userId') || '').trim();
      this.clientName = (this.route.snapshot.queryParamMap.get('clientName') || '').trim();
      this.pageTitle = this.clientName ? `${this.clientName} Workout History` : 'Workout History';

      const targetUserId = this.requestedUserId || await this.resolveCurrentUserId();
      if (!targetUserId) {
        this.historyGroups = [];
        return;
      }

      const summaries = await this.workoutSummaryService.listRecentWorkoutSummaries(targetUserId, 20);
      this.historyGroups = summaries.map((summary) => this.workoutSummaryService.toHistoryGroup(summary));
    } catch (error) {
      console.error('Failed to load workout summaries:', error);
      this.historyGroups = [];
    } finally {
      this.isLoading = false;
    }
  }

  viewCsv(): void {
    void this.router.navigate(['/workout-history-csv'], {
      queryParams: {
        ...(this.requestedUserId ? { userId: this.requestedUserId } : {}),
        ...(this.clientName ? { clientName: this.clientName } : {}),
      },
      state: {
        historyGroups: this.historyGroups,
      },
    });
  }

  viewInsights(): void {
    void this.router.navigate(['/workout-insights'], {
      queryParams: {
        ...(this.requestedUserId ? { userId: this.requestedUserId } : {}),
        ...(this.clientName ? { clientName: this.clientName } : {}),
      },
    });
  }

  openSummary(date: string): void {
    void this.router.navigate(['/workout-summary'], {
      queryParams: {
        date,
        ...(this.requestedUserId ? { userId: this.requestedUserId } : {}),
        ...(this.clientName ? { clientName: this.clientName } : {}),
      },
      state: {
        backHref: '/workout-history',
        backQueryParams: {
          ...(this.requestedUserId ? { userId: this.requestedUserId } : {}),
          ...(this.clientName ? { clientName: this.clientName } : {}),
        },
      },
    });
  }

  private async resolveCurrentUserId(): Promise<string> {
    const currentUser = this.auth.currentUser;
    if (currentUser?.uid) {
      return currentUser.uid;
    }

    const authUser = await new Promise<{ uid?: string } | null>((resolve) => {
      const unsubscribe = onAuthStateChanged(this.auth as never, (user) => {
        unsubscribe();
        resolve(user);
      });
    });

    return authUser?.uid?.trim() || '';
  }
}
