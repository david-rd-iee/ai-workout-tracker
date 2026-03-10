import { Injectable } from '@angular/core';
import {
  Firestore,
  doc,
  getDoc,
  setDoc,
  collection,
  addDoc,
  serverTimestamp,
} from '@angular/fire/firestore';
import { Auth } from '@angular/fire/auth';
import {
  WorkoutSessionPerformance,
  WorkoutTrainingRow,
} from '../models/workout-session.model';
import { ChatsService } from './chats.service';

@Injectable({ providedIn: 'root' })
export class WorkoutLogService {
  constructor(
    private firestore: Firestore,
    private auth: Auth,
    private chatsService: ChatsService
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
    const strengthTrainingRow = this.toObjectArray(
      session.strengthTrainingRow ?? session.strengthTrainingRowss ?? []
    );
    const cardioTrainingRow = this.toObjectArray(session.cardioTrainingRow ?? []);
    const otherTrainingRow = this.toObjectArray(session.otherTrainingRow ?? []);
    const estimatedCalories = Number(
      session.estimated_calories ?? session.calories ?? 0
    );
    const trainerNotes = session.trainer_notes ?? session.notes ?? '';
    const totalVolume = this.calculateTotalVolume(trainingRows);
    const trainerUid = await this.resolveCurrentTrainerUid(user.uid);
    if (!trainerUid) {
      throw new Error('No current trainer is assigned to this user.');
    }

    const workoutLogRef = await addDoc(workoutLogsRef, {
      createdAt: serverTimestamp(),
      calories: estimatedCalories,
      estimatedCalories,
      totalVolume,
      notes: trainerNotes,
      trainerNotes,
      isComplete: !!session.isComplete,
      trainingRows,
      strengthTrainingRow,
      cardioTrainingRow,
      otherTrainingRow,
      exercises: this.rowsToLegacyExercises(trainingRows),
      source: 'ai_logger',
      version: 2,
    });

    await this.sendSummaryToCurrentTrainer({
      trainerUid,
      clientUid: user.uid,
      clientWorkoutLogId: workoutLogRef.id,
      session,
      trainingRows,
      estimatedCalories,
      totalVolume,
      trainerNotes,
    });
    await this.sendSummaryMessageToTrainer({
      trainerUid,
      clientUid: user.uid,
      session,
      trainingRows,
      estimatedCalories,
      trainerNotes,
    });

    return workoutLogRef;
  }

  private async sendSummaryToCurrentTrainer(params: {
    trainerUid: string;
    clientUid: string;
    clientWorkoutLogId: string;
    session: WorkoutSessionPerformance;
    trainingRows: WorkoutTrainingRow[];
    estimatedCalories: number;
    totalVolume: number;
    trainerNotes: string;
  }): Promise<void> {
    const trainerSummariesRef = collection(
      this.firestore,
      `users/${params.trainerUid}/workoutSummaries`
    );

    const today = new Date().toISOString().slice(0, 10);
    const normalizedDate = typeof params.session.date === 'string' && params.session.date.trim()
      ? params.session.date
      : today;

    await addDoc(trainerSummariesRef, {
      createdAt: serverTimestamp(),
      date: normalizedDate,
      clientUid: params.clientUid,
      clientWorkoutLogId: params.clientWorkoutLogId,
      estimatedCalories: params.estimatedCalories,
      totalVolume: params.totalVolume,
      trainerNotes: params.trainerNotes,
      isComplete: !!params.session.isComplete,
      rows: params.trainingRows.map((row) => ({
        trainingType: row.Training_Type,
        estimatedCalories: row.estimated_calories,
        exerciseType: row.exercise_type,
        exercise: this.fromSnakeCase(row.exercise_type),
        sets: row.sets,
        reps: row.reps,
        weights: row.weights,
      })),
      source: 'ai_logger',
    });

    const trainerUserRef = doc(this.firestore, 'users', params.trainerUid);
    await setDoc(
      trainerUserRef,
      {
        lastWorkoutSummaryAt: serverTimestamp(),
      },
      { merge: true }
    );
  }

  private async sendSummaryMessageToTrainer(params: {
    trainerUid: string;
    clientUid: string;
    session: WorkoutSessionPerformance;
    trainingRows: WorkoutTrainingRow[];
    estimatedCalories: number;
    trainerNotes: string;
  }): Promise<void> {
    const chatId = await this.chatsService.findOrCreateDirectChat(
      params.clientUid,
      params.trainerUid
    );

    const workoutDate =
      typeof params.session.date === 'string' && params.session.date.trim()
        ? params.session.date
        : new Date().toISOString().slice(0, 10);

    const rowLines = params.trainingRows.length
      ? params.trainingRows.map((row) => {
          const exercise = this.fromSnakeCase(row.exercise_type);
          const weight = typeof row.weights === 'number'
            ? `${row.weights} kg`
            : 'body weight';
          return `- ${exercise}: ${row.sets} sets x ${row.reps} reps @ ${weight}`;
        })
      : ['- No exercises logged'];

    const notesSection = params.trainerNotes.trim()
      ? `\n\nTrainer Notes:\n${params.trainerNotes.trim()}`
      : '';

    const messageText = [
      `Workout Summary (${workoutDate})`,
      '',
      ...rowLines,
      '',
      `Estimated Calories: ${Math.round(params.estimatedCalories)} kcal`,
      notesSection,
    ]
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    await this.chatsService.sendMessage(chatId, params.clientUid, messageText);
  }

  private async resolveCurrentTrainerUid(clientUid: string): Promise<string> {
    const userDocRef = doc(this.firestore, 'users', clientUid);
    const userDocSnap = await getDoc(userDocRef);
    const userData = userDocSnap.exists() ? userDocSnap.data() as Record<string, unknown> : null;
    const fromUsersDoc = String(
      userData?.['ptUID'] ?? userData?.['trainerId'] ?? ''
    ).trim();
    if (fromUsersDoc) {
      return fromUsersDoc;
    }

    const clientDocRef = doc(this.firestore, 'clients', clientUid);
    const clientDocSnap = await getDoc(clientDocRef);
    const clientData = clientDocSnap.exists() ? clientDocSnap.data() as Record<string, unknown> : null;
    const fromClientDoc = String(clientData?.['trainerId'] ?? '').trim();
    return fromClientDoc;
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
