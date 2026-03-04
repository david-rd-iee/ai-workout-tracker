import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';

import {
  IonContent,
  IonHeader,
  IonTitle,
  IonToolbar,
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

type WorkoutExerciseRow = { name: string; metric: string; volume: number };

type WorkoutLogDoc = {
  createdAt?: any;
  calories?: number;
  totalVolume?: number;
  notes?: string;
  exercises?: WorkoutExerciseRow[];
};

@Component({
  selector: 'app-workout-history',
  standalone: true,
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-title>Workout History</ion-title>
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
              Volume: {{ w.totalVolume ?? 0 }} | Calories: {{ w.calories ?? 0 }}
            </p>

            <div *ngIf="w.exercises?.length">
              <p style="margin-top: 8px; font-weight: 600;">Exercises</p>
              <p *ngFor="let ex of w.exercises" style="margin: 4px 0;">
                • {{ ex.name }} — {{ ex.metric }} (vol {{ ex.volume ?? 0 }})
              </p>
            </div>

            <p *ngIf="w.notes" style="margin-top: 8px;">
              <span style="font-weight: 600;">Notes:</span> {{ w.notes }}
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

  constructor(private firestore: Firestore, private auth: Auth) {}

  async ngOnInit() {
    this.isLoading = true;
    try {
      const user = await new Promise<any>((resolve) => {
        const unsub = onAuthStateChanged(this.auth as any, (u) => {
          unsub();
          resolve(u);
        });
      });

      if (!user) {
        this.workouts = [];
        return;
      }

      const logsRef = collection(this.firestore, `users/${user.uid}/workoutLogs`);
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
    const header = ['Date', 'Exercise', 'Metric', 'Notes'];

    const rows: string[] = [];
    rows.push(header.join(','));

    for (const w of this.workouts ?? []) {
      const date = this.formatDateCsv(w.createdAt);
      const notes = w.notes ?? '';
      const exercises = w.exercises ?? [];

      for (const ex of exercises) {
        const metrics = this.expandMetricToSetLines(ex.metric ?? '');

        if (metrics.length === 0) {
          rows.push(
            [
              this.csvEscape(date),
              this.csvEscape(ex.name ?? ''),
              this.csvEscape(''),
              this.csvEscape(notes),
            ].join(',')
          );
          rows.push('');
          continue;
        }

        metrics.forEach((m, idx) => {
          rows.push(
            [
              idx === 0 ? this.csvEscape(date) : '',
              idx === 0 ? this.csvEscape(ex.name ?? '') : '',
              this.csvEscape(m),
              idx === 0 ? this.csvEscape(notes) : '',
            ].join(',')
          );
        });

        rows.push('');
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

  private expandMetricToSetLines(metricRaw: string): string[] {
    let s = (metricRaw ?? '').trim();
    if (!s) return [];

    s = s.replace(/[()]/g, '').trim();
    s = s.replace(/^\s*\d+\s*x\s*/i, '').trim();
    s = s.replace(
      /^\s*(?:reps?\s*&\s*weights?|reps?\s*and\s*weights?)\s*:\s*/i,
      ''
    ).trim();

    s = s
      .replace(/\r\n/g, '\n')
      .replace(/\n+/g, ',')
      .replace(/;/g, ',')
      .replace(/•/g, ',')
      .replace(/\|/g, ',')
      .trim();

    const tokens = s
      .split(',')
      .map((x) => x.trim())
      .filter((x) => x.length > 0);

    if (tokens.length === 0) return [];

    const first = tokens[0].replace(/\s+/g, '');
    const m = first.match(/^(\d+)[xX](.+)$/);

    if (m) {
      const reps = m[1];
      const firstWeightPart = m[2].trim();
      const rest = tokens.slice(1);

      const restLooksLikeWeightsOnly =
        rest.length > 0 &&
        rest.every((t) => /^[0-9]+(\.[0-9]+)?\s*(lb|lbs|kg)?$/i.test(t.trim()));

      if (restLooksLikeWeightsOnly) {
        const out: string[] = [];
        out.push(`${reps}x${firstWeightPart}`);

        for (const t of rest) {
          const w = t.trim().replace(/\s+/g, '');
          out.push(`${reps}x${w}`);
        }
        return out;
      }
    }

    return tokens.map((t) => t.replace(/\s+/g, ' ').trim());
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