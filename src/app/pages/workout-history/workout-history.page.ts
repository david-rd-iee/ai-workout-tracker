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
        // if you're not logged in, just show empty state (route guard should prevent this anyway)
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