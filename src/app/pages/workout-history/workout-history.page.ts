import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';

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

type WorkoutTrainingRow = {
  Training_Type: 'Strength' | 'Cardio' | 'Other';
  exercise_type: string;
  sets: number;
  reps: number;
  weights: number | 'body weight';
};

type WorkoutExerciseRow = { name: string; metric: string; volume: number };

type WorkoutLogDoc = {
  createdAt?: any;
  calories?: number;
  estimatedCalories?: number;
  totalVolume?: number;
  notes?: string;
  trainerNotes?: string;
  isComplete?: boolean;
  trainingRows?: WorkoutTrainingRow[];
  exercises?: WorkoutExerciseRow[];
};

type WorkoutHistoryRow = {
  date: string;
  exersise: string;
  rep: number;
  sets: number;
  weights: string;
  caloriesBurned: number;
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
        (click)="exportCsv()"
        [disabled]="isLoading || historyRows.length === 0"
        style="margin-bottom: 12px;"
      >
        Export CSV
      </ion-button>

      <ion-list>
        <ion-item *ngIf="isLoading">
          <ion-label>Loading workouts...</ion-label>
        </ion-item>

        <ion-item *ngIf="!isLoading && historyRows.length === 0">
          <ion-label>No workouts saved yet.</ion-label>
        </ion-item>

        <ion-item *ngFor="let row of historyRows">
          <ion-label>
            <p><strong>Date:</strong> {{ row.date }}</p>
            <p><strong>Exersise:</strong> {{ row.exersise }}</p>
            <p><strong>Rep:</strong> {{ row.rep }}</p>
            <p><strong>Sets:</strong> {{ row.sets }}</p>
            <p><strong>Weights:</strong> {{ row.weights }}</p>
            <p><strong>Calories Burned:</strong> {{ row.caloriesBurned }}</p>
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
  historyRows: WorkoutHistoryRow[] = [];
  isLoading = false;
  pageTitle = 'Workout History';

  constructor(
    private firestore: Firestore,
    private auth: Auth,
    private route: ActivatedRoute
  ) {}

  async ngOnInit() {
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
        return;
      }

      const logsRef = collection(this.firestore, `users/${targetUserId}/workoutLogs`);
      const q = query(logsRef, orderBy('createdAt', 'desc'), limit(20));
      const snap = await getDocs(q);

      this.workouts = snap.docs.map((d) => d.data() as WorkoutLogDoc);
      this.historyRows = this.workouts.reduce<WorkoutHistoryRow[]>(
        (rows, workout: WorkoutLogDoc) => {
          rows.push(...this.toHistoryRows(workout));
          return rows;
        },
        []
      );
    } catch (e) {
      console.error('Failed to load workout logs:', e);
      this.workouts = [];
      this.historyRows = [];
    } finally {
      this.isLoading = false;
    }
  }

  exportCsv() {
    const header = [
      'Date',
      'Exersise',
      'Rep',
      'Sets',
      'Weights',
      'Calories Burned',
    ];

    const rows: string[] = [];
    rows.push(header.join(','));

    for (const row of this.historyRows ?? []) {
      rows.push(
        [
          this.csvEscape(row.date),
          this.csvEscape(row.exersise),
          Number(row.rep),
          Number(row.sets),
          this.csvEscape(row.weights),
          Number(row.caloriesBurned),
        ].join(',')
      );
    }

    const csv = rows.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });

    const dateTag = new Date().toISOString().slice(0, 10);
    const filename = `workouts_${dateTag}.csv`;

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  private csvEscape(value: string): string {
    const v = (value ?? '').toString();
    if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
    return v;
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

  private toHistoryRows(workout: WorkoutLogDoc): WorkoutHistoryRow[] {
    const date = this.formatDateCsv(workout.createdAt);
    const calories = Number(workout.estimatedCalories ?? workout.calories ?? 0);
    const trainingRows = workout.trainingRows ?? [];

    if (trainingRows.length > 0) {
      const calorieShares = this.allocateCalories(trainingRows, calories);
      return trainingRows.map((row, index) => ({
        date,
        exersise: this.toDisplayExerciseName(row.exercise_type),
        rep: Number(row.reps ?? 0),
        sets: Number(row.sets ?? 0),
        weights:
          typeof row.weights === 'number'
            ? `${row.weights} kg`
            : 'body weight',
        caloriesBurned: calorieShares[index] ?? 0,
      }));
    }

    const legacyExercises = workout.exercises ?? [];
    if (legacyExercises.length > 0) {
      const equalCalories = legacyExercises.length > 0
        ? Math.round(calories / legacyExercises.length)
        : 0;

      return legacyExercises.map((exercise) => {
        const parsed = this.parseLegacyMetric(exercise.metric);
        return {
          date,
          exersise: exercise.name || '',
          rep: parsed.reps,
          sets: parsed.sets,
          weights: parsed.weights,
          caloriesBurned: equalCalories,
        };
      });
    }

    return [];
  }

  private allocateCalories(rows: WorkoutTrainingRow[], totalCalories: number): number[] {
    if (rows.length === 0 || totalCalories <= 0) {
      return rows.map(() => 0);
    }

    const volumes = rows.map((row) => {
      if (typeof row.weights !== 'number') {
        return 0;
      }
      return Math.max(0, Number(row.weights)) * Math.max(0, Number(row.reps)) * Math.max(0, Number(row.sets));
    });
    const totalVolume = volumes.reduce((sum, value) => sum + value, 0);

    if (totalVolume <= 0) {
      const equal = Math.round(totalCalories / rows.length);
      return rows.map(() => equal);
    }

    return volumes.map((volume) => Math.round(totalCalories * (volume / totalVolume)));
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
    const bodyWeightMatch = text.includes('body weight');

    const match = text.match(/(\d+)\s*x\s*(\d+)\s*@\s*([0-9.]+)\s*(kg|lb|lbs)?/i);
    if (!match) {
      return {
        sets: 0,
        reps: 0,
        weights: bodyWeightMatch ? 'body weight' : '',
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
    }
  }
}
