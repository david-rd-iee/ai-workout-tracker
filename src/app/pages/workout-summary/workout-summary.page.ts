import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { NavController } from '@ionic/angular';
import {
  IonContent,
  IonHeader,
  IonTitle,
  IonToolbar,
  IonCard,
  IonCardHeader,
  IonCardContent,
  IonButton,
  IonButtons,
  IonIcon,
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { closeOutline } from 'ionicons/icons';
import {
  CardioTrainingRow,
  OtherTrainingRow,
  WorkoutSessionPerformance,
  WorkoutTrainingRow,
} from '../../models/workout-session.model';
import {
  createEmptyWorkoutSessionPerformance,
  workoutEventToWorkoutSessionPerformance,
  workoutSessionPerformanceToWorkoutEvent,
} from '../../adapters/workout-event.adapters';

@Component({
  selector: 'app-workout-summary',
  templateUrl: './workout-summary.page.html',
  styleUrls: ['./workout-summary.page.scss'],
  standalone: true,
  imports: [
    IonContent,
    IonHeader,
    IonTitle,
    IonToolbar,
    IonCard,
    IonCardHeader,
    IonCardContent,
    IonButton,
    IonButtons,
    IonIcon,
    CommonModule,
    FormsModule,
  ],
})
export class WorkoutSummaryPage implements OnInit {
  loggedAt: Date | null = null;
  backHref = '/workout-chatbot';
  summary: WorkoutSessionPerformance = createEmptyWorkoutSessionPerformance();

  constructor(private router: Router, private navCtrl: NavController) {
    addIcons({ closeOutline });

    const nav = this.router.getCurrentNavigation();
    const incoming = nav?.extras.state?.['summary'];
    const incomingLoggedAt = nav?.extras.state?.['loggedAt'];
    const incomingBackHref = nav?.extras.state?.['backHref'];
    if (incoming) {
      this.summary = this.normalizeSummary(incoming as Partial<WorkoutSessionPerformance>);
    }
    if (typeof incomingBackHref === 'string' && incomingBackHref.trim()) {
      this.backHref = incomingBackHref;
    }
    this.loggedAt = this.toLoggedAtDate(incomingLoggedAt, this.summary.date);
  }

  ngOnInit() {}

  goBackToChat() {
    this.navCtrl.navigateBack(this.backHref, {
      animated: true,
      animationDirection: 'back',
    });
  }

  navigateToGroups() {
    this.router.navigate(['/tabs/groups']);
  }

  navigateToLeaderboard() {
    this.router.navigate(['/tabs/leaderboard']);
  }

  navigateToHome() {
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

  private normalizeSummary(value: Partial<WorkoutSessionPerformance>): WorkoutSessionPerformance {
    return workoutEventToWorkoutSessionPerformance(
      workoutSessionPerformanceToWorkoutEvent(value)
    );
  }

  private toLoggedAtDate(value: unknown, _fallbackDate: string): Date | null {
    if (typeof value === 'string') {
      const parsed = new Date(value);
      if (!Number.isNaN(parsed.getTime())) {
        return parsed;
      }
    }

    return null;
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
