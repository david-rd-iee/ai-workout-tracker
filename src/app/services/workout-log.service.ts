import { Injectable } from '@angular/core';
import {
  Firestore,
  collection,
  addDoc,
  serverTimestamp,
} from '@angular/fire/firestore';
import { Auth } from '@angular/fire/auth';
import {
  WorkoutSessionPerformance,
  WorkoutTrainingRow,
} from '../models/workout-session.model';

@Injectable({ providedIn: 'root' })
export class WorkoutLogService {
  constructor(
    private firestore: Firestore,
    private auth: Auth
  ) {}

  async saveCompletedWorkout(session: WorkoutSessionPerformance) {
    const user = this.auth.currentUser;

    if (!user) {
      throw new Error('User not authenticated');
    }

    // Path: users/{uid}/workoutLogs
    const workoutLogsRef = collection(
      this.firestore,
      `users/${user.uid}/workoutLogs`
    );

    const trainingRows = Array.isArray(session.trainingRows) ? session.trainingRows : [];
    const estimatedCalories = Number(
      session.estimated_calories ?? session.calories ?? 0
    );
    const trainerNotes = session.trainer_notes ?? session.notes ?? '';
    const totalVolume = this.calculateTotalVolume(trainingRows);

    return addDoc(workoutLogsRef, {
      createdAt: serverTimestamp(),
      calories: estimatedCalories,
      estimatedCalories,
      totalVolume,
      notes: trainerNotes,
      trainerNotes,
      isComplete: !!session.isComplete,
      trainingRows,
      exercises: this.rowsToLegacyExercises(trainingRows),
      source: 'ai_logger',
      version: 2,
    });
  }

  private calculateTotalVolume(rows: WorkoutTrainingRow[]): number {
    return rows.reduce((total, row) => {
      if (typeof row.weights !== 'number') {
        return total;
      }
      return total + row.sets * row.reps * row.weights;
    }, 0);
  }

  private rowsToLegacyExercises(rows: WorkoutTrainingRow[]) {
    return rows.map((row) => {
      const metricWeight = typeof row.weights === 'number' ? `${row.weights} kg` : row.weights;
      return {
        name: this.fromSnakeCase(row.exercise_type),
        metric: `${row.sets} x ${row.reps} @ ${metricWeight}`,
        volume: typeof row.weights === 'number' ? row.sets * row.reps * row.weights : 0,
      };
    });
  }

  private fromSnakeCase(value: string): string {
    return String(value ?? '')
      .split('_')
      .filter(Boolean)
      .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
      .join(' ');
  }
}
