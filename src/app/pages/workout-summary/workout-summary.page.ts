import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Params, Router } from '@angular/router';
import { NavController } from '@ionic/angular';
import {
  IonButton,
  IonCard,
  IonCardContent,
  IonCardHeader,
  IonContent,
} from '@ionic/angular/standalone';
import { Auth } from '@angular/fire/auth';
import { onAuthStateChanged } from 'firebase/auth';
import {
  CardioTrainingRow,
  OtherTrainingRow,
  WorkoutSessionPerformance,
  WorkoutTrainingRow,
} from '../../models/workout-session.model';
import { createEmptyWorkoutSessionPerformance } from '../../adapters/workout-event.adapters';
import { WorkoutSummaryService } from '../../services/workout-summary.service';
import { HeaderComponent } from '../../components/header/header.component';

@Component({
  selector: 'app-workout-summary',
  templateUrl: './workout-summary.page.html',
  styleUrls: ['./workout-summary.page.scss'],
  standalone: true,
  imports: [
    HeaderComponent,
    IonContent,
    IonCard,
    IonCardHeader,
    IonCardContent,
    IonButton,
    CommonModule,
  ],
})
export class WorkoutSummaryPage implements OnInit {
  loggedAt: Date | null = null;
  backHref = '/workout-chatbot';
  backQueryParams: Params | null = null;
  headerBackHref = '/workout-chatbot';
  summary: WorkoutSessionPerformance = createEmptyWorkoutSessionPerformance();

  constructor(
    private router: Router,
    private route: ActivatedRoute,
    private navCtrl: NavController,
    private auth: Auth,
  private workoutSummaryService: WorkoutSummaryService
  ) {
    const navigation = this.router.getCurrentNavigation();
    const incomingSummary = navigation?.extras.state?.['summary'];
    const incomingLoggedAt = navigation?.extras.state?.['loggedAt'];
    const incomingBackHref = navigation?.extras.state?.['backHref'];
    const incomingBackQueryParams = navigation?.extras.state?.['backQueryParams'];

    if (incomingSummary) {
      this.summary = incomingSummary as WorkoutSessionPerformance;
    }
    if (typeof incomingBackHref === 'string' && incomingBackHref.trim()) {
      this.backHref = incomingBackHref;
    }
    if (incomingBackQueryParams && typeof incomingBackQueryParams === 'object') {
      this.backQueryParams = incomingBackQueryParams as Params;
    }
    this.loggedAt = this.toLoggedAtDate(incomingLoggedAt);
    this.updateHeaderBackHref();
  }

  async ngOnInit(): Promise<void> {
    if (this.summary.trainingRows.length > 0) {
      return;
    }

    const summaryDate = (this.route.snapshot.queryParamMap.get('date') || '').trim();
    if (!summaryDate) {
      return;
    }

    const requestedUserId = (this.route.snapshot.queryParamMap.get('userId') || '').trim();
    const clientName = (this.route.snapshot.queryParamMap.get('clientName') || '').trim();
    if (!this.backQueryParams) {
      this.backHref = '/workout-history';
      this.backQueryParams = {
        ...(requestedUserId ? { userId: requestedUserId } : {}),
        ...(clientName ? { clientName } : {}),
      };
      this.updateHeaderBackHref();
    }

    const targetUserId = requestedUserId || await this.resolveCurrentUserId();
    if (!targetUserId) {
      return;
    }

    try {
      const persistedSummary = await this.workoutSummaryService.getWorkoutSummary(targetUserId, summaryDate);
      if (!persistedSummary) {
        return;
      }

      this.summary = this.workoutSummaryService.toWorkoutSessionPerformance(persistedSummary);
      this.loggedAt = this.workoutSummaryService.toLoggedAtDate(persistedSummary);
    } catch (error) {
      console.error('Failed to load workout summary:', error);
    }
  }

  navigateToGroups(): void {
    void this.router.navigate(['/tabs/groups']);
  }

  navigateToLeaderboard(): void {
    void this.router.navigate(['/tabs/leaderboard']);
  }

  navigateToHome(): void {
    this.navCtrl.navigateRoot('/tabs/home', {
      animated: true,
      animationDirection: 'forward',
    });
  }

  get loggedDateLabel(): string {
    if (this.loggedAt) {
      return this.loggedAt.toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      });
    }

    const fallbackDate = new Date(`${this.summary.date}T12:00:00`);
    if (Number.isNaN(fallbackDate.getTime())) {
      return '';
    }

    return fallbackDate.toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });
  }

  get loggedTimeLabel(): string {
    if (!this.loggedAt) {
      return '';
    }

    return this.loggedAt.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
    });
  }

  get strengthRows(): WorkoutTrainingRow[] {
    const rows = this.summary.strengthTrainingRow;
    if (Array.isArray(rows) && rows.length > 0) {
      return rows;
    }

    return this.summary.trainingRows.filter((row) => row.Training_Type === 'Strength');
  }

  get cardioRows(): CardioTrainingRow[] {
    const rows = this.summary.cardioTrainingRow;
    if (Array.isArray(rows) && rows.length > 0) {
      return rows;
    }

    return this.summary.trainingRows
      .filter((row) => row.Training_Type === 'Cardio')
      .map((row) => ({
        Training_Type: 'Cardio',
        estimated_calories: row.estimated_calories,
        cardio_type: row.exercise_type,
        display_time: row.reps > 0 ? `${row.reps} min` : undefined,
        time_minutes: row.reps,
      }));
  }

  get otherRows(): OtherTrainingRow[] {
    const rows = this.summary.otherTrainingRow;
    if (Array.isArray(rows) && rows.length > 0) {
      return rows;
    }

    return this.summary.trainingRows
      .filter((row) => row.Training_Type === 'Other')
      .map((row) => ({
        Training_Type: 'Other',
        estimated_calories: row.estimated_calories,
        exercise_type: row.exercise_type,
        sets: row.sets,
        reps: row.reps,
        displayed_weights_metric: row.displayed_weights_metric,
        weights_kg: row.weights_kg,
      }));
  }

  formatOtherExerciseName(row: OtherTrainingRow): string {
    return this.formatExerciseName(
      String(row['exercise_type'] ?? row['activity'] ?? row['name'] ?? 'other_activity')
    );
  }

  formatExerciseName(value: string): string {
    return String(value ?? '')
      .split('_')
      .filter(Boolean)
      .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
      .join(' ');
  }

  formatWeight(row: WorkoutTrainingRow): string {
    const displayMetric = String(row.displayed_weights_metric ?? '').trim();
    if (displayMetric) {
      return displayMetric.toLowerCase().includes('body') ? 'bodyweight' : displayMetric;
    }

    return 'bodyweight';
  }

  formatCardioDistance(row: CardioTrainingRow): string {
    const text = this.readText(
      row.display_distance ??
      row['distance_input'] ??
      row['distanceText'] ??
      row['distance_text']
    );
    if (text) {
      return text;
    }

    return 'N/A';
  }

  formatCardioTime(row: CardioTrainingRow): string {
    const text = this.readText(
      row.display_time ??
      row['time_input'] ??
      row['timeText'] ??
      row['time_text']
    );
    if (text) {
      return text;
    }

    return 'N/A';
  }

  formatOtherDetails(row: OtherTrainingRow): string {
    const sets = this.toRoundedNonNegative(row['sets']);
    const reps = this.toRoundedNonNegative(row['reps'] ?? row['time']);
    const weights = this.readText(
      row['displayed_weights_metric'] ?? row['weights'] ?? row['weight'] ?? row['load']
    ) || 'bodyweight';

    if (sets > 0 || reps > 0) {
      return `${sets} x ${reps} @ ${weights}`;
    }

    return this.readText(row['activity'] ?? row['name'] ?? row['type']) || 'Activity logged';
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

  private toLoggedAtDate(value: unknown): Date | null {
    if (typeof value === 'string') {
      const parsed = new Date(value);
      if (!Number.isNaN(parsed.getTime())) {
        return parsed;
      }
    }

    return null;
  }

  private updateHeaderBackHref(): void {
    if (!this.backQueryParams || Object.keys(this.backQueryParams).length === 0) {
      this.headerBackHref = this.backHref;
      return;
    }

    const params = new URLSearchParams();
    Object.entries(this.backQueryParams).forEach(([key, rawValue]) => {
      if (Array.isArray(rawValue)) {
        rawValue
          .map((value) => String(value).trim())
          .filter((value) => value.length > 0)
          .forEach((value) => params.append(key, value));
        return;
      }

      const value = String(rawValue ?? '').trim();
      if (value.length > 0) {
        params.set(key, value);
      }
    });

    const query = params.toString();
    this.headerBackHref = query ? `${this.backHref}?${query}` : this.backHref;
  }

  private toRoundedNonNegative(value: unknown): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) {
      return 0;
    }

    return Math.round(parsed);
  }

  private readText(value: unknown): string {
    if (typeof value !== 'string') {
      return '';
    }

    return value.trim();
  }
}
