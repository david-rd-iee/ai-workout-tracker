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
  IonNote,
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
        [disabled]="isLoading || workouts.length === 0"
        style="margin-bottom: 12px;"
      >
        Export CSV
      </ion-button>

      <ion-list>
        <ion-item *ngIf="isLoading">
          <ion-label>Loading workouts...</ion-label>
        </ion-item>

        <ion-item *ngIf="!isLoading && workouts.length === 0">
          <ion-label>No workouts saved yet.</ion-label>
        </ion-item>

        <ion-item *ngFor="let w of workouts">
          <ion-label>
            <h2>{{ formatDate(w.createdAt) }}</h2>
            <p>
              Volume: {{ w.totalVolume ?? 0 }} | Calories: {{ w.estimatedCalories ?? w.calories ?? 0 }}
            </p>

            <div *ngIf="w.trainingRows?.length">
              <p style="margin-top: 8px; font-weight: 600;">Training Rows</p>
              <p *ngFor="let row of w.trainingRows" style="margin: 4px 0;">
                • {{ row.exercise_type }} — {{ row.Training_Type }} — {{ row.sets }} x {{ row.reps }} @ {{ row.weights }}{{ row.weights === 'body weight' ? '' : ' kg' }}
              </p>
            </div>

            <div *ngIf="!w.trainingRows?.length && w.exercises?.length">
              <p style="margin-top: 8px; font-weight: 600;">Legacy Exercises</p>
              <p *ngFor="let ex of w.exercises" style="margin: 4px 0;">
                • {{ ex.name }} — {{ ex.metric }}
              </p>
            </div>

            <p *ngIf="w.trainerNotes || w.notes" style="margin-top: 8px;">
              <span style="font-weight: 600;">Notes:</span> {{ w.trainerNotes || w.notes }}
            </p>
          </ion-label>

          <ion-note slot="end">{{ w.totalVolume ?? 0 }}</ion-note>
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
    IonNote,
    IonButton,
  ],
})
export class WorkoutHistoryPage implements OnInit {
  workouts: WorkoutLogDoc[] = [];
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
    } catch (e) {
      console.error('Failed to load workout logs:', e);
      this.workouts = [];
    } finally {
      this.isLoading = false;
    }
  }

  exportCsv() {
    const header = [
      'Date',
      'Training_Type',
      'exercise_type',
      'sets',
      'reps',
      'weights',
      'estimated_calories',
      'trainer_notes',
      'isComplete',
    ];

    const rows: string[] = [];
    rows.push(header.join(','));

    for (const w of this.workouts ?? []) {
      const date = this.formatDateCsv(w.createdAt);
      const calories = Number(w.estimatedCalories ?? w.calories ?? 0);
      const notes = w.trainerNotes ?? w.notes ?? '';
      const isComplete = !!w.isComplete;
      const trainingRows = w.trainingRows ?? [];

      if (trainingRows.length === 0) {
        rows.push(
          [
            this.csvEscape(date),
            this.csvEscape(''),
            this.csvEscape(''),
            '',
            '',
            this.csvEscape(''),
            calories,
            this.csvEscape(notes),
            isComplete ? 'true' : 'false',
          ].join(',')
        );
        continue;
      }

      for (const row of trainingRows) {
        rows.push(
          [
            this.csvEscape(date),
            this.csvEscape(row.Training_Type ?? ''),
            this.csvEscape(row.exercise_type ?? ''),
            Number(row.sets ?? 0),
            Number(row.reps ?? 0),
            this.csvEscape(String(row.weights ?? '')),
            calories,
            this.csvEscape(notes),
            isComplete ? 'true' : 'false',
          ].join(',')
        );
      }
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
      if (!dt) return '';
      return dt.toISOString().slice(0, 10);
    } catch {
      return '';
    }
  }

  formatDate(createdAt: any): string {
    try {
      const dt = createdAt?.toDate?.() ?? null;
      if (!dt) return 'Unknown date';
      return dt.toLocaleString();
    } catch {
      return 'Unknown date';
    }
  }
}
