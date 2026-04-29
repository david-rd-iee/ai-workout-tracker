import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Firestore, doc, getDoc } from '@angular/fire/firestore';
import {
  IonButton,
  IonCard,
  IonCardContent,
  IonContent,
  IonIcon,
  IonSpinner,
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  calendarOutline,
  checkmarkCircleOutline,
  closeCircleOutline,
  fitnessOutline,
  eyeOutline,
  playOutline,
  refreshOutline,
  timeOutline,
} from 'ionicons/icons';
import { HeaderComponent } from '../../components/header/header.component';
import { ClientPaymentsService } from '../../services/client-payments.service';

interface AssignedWorkoutExercise {
  name: string;
  sets: number;
  reps: string;
  weight: string;
  notes: string;
}

interface AssignedWorkoutDetails {
  id: string;
  title: string;
  notes: string;
  exercises: AssignedWorkoutExercise[];
  exerciseCount: number;
  durationMinutes: number;
  dueDate: Date;
  dueDateLabel: string;
  statusLabel: string;
  isComplete: boolean;
  trainerName: string;
}

@Component({
  selector: 'app-assigned-workout',
  standalone: true,
  templateUrl: './assigned-workout.page.html',
  styleUrls: ['./assigned-workout.page.scss'],
  imports: [
    CommonModule,
    IonContent,
    IonCard,
    IonCardContent,
    IonButton,
    IonIcon,
    IonSpinner,
    HeaderComponent,
  ],
})
export class AssignedWorkoutPage implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly firestore = inject(Firestore);
  private readonly clientPaymentsService = inject(ClientPaymentsService);

  readonly backHref = '/client-payments?panel=workouts';

  isLoading = true;
  isOpeningLogger = false;
  errorMessage = '';
  workout: AssignedWorkoutDetails | null = null;

  constructor() {
    addIcons({
      calendarOutline,
      checkmarkCircleOutline,
      closeCircleOutline,
      fitnessOutline,
      eyeOutline,
      playOutline,
      refreshOutline,
      timeOutline,
    });
  }

  ngOnInit(): void {
    void this.loadWorkout();
  }

  ionViewWillEnter(): void {
    void this.loadWorkout();
  }

  async refresh(): Promise<void> {
    await this.loadWorkout();
  }

  async openWorkoutLogger(): Promise<void> {
    if (!this.workout || this.isOpeningLogger) {
      return;
    }

    this.isOpeningLogger = true;

    try {
      await this.router.navigate(['/workout-chatbot'], {
        state: {
          assignedWorkout: this.workout,
          backHref: `/assigned-workout/${this.workout.id}`,
        },
      });
    } finally {
      this.isOpeningLogger = false;
    }
  }

  formatDuration(minutes: number): string {
    const rounded = Number.isFinite(minutes) ? Math.max(0, Math.trunc(minutes)) : 0;
    return rounded > 0 ? `${rounded} min` : '';
  }

  private async loadWorkout(): Promise<void> {
    this.isLoading = true;
    this.errorMessage = '';

    try {
      const workoutId = String(this.route.snapshot.paramMap.get('workoutId') || '').trim();
      if (!workoutId) {
        throw new Error('Workout not found.');
      }

      const paymentContext = await this.clientPaymentsService.getPaymentContext();
      const workoutSnap = await getDoc(
        doc(
          this.firestore,
          `clientWorkouts/${paymentContext.clientId}/workouts/${workoutId}`
        )
      );

      if (!workoutSnap.exists()) {
        throw new Error('Workout not found.');
      }

      const workoutData = workoutSnap.data() as Record<string, unknown>;
      const workoutTrainerId = String(workoutData['trainerId'] || '').trim();
      if (workoutTrainerId && workoutTrainerId !== paymentContext.trainerId) {
        throw new Error('Workout not found.');
      }

      const dueDate =
        this.toDate(workoutData['scheduledDate']) ||
        this.toDate(workoutData['createdAt']) ||
        this.toDate(workoutData['updatedAt']) ||
        new Date();
      const isComplete = workoutData['isComplete'] === true;

      this.workout = {
        id: workoutId,
        title: String(workoutData['title'] || workoutData['name'] || 'Workout').trim() || 'Workout',
        notes: String(workoutData['notes'] || workoutData['description'] || '').trim(),
        exercises: this.mapExercises(workoutData['exercises']),
        exerciseCount: Array.isArray(workoutData['exercises']) ? workoutData['exercises'].length : 0,
        durationMinutes: this.resolveDuration(workoutData['duration'], workoutData['exercises']),
        dueDate,
        dueDateLabel: dueDate.toLocaleDateString(undefined, {
          month: 'short',
          day: 'numeric',
        }),
        statusLabel: isComplete
          ? 'Complete'
          : dueDate.getTime() < Date.now()
            ? 'Overdue'
            : 'Assigned',
        isComplete,
        trainerName: String(workoutData['trainerName'] || paymentContext.trainerName || '').trim() ||
          paymentContext.trainerName,
      };
    } catch (error) {
      console.error('[AssignedWorkoutPage] Failed to load workout:', error);
      this.workout = null;
      this.errorMessage = this.resolveErrorMessage(error);
    } finally {
      this.isLoading = false;
    }
  }

  private mapExercises(value: unknown): AssignedWorkoutExercise[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .map((item) => {
        if (!item || typeof item !== 'object') {
          return null;
        }

        const record = item as Record<string, unknown>;
        const name = String(record['name'] || record['exerciseName'] || '').trim();
        if (!name) {
          return null;
        }

        return {
          name,
          sets: Math.max(0, Math.trunc(Number(record['sets'] || 0) || 0)),
          reps: String(record['reps'] || '').trim(),
          weight: String(record['weight'] || record['load'] || '').trim(),
          notes: String(record['notes'] || '').trim(),
        };
      })
      .filter((exercise): exercise is AssignedWorkoutExercise => exercise !== null);
  }

  private resolveDuration(durationValue: unknown, exercises: unknown): number {
    const duration = Number(durationValue);
    if (Number.isFinite(duration) && duration > 0) {
      return Math.round(duration);
    }

    if (!Array.isArray(exercises)) {
      return 0;
    }

    const estimated = exercises.length * 5;
    return estimated > 0 ? Math.max(15, estimated) : 0;
  }

  private toDate(value: unknown): Date | null {
    if (!value) {
      return null;
    }

    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? null : value;
    }

    if (typeof (value as { toDate?: unknown }).toDate === 'function') {
      const converted = (value as { toDate: () => Date }).toDate();
      return converted instanceof Date && !Number.isNaN(converted.getTime()) ? converted : null;
    }

    const parsed = new Date(String(value));
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  private resolveErrorMessage(error: unknown): string {
    if (error instanceof Error && error.message.trim()) {
      return error.message.trim();
    }

    return 'Unable to load this workout right now.';
  }
}
