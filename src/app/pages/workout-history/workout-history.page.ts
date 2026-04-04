import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { Router } from '@angular/router';

import {
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
} from '@ionic/angular/standalone';

import { Auth } from '@angular/fire/auth';
import {
  Firestore,
  collection,
  query,
  orderBy,
  limit,
  getDocs,
} from '@angular/fire/firestore';

import { onAuthStateChanged } from 'firebase/auth';
import {
  workoutEventRecordToWorkoutEvent,
  workoutEventToWorkoutSessionPerformance,
} from '../../adapters/workout-event.adapters';

type WorkoutTrainingRow = {
  Training_Type: 'Strength' | 'Cardio' | 'Other';
  estimated_calories?: number;
  exercise_type: string;
  sets: number;
  reps: number;
  displayed_weights_metric?: string;
  weights_kg?: number;
  weights?: number | 'body weight';
  display_distance?: string;
  distance_meters?: number;
  display_time?: string;
  time_minutes?: number;
};

type WorkoutExerciseRow = { name: string; metric: string; volume: number };

type WorkoutLogDoc = {
  createdAt?: any;
  updatedAt?: any;
  date?: string;
  calories?: number;
  estimatedCalories?: number;
  estimated_calories?: number;
  totalVolume?: number;
  notes?: string;
  trainer_notes?: string;
  trainerNotes?: string;
  isComplete?: boolean;
  trainingRows?: WorkoutTrainingRow[];
  strengthTrainingRow?: unknown;
  cardioTrainingRow?: unknown;
  otherTrainingRow?: unknown;
  exercises?: WorkoutExerciseRow[];
};

type StrengthHistoryEntry = {
  exercise: string;
  sets: number;
  reps: number;
  weights: string;
  caloriesBurned: number;
};

type CardioHistoryEntry = {
  exercise: string;
  distance: string;
  time: string;
  caloriesBurned: number;
};

type OtherHistoryEntry = {
  exercise: string;
  details: string;
  caloriesBurned: number;
};

type WorkoutHistoryDateGroup = {
  date: string;
  strength: StrengthHistoryEntry[];
  cardio: CardioHistoryEntry[];
  other: OtherHistoryEntry[];
  totalCaloriesBurned: number;
  trainerNotes: string;
};

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

        <ion-item *ngFor="let day of historyGroups">
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
  workouts: WorkoutLogDoc[] = [];
  historyGroups: WorkoutHistoryDateGroup[] = [];
  isLoading = false;
  pageTitle = 'Workout History';

  constructor(
    private firestore: Firestore,
    private auth: Auth,
    private route: ActivatedRoute,
    private router: Router
  ) {}

  async ngOnInit() { //checkers, transform each workout to display 
    this.isLoading = true;
    try {
      const requestedUserId = (this.route.snapshot.queryParamMap.get('userId') || '').trim();
      const clientName = (this.route.snapshot.queryParamMap.get('clientName') || '').trim();
      this.pageTitle = clientName ? `${clientName} Workout History` : 'Workout History';

      const user = await new Promise<any>((resolve) => {
        const unsub = onAuthStateChanged(this.auth as any, (u) => {
          unsub();
          resolve(u);
        });
      });

      const targetUserId = requestedUserId || user?.uid || '';
      if (!targetUserId) {
        this.workouts = [];
        this.historyGroups = [];
        return;
      }

      const workoutEventsRef = collection(this.firestore, `users/${targetUserId}/workoutEvents`);
      const eventSnap = await getDocs(
        query(workoutEventsRef, orderBy('createdAt', 'desc'), limit(20))
      );

      this.workouts = eventSnap.docs
        .map((docSnap) => {
          const raw = docSnap.data() as Record<string, unknown>;
          const event = workoutEventRecordToWorkoutEvent(raw);
          const session = workoutEventToWorkoutSessionPerformance(event);
          return {
            ...session,
            createdAt: raw['createdAt'],
            updatedAt: raw['updatedAt'],
          } as WorkoutLogDoc;
        })
        .sort((left, right) => (
          this.toTimestampMillis(right.createdAt) - this.toTimestampMillis(left.createdAt)
        ));
      this.historyGroups = this.mergeHistoryGroupsByDate(
        this.workouts.map((workout) => this.toHistoryGroup(workout))
      );
    } catch (e) {
      console.error('Failed to load workout events:', e);
      this.workouts = [];
      this.historyGroups = [];
    } finally {
      this.isLoading = false;
    }
  }

  viewCsv() {
    const requestedUserId = (this.route.snapshot.queryParamMap.get('userId') || '').trim();
    const clientName = (this.route.snapshot.queryParamMap.get('clientName') || '').trim();
    this.router.navigate(['/workout-history-csv'], {
      queryParams: {
        userId: requestedUserId,
        clientName,
      },
      state: {
        historyGroups: this.historyGroups,
      },
    });
  }

  private toHistoryGroup(workout: WorkoutLogDoc): WorkoutHistoryDateGroup { //takes workout and formats to what the UI uses
    const date = this.resolveWorkoutDate(workout);
    const totalCalories = this.toRoundedNonNegative(
      workout.estimatedCalories ?? workout.estimated_calories ?? workout.calories
    );

    const trainingRows = Array.isArray(workout.trainingRows) ? workout.trainingRows : [];
    const calorieShares = this.resolveCalorieShares(trainingRows, totalCalories);

    const fallbackStrength: StrengthHistoryEntry[] = [];
    const fallbackCardio: CardioHistoryEntry[] = [];
    const fallbackOther: OtherHistoryEntry[] = [];

    trainingRows.forEach((row, index) => {
      const type = row.Training_Type ?? 'Other';
      const caloriesBurned = calorieShares[index] ?? 0;
      if (type === 'Strength') {
        fallbackStrength.push({
          exercise: this.toDisplayExerciseName(row.exercise_type),
          sets: this.toRoundedNonNegative(row.sets),
          reps: this.toRoundedNonNegative(row.reps),
          weights: this.formatWeight(row),
          caloriesBurned,
        });
        return;
      }

      if (type === 'Cardio') {
        fallbackCardio.push({
          exercise: this.toDisplayExerciseName(row.exercise_type),
          distance: '',
          time: this.toRoundedNonNegative(row.reps) > 0 ? `${this.toRoundedNonNegative(row.reps)} min` : '',
          caloriesBurned,
        });
        return;
      }

      fallbackOther.push({
        exercise: this.toDisplayExerciseName(row.exercise_type),
        details: `${this.toRoundedNonNegative(row.sets)} x ${this.toRoundedNonNegative(row.reps)} @ ${this.formatWeight(row)}`,
        caloriesBurned,
      });
    });

    const strengthStructured = this.toObjectArray(workout.strengthTrainingRow);
    const cardioStructured = this.toObjectArray(workout.cardioTrainingRow);
    const otherStructured = this.toObjectArray(workout.otherTrainingRow);

    const strength = strengthStructured.length > 0
      ? strengthStructured.map((row) => ({
          exercise: this.toDisplayExerciseName(String(row['exercise_type'] ?? row['exercise'] ?? 'strength_exercise')),
          sets: this.toRoundedNonNegative(row['sets']),
          reps: this.toRoundedNonNegative(row['reps']),
          weights: this.formatWeight(row),
          caloriesBurned: this.toRoundedNonNegative(row['estimated_calories']),
        }))
      : fallbackStrength;

    const cardio = cardioStructured.length > 0
      ? cardioStructured.map((row) => ({
          exercise: this.toDisplayExerciseName(
            String(row['cardio_type'] ?? row['exercise_type'] ?? row['type'] ?? 'cardio_activity')
          ),
          distance: this.resolveCardioDistanceText(row),
          time: this.resolveCardioTimeText(row),
          caloriesBurned: this.toRoundedNonNegative(row['estimated_calories']),
        }))
      : fallbackCardio;

    const other = otherStructured.length > 0
      ? otherStructured.map((row) => ({
          exercise: this.toDisplayExerciseName(
            String(row['exercise_type'] ?? row['activity'] ?? row['name'] ?? 'other_activity')
          ),
          details: this.resolveOtherDetails(row),
          caloriesBurned: this.toRoundedNonNegative(row['estimated_calories']),
        }))
      : fallbackOther;

    if (strength.length === 0 && cardio.length === 0 && other.length === 0) {
      const legacyExercises = workout.exercises ?? [];
      legacyExercises.forEach((exercise) => {
        const parsed = this.parseLegacyMetric(exercise.metric);
        other.push({
          exercise: exercise.name || 'Exercise',
          details: `${parsed.sets} x ${parsed.reps} @ ${parsed.weights}`,
          caloriesBurned: 0,
        });
      });
    }

    const allCalories = [
      ...strength.map((entry) => entry.caloriesBurned),
      ...cardio.map((entry) => entry.caloriesBurned),
      ...other.map((entry) => entry.caloriesBurned),
    ];

    const sumOfRowCalories = allCalories.reduce((sum, value) => sum + value, 0);
    const displayTotalCalories = totalCalories > 0 ? totalCalories : sumOfRowCalories;

    if (displayTotalCalories > 0 && sumOfRowCalories === 0) {
      const rowCount = strength.length + cardio.length + other.length;
      if (rowCount > 0) {
        const equalShare = Math.round(displayTotalCalories / rowCount);
        strength.forEach((entry) => { entry.caloriesBurned = equalShare; });
        cardio.forEach((entry) => { entry.caloriesBurned = equalShare; });
        other.forEach((entry) => { entry.caloriesBurned = equalShare; });
      }
    }

    return {
      date,
      strength,
      cardio,
      other,
      totalCaloriesBurned: displayTotalCalories,
      trainerNotes: this.resolveWorkoutTrainerNotes(workout),
    };
  }

  private mergeHistoryGroupsByDate(groups: WorkoutHistoryDateGroup[]): WorkoutHistoryDateGroup[] {
    const grouped = new Map<string, WorkoutHistoryDateGroup>();

    groups.forEach((group) => {
      const existing = grouped.get(group.date);
      if (!existing) {
        grouped.set(group.date, {
          ...group,
          strength: [...group.strength],
          cardio: [...group.cardio],
          other: [...group.other],
        });
        return;
      }

      existing.strength.push(...group.strength);
      existing.cardio.push(...group.cardio);
      existing.other.push(...group.other);
      existing.totalCaloriesBurned += group.totalCaloriesBurned;
      existing.trainerNotes = this.combineTrainerNotes(
        existing.trainerNotes,
        group.trainerNotes
      );
    });

    return Array.from(grouped.values()).sort((left, right) =>
      right.date.localeCompare(left.date)
    );
  }

  private resolveWorkoutTrainerNotes(workout: WorkoutLogDoc): string {
    return this.readText(
      workout.trainer_notes ??
      workout.trainerNotes ??
      workout.notes
    );
  }

  private combineTrainerNotes(left: string, right: string): string {
    const uniqueNotes = Array.from(
      new Set([left, right].map((value) => this.readText(value)).filter(Boolean))
    );
    return uniqueNotes.join(' ');
  }

  private resolveCardioDistanceText(row: Record<string, unknown>): string {
    const displayText = this.readText(
      row['display_distance'] ??
      row['distance_input'] ??
      row['distanceText'] ??
      row['distance_text']
    );
    if (displayText) {
      return displayText;
    }

    const distance = Number(row['distance_meters'] ?? row['distance']);
    if (Number.isFinite(distance) && distance > 0) {
      return `${Math.round(distance * 100) / 100} m`;
    }

    return '';
  }

  private resolveCardioTimeText(row: Record<string, unknown>): string {
    const displayText = this.readText(
      row['display_time'] ??
      row['time_input'] ??
      row['timeText'] ??
      row['time_text']
    );
    if (displayText) {
      return displayText;
    }

    const minutes = Number(row['time_minutes'] ?? row['time']);
    if (Number.isFinite(minutes) && minutes > 0) {
      return `${Math.round(minutes * 100) / 100} min`;
    }

    return '';
  }

  private resolveOtherDetails(row: Record<string, unknown>): string {
    const sets = this.toRoundedNonNegative(row['sets']);
    const reps = this.toRoundedNonNegative(row['reps'] ?? row['time']);
    const weight = this.formatWeight(row);

    if (sets > 0 || reps > 0) {
      return `${sets} x ${reps} @ ${weight}`;
    }

    const activity = this.readText(row['activity'] ?? row['name'] ?? row['type']);
    return activity || 'Activity logged';
  }

  private resolveCalorieShares(rows: WorkoutTrainingRow[], totalCalories: number): number[] {
    const explicitCalories = rows.map((row) =>
      this.toRoundedNonNegative(row.estimated_calories)
    );
    if (explicitCalories.some((value) => value > 0)) {
      return explicitCalories;
    }

    if (rows.length === 0 || totalCalories <= 0) {
      return rows.map(() => 0);
    }

    const volumes = rows.map((row) => {
      if (typeof row.weights_kg !== 'number') {
        return 0;
      }
      return Math.max(0, Number(row.weights_kg)) *
        Math.max(0, Number(row.reps)) *
        Math.max(0, Number(row.sets));
    });
    const totalVolume = volumes.reduce((sum, value) => sum + value, 0);

    if (totalVolume <= 0) {
      const equal = Math.round(totalCalories / rows.length);
      return rows.map(() => equal);
    }

    return volumes.map((volume) =>
      Math.round(totalCalories * (volume / totalVolume))
    );
  }

  private formatWeight(row: Record<string, unknown>): string {
    const weightKg = Number(row['weights_kg'] ?? row['weights'] ?? row['weight_kg']);
    if (Number.isFinite(weightKg) && weightKg > 0) {
      return `${Math.round(weightKg * 100) / 100} kg`;
    }

    const displayWeight = this.readText(
      row['displayed_weights_metric'] ?? row['displayWeight']
    );
    if (this.isBodyweightDisplayValue(displayWeight)) {
      return 'bodyweight';
    }

    const text = this.readText(row['weights'] ?? row['weight']);
    if (!text) {
      return 'bodyweight';
    }
    if (text.toLowerCase().includes('body')) {
      return 'bodyweight';
    }
    return text;
  }

  private isBodyweightDisplayValue(displayWeight: string): boolean {
    return displayWeight.toLowerCase() === 'bodyweight' || displayWeight.toLowerCase() === 'body weight';
  }

  private toDisplayExerciseName(value: string): string {
    return String(value ?? '')
      .split('_')
      .filter(Boolean)
      .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
      .join(' ');
  }

  private parseLegacyMetric(metric: string): { sets: number; reps: number; weights: string } {
    const text = String(metric ?? '').toLowerCase();
    const bodyWeightMatch = text.includes('body weight') || text.includes('bodyweight');

    const match = text.match(/(\d+)\s*x\s*(\d+)\s*@\s*([0-9.]+)\s*(kg|lb|lbs)?/i);
    if (!match) {
      return {
        sets: 0,
        reps: 0,
        weights: bodyWeightMatch ? 'bodyweight' : '',
      };
    }

    const sets = Number(match[1] ?? 0);
    const reps = Number(match[2] ?? 0);
    const value = Number(match[3] ?? 0);
    const unit = (match[4] ?? 'kg').toLowerCase();
    const kgValue = unit === 'lb' || unit === 'lbs'
      ? value * 0.45359237
      : value;

    return {
      sets,
      reps,
      weights: `${Math.round(kgValue * 100) / 100} kg`,
    };
  }

  private resolveWorkoutDate(workout: WorkoutLogDoc): string {
    const explicitDate = this.readText(workout.date);
    if (explicitDate) {
      return explicitDate;
    }
    return this.formatDateCsv(workout.createdAt);
  }

  private formatDateCsv(createdAt: any): string {
    try {
      const dt = createdAt?.toDate?.() ?? null;
      if (!dt) return new Date().toISOString().slice(0, 10);
      return dt.toISOString().slice(0, 10);
    } catch {
      return new Date().toISOString().slice(0, 10);
    }
  }

  private toTimestampMillis(value: any): number {
    try {
      const dateValue = value?.toDate?.() ?? value;
      if (dateValue instanceof Date && !Number.isNaN(dateValue.getTime())) {
        return dateValue.getTime();
      }
      const parsed = new Date(dateValue);
      return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
    } catch {
      return 0;
    }
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

  private toObjectArray(value: unknown): Array<Record<string, unknown>> {
    if (Array.isArray(value)) {
      return value.filter(
        (entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object'
      );
    }

    if (value && typeof value === 'object') {
      return [value as Record<string, unknown>];
    }

    return [];
  }
}
