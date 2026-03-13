import { Injectable } from '@angular/core';
import {
  Firestore,
  DocumentData,
  DocumentReference,
  doc,
  getDoc,
  setDoc,
  collection,
  addDoc,
  serverTimestamp,
} from '@angular/fire/firestore';
import { Auth } from '@angular/fire/auth';
import {
  CardioTrainingRow,
  OtherTrainingRow,
  WorkoutSessionPerformance,
  WorkoutTrainingRow,
} from '../models/workout-session.model';
import { ChatsService } from './chats.service';
import { UpdateScoreResult, UpdateScoreService } from './update-score.service';

export interface SaveCompletedWorkoutResult {
  workoutLogRef: DocumentReference<DocumentData>;
  scoreUpdate: UpdateScoreResult | null;
}

@Injectable({ providedIn: 'root' })
export class WorkoutLogService {
  constructor(
    private firestore: Firestore,
    private auth: Auth,
    private chatsService: ChatsService,
    private updateScoreService: UpdateScoreService
  ) {}

  async saveCompletedWorkout(session: WorkoutSessionPerformance): Promise<SaveCompletedWorkoutResult> {
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

    let scoreUpdate: UpdateScoreResult | null = null;
    try {
      scoreUpdate = await this.updateScoreService.updateScoreAfterWorkout({
        userId: user.uid,
        session,
        workoutLogId: workoutLogRef.id,
      });
    } catch (error) {
      console.error('[WorkoutLogService] Failed to update user score:', error);
    }

    if (trainerUid) {
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
    }

    return {
      workoutLogRef,
      scoreUpdate,
    };
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
    const messageText = this.buildSummaryChatMessage(
      params.session,
      params.trainingRows,
      params.estimatedCalories,
      params.trainerNotes,
      new Date()
    );

    await this.chatsService.sendMessage(chatId, params.clientUid, messageText);
  }

  private buildSummaryChatMessage(
    session: WorkoutSessionPerformance,
    trainingRows: WorkoutTrainingRow[],
    estimatedCalories: number,
    trainerNotes: string,
    loggedAt: Date
  ): string {
    const strengthRows = this.resolveStrengthRows(session, trainingRows);
    const cardioRows = this.resolveCardioRows(session, trainingRows);
    const otherRows = this.resolveOtherRows(session, trainingRows);

    const lines: string[] = [
      'Workout Summary',
      '',
      loggedAt.toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      }),
      loggedAt.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
      }),
      `Estimated Total Calories: ${Math.round(estimatedCalories)} kcal`,
    ];

    if (strengthRows.length > 0) {
      lines.push('', 'Strength:', '');
      strengthRows.forEach((row) => {
        lines.push(
          this.fromSnakeCase(row.exercise_type),
          `Sets: ${row.sets}`,
          `Reps: ${row.reps}`,
          `Weights: ${this.formatWeight(row.weights)}`,
          `Calories Burned: ${this.toRoundedNonNegative(row.estimated_calories)}`,
          ''
        );
      });
    }

    if (cardioRows.length > 0) {
      lines.push('', 'Cardio:', '');
      cardioRows.forEach((row) => {
        lines.push(
          this.fromSnakeCase(row.cardio_type),
          `Distance: ${this.formatCardioDistance(row)}`,
          `Time: ${this.formatCardioTime(row)}`,
          `Calories Burned: ${this.toRoundedNonNegative(row.estimated_calories)}`,
          ''
        );
      });
    }

    if (otherRows.length > 0) {
      lines.push('', 'Other:', '');
      otherRows.forEach((row) => {
        lines.push(
          this.resolveOtherTitle(row),
          `Details: ${this.resolveOtherDetails(row)}`,
          `Calories Burned: ${this.toRoundedNonNegative(row['estimated_calories'])}`,
          ''
        );
      });
    }

    const notes = String(trainerNotes ?? '').trim();
    if (notes) {
      lines.push('', 'Notes:', notes);
    }

    return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  private async resolveCurrentTrainerUid(clientUid: string): Promise<string> {
    const userDocRef = doc(this.firestore, 'users', clientUid);
    const userDocSnap = await getDoc(userDocRef);
    const userData = userDocSnap.exists() ? userDocSnap.data() as Record<string, unknown> : null;
    const fromUsersDoc = String(userData?.['trainerId'] ?? '').trim();
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

  private resolveStrengthRows(
    session: WorkoutSessionPerformance,
    trainingRows: WorkoutTrainingRow[]
  ): WorkoutTrainingRow[] {
    const structured = this.toObjectArray(session.strengthTrainingRow ?? session.strengthTrainingRowss ?? [])
      .map((row) => ({
        Training_Type: 'Strength' as const,
        estimated_calories: this.toRoundedNonNegative(row['estimated_calories']),
        exercise_type: String(row['exercise_type'] ?? row['exercise'] ?? 'strength_exercise'),
        sets: this.toRoundedNonNegative(row['sets']),
        reps: this.toRoundedNonNegative(row['reps']),
        weights: this.normalizeWeight(row['weights']),
      }));

    if (structured.length > 0) {
      return structured;
    }

    return trainingRows.filter((row) => row.Training_Type === 'Strength');
  }

  private resolveCardioRows(
    session: WorkoutSessionPerformance,
    trainingRows: WorkoutTrainingRow[]
  ): CardioTrainingRow[] {
    const structured = this.toObjectArray(session.cardioTrainingRow ?? []).map((row) => {
      const distance = Number(row['distance'] ?? row['distance_meters'] ?? row['meters']);
      const time = Number(row['time'] ?? row['minutes'] ?? row['duration']);

      return {
        ...row,
        Training_Type: 'Cardio' as const,
        estimated_calories: this.toRoundedNonNegative(row['estimated_calories']),
        cardio_type: String(
          row['cardio_type'] ?? row['exercise_type'] ?? row['type'] ?? 'cardio_activity'
        ),
        distance: Number.isFinite(distance) && distance > 0 ? distance : undefined,
        time: Number.isFinite(time) && time > 0 ? time : undefined,
      };
    });

    if (structured.length > 0) {
      return structured;
    }

    return trainingRows
      .filter((row) => row.Training_Type === 'Cardio')
      .map((row) => ({
        Training_Type: 'Cardio',
        estimated_calories: row.estimated_calories,
        cardio_type: row.exercise_type,
        time: row.reps,
      }));
  }

  private resolveOtherRows(
    session: WorkoutSessionPerformance,
    trainingRows: WorkoutTrainingRow[]
  ): OtherTrainingRow[] {
    const structured = this.toObjectArray(session.otherTrainingRow ?? []).map((row) => ({
      ...row,
      Training_Type: 'Other' as const,
      estimated_calories: this.toRoundedNonNegative(row['estimated_calories']),
    }));

    if (structured.length > 0) {
      return structured;
    }

    return trainingRows
      .filter((row) => row.Training_Type === 'Other')
      .map((row) => ({
        Training_Type: 'Other',
        estimated_calories: row.estimated_calories,
        exercise_type: row.exercise_type,
        sets: row.sets,
        reps: row.reps,
        weights: row.weights,
      }));
  }

  private normalizeWeight(value: unknown): number | 'body weight' {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      return value;
    }

    const text = String(value ?? '').trim().toLowerCase();
    if (!text || text.includes('body')) {
      return 'body weight';
    }

    const parsed = Number(text);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 'body weight';
  }

  private formatWeight(value: unknown): string {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      return `${value} kg`;
    }

    const text = String(value ?? '').trim();
    if (!text || text.toLowerCase().includes('body')) {
      return 'body weight';
    }

    return text;
  }

  private formatCardioDistance(row: CardioTrainingRow): string {
    const text = this.readText(
      row['distance_input'] ?? row['distanceText'] ?? row['distance_text']
    );
    if (text) {
      return text;
    }

    const distance = Number(row.distance);
    if (Number.isFinite(distance) && distance > 0) {
      return `${Math.round(distance)} m`;
    }

    return 'N/A';
  }

  private formatCardioTime(row: CardioTrainingRow): string {
    const text = this.readText(
      row['time_input'] ?? row['timeText'] ?? row['time_text']
    );
    if (text) {
      return text;
    }

    const time = Number(row.time);
    if (Number.isFinite(time) && time > 0) {
      return `${Math.round(time)} min`;
    }

    return 'N/A';
  }

  private resolveOtherTitle(row: OtherTrainingRow): string {
    return this.fromSnakeCase(
      String(row['exercise_type'] ?? row['activity'] ?? row['name'] ?? 'other_activity')
    );
  }

  private resolveOtherDetails(row: OtherTrainingRow): string {
    const sets = this.toRoundedNonNegative(row['sets']);
    const reps = this.toRoundedNonNegative(row['reps'] ?? row['time']);
    const weights = this.formatWeight(row['weights'] ?? row['weight'] ?? row['load']);

    if (sets > 0 || reps > 0) {
      return `${sets} x ${reps} @ ${weights}`;
    }

    return this.readText(row['activity'] ?? row['name'] ?? row['type']) || 'Activity logged';
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
