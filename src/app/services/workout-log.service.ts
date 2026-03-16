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

type StoredWorkoutTrainingRow = WorkoutTrainingRow;

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
    const userWeightKg = await this.resolveUserBodyweightKg(user.uid);
    const normalizedTrainingRows = this.prepareTrainingRowsForCalculations(trainingRows, userWeightKg);
    const persistedStrengthTrainingRow = this.prepareStrengthRowsForStorage(
      strengthTrainingRow,
      userWeightKg
    );
    const persistedCardioTrainingRow = this.prepareCardioRowsForStorage(cardioTrainingRow);
    const estimatedCalories = Number(
      session.estimated_calories ?? session.calories ?? 0
    );
    const trainerNotes = session.trainer_notes ?? session.notes ?? '';
    const totalVolume = this.calculateTotalVolume(normalizedTrainingRows);
    const trainerUid = await this.resolveCurrentTrainerUid(user.uid);
    const submittedSession: WorkoutSessionPerformance = {
      ...session,
      trainingRows: normalizedTrainingRows,
      strengthTrainingRow: persistedStrengthTrainingRow,
      strengthTrainingRowss: persistedStrengthTrainingRow,
      cardioTrainingRow: persistedCardioTrainingRow,
      otherTrainingRow: otherTrainingRow as OtherTrainingRow[],
      estimated_calories: estimatedCalories,
      trainer_notes: trainerNotes,
      notes: trainerNotes,
      volume: totalVolume,
      calories: estimatedCalories,
      exercises: this.rowsToLegacyExercises(normalizedTrainingRows),
    };

    const workoutLogRef = await addDoc(workoutLogsRef, {
      createdAt: serverTimestamp(),
      calories: estimatedCalories,
      notes: trainerNotes,
      strengthTrainingRow: persistedStrengthTrainingRow,
      cardioTrainingRow: persistedCardioTrainingRow,
      otherTrainingRow,
    });

    let scoreUpdate: UpdateScoreResult | null = null;
    try {
      scoreUpdate = await this.updateScoreService.updateScoreAfterWorkout({
        userId: user.uid,
        session: submittedSession,
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
        session: submittedSession,
        trainingRows: normalizedTrainingRows,
        estimatedCalories,
        totalVolume,
        trainerNotes,
      });
      await this.sendSummaryMessageToTrainer({
        trainerUid,
        clientUid: user.uid,
        session: submittedSession,
        trainingRows: normalizedTrainingRows,
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
        weights: this.formatWeight(row),
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
          `Weights: ${this.formatWeight(row)}`,
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
      lines.push('', 'Notes for Trainer:', notes);
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

  private async resolveUserBodyweightKg(userId: string): Promise<number> {
    const userRef = doc(this.firestore, 'users', userId);
    const userSnap = await getDoc(userRef);
    if (userSnap.exists()) {
      const userData = userSnap.data() as Record<string, unknown>;
      const candidate = Number(
        userData['weightKg'] ?? userData['weight_kg'] ?? userData['weight']
      );
      if (Number.isFinite(candidate) && candidate > 0) {
        return candidate;
      }
    }

    const userStatsRef = doc(this.firestore, 'userStats', userId);
    const userStatsSnap = await getDoc(userStatsRef);
    if (!userStatsSnap.exists()) {
      return 0;
    }

    const userStats = userStatsSnap.data() as Record<string, unknown>;
    const candidate = Number(
      userStats['weightKg'] ?? userStats['weight_kg'] ?? userStats['weight']
    );
    return Number.isFinite(candidate) && candidate > 0 ? candidate : 0;
  }

  private prepareTrainingRowsForCalculations(
    rows: Array<Record<string, unknown>> | WorkoutTrainingRow[],
    userWeightKg: number
  ): StoredWorkoutTrainingRow[] {
    return rows.map((row) => {
      const record = row as Record<string, unknown>;
      const trainingType = String(record['Training_Type'] ?? '').trim();
      const normalizedWeightKg = trainingType === 'Strength'
        ? this.resolveStrengthWeightKg(record, userWeightKg)
        : 0;
      return {
        ...(record as unknown as WorkoutTrainingRow),
        displayed_weights_metric: this.resolveDisplayedWeightMetric(record),
        weights_kg: normalizedWeightKg,
      };
    });
  }

  private prepareStrengthRowsForStorage(
    rows: Array<Record<string, unknown>>,
    userWeightKg: number
  ): WorkoutTrainingRow[] {
    return rows.map((row) => ({
      Training_Type: 'Strength',
      estimated_calories: this.toRoundedNonNegative(row['estimated_calories']),
      exercise_type: String(row['exercise_type'] ?? row['exercise'] ?? 'strength_exercise'),
      sets: this.toRoundedNonNegative(row['sets']),
      reps: this.toRoundedNonNegative(row['reps']),
      displayed_weights_metric: this.resolveDisplayedWeightMetric(row),
      weights_kg: this.resolveStrengthWeightKg(row, userWeightKg),
    }));
  }

  private prepareCardioRowsForStorage(rows: Array<Record<string, unknown>>): CardioTrainingRow[] {
    return rows.map((row) => {
      const distanceMeters = Number(
        row['distance_meters'] ?? row['distance'] ?? row['meters']
      );
      const timeMinutes = Number(
        row['time_minutes'] ?? row['time'] ?? row['minutes'] ?? row['duration']
      );

      return {
        Training_Type: 'Cardio',
        estimated_calories: this.toRoundedNonNegative(row['estimated_calories']),
        cardio_type: String(
          row['cardio_type'] ?? row['exercise_type'] ?? row['type'] ?? 'cardio_activity'
        ),
        display_distance: this.readText(
          row['display_distance'] ??
          row['distance_input'] ??
          row['distanceText'] ??
          row['distance_text']
        ),
        distance_meters: Number.isFinite(distanceMeters) && distanceMeters > 0
          ? distanceMeters
          : undefined,
        display_time: this.readText(
          row['display_time'] ??
          row['time_input'] ??
          row['timeText'] ??
          row['time_text']
        ),
        time_minutes: Number.isFinite(timeMinutes) && timeMinutes > 0
          ? timeMinutes
          : undefined,
      };
    });
  }

  private resolveDisplayedWeightMetric(row: Record<string, unknown>): string {
    const explicit = this.readText(
      row['displayed_weights_metric'] ?? row['displayWeight']
    );
    if (explicit) {
      return explicit.toLowerCase().includes('body') ? 'bodyweight' : explicit;
    }

    const rawWeight = row['weights'] ?? row['weight'] ?? row['load'] ?? row['weights_kg'] ?? row['weight_kg'];
    if (typeof rawWeight === 'string') {
      const trimmed = rawWeight.trim();
      if (!trimmed || trimmed.toLowerCase().includes('body')) {
        return 'bodyweight';
      }
      return trimmed;
    }

    const parsedWeightKg = Number(rawWeight);
    if (Number.isFinite(parsedWeightKg) && parsedWeightKg > 0) {
      return `${Math.round(parsedWeightKg * 100) / 100} kg`;
    }

    return 'bodyweight';
  }

  private resolveStrengthWeightKg(row: Record<string, unknown>, userWeightKg: number): number {
    const explicitWeightKg = Number(row['weights_kg']);
    if (Number.isFinite(explicitWeightKg) && explicitWeightKg > 0) {
      return explicitWeightKg;
    }

    const rawWeight =
      row['displayed_weights_metric'] ??
      row['weights'] ??
      row['weight'] ??
      row['load'] ??
      row['weight_kg'];
    if (typeof rawWeight === 'number' && Number.isFinite(rawWeight) && rawWeight > 0) {
      return rawWeight;
    }

    const text = String(rawWeight ?? '').trim().toLowerCase();
    if (!text || text.includes('body')) {
      return userWeightKg > 0 ? userWeightKg : 0;
    }

    const match = text.match(
      /([0-9]*\.?[0-9]+)\s*(kg|kgs|kilogram|kilograms|lb|lbs|pound|pounds)?\b/
    );
    if (!match) {
      const parsed = Number(text);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
    }

    const amount = Number(match[1] ?? 0);
    const unit = String(match[2] ?? 'kg').toLowerCase();
    if (!Number.isFinite(amount) || amount <= 0) {
      return 0;
    }

    if (unit === 'lb' || unit === 'lbs' || unit === 'pound' || unit === 'pounds') {
      return amount * 0.45359237;
    }

    return amount;
  }

  private calculateTotalVolume(rows: StoredWorkoutTrainingRow[]): number {
    return rows.reduce((total, row) => {
      if (typeof row.weights_kg !== 'number' || !Number.isFinite(row.weights_kg) || row.weights_kg <= 0) {
        return total;
      }
      return total + row.sets * row.reps * row.weights_kg;
    }, 0);
  }

  private rowsToLegacyExercises(rows: WorkoutTrainingRow[]) {
    return rows.map((row) => {
      const metricWeight = row.displayed_weights_metric || 'bodyweight';
      return {
        name: this.fromSnakeCase(row.exercise_type),
        metric: `${row.sets} x ${row.reps} @ ${metricWeight}`,
        volume: typeof row.weights_kg === 'number' ? row.sets * row.reps * row.weights_kg : 0,
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
        displayed_weights_metric: this.resolveDisplayedWeightMetric(row),
        weights_kg: this.resolveStrengthWeightKg(row, 0),
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
      const distance = Number(row['distance_meters'] ?? row['distance'] ?? row['meters']);
      const time = Number(row['time_minutes'] ?? row['time'] ?? row['minutes'] ?? row['duration']);

      return {
        ...row,
        Training_Type: 'Cardio' as const,
        estimated_calories: this.toRoundedNonNegative(row['estimated_calories']),
        cardio_type: String(
          row['cardio_type'] ?? row['exercise_type'] ?? row['type'] ?? 'cardio_activity'
        ),
        display_distance: this.readText(
          row['display_distance'] ?? row['distance_input'] ?? row['distanceText'] ?? row['distance_text']
        ),
        distance_meters: Number.isFinite(distance) && distance > 0 ? distance : undefined,
        display_time: this.readText(
          row['display_time'] ?? row['time_input'] ?? row['timeText'] ?? row['time_text']
        ),
        time_minutes: Number.isFinite(time) && time > 0 ? time : undefined,
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
        display_time: row.reps > 0 ? `${row.reps} min` : '',
        time_minutes: row.reps,
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
        displayed_weights_metric: row.displayed_weights_metric,
        weights_kg: row.weights_kg,
      }));
  }

  private formatWeight(row: WorkoutTrainingRow | OtherTrainingRow | Record<string, unknown>): string {
    const record = row as Record<string, unknown>;
    const weightKg = Number(record['weights_kg'] ?? record['weights'] ?? record['weight_kg']);
    if (Number.isFinite(weightKg) && weightKg > 0) {
      return `${Math.round(weightKg * 100) / 100} kg`;
    }

    const displayValue = this.readText(record['displayed_weights_metric'] ?? record['displayWeight']);
    if (this.isBodyweightDisplayValue(displayValue)) {
      return 'bodyweight';
    }
    if (displayValue) {
      return displayValue;
    }

    const text = String(record['weights'] ?? record['weight'] ?? '').trim();
    if (!text || text.toLowerCase().includes('body')) {
      return 'bodyweight';
    }

    return text;
  }

  private isBodyweightDisplayValue(value: unknown): boolean {
    const text = String(value ?? '').trim().toLowerCase();
    return text === 'bodyweight' || text === 'body weight';
  }

  private formatCardioDistance(row: CardioTrainingRow): string {
    const distance = Number(row.distance_meters ?? row.distance);
    if (Number.isFinite(distance) && distance > 0) {
      return `${Math.round(distance)} m`;
    }

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

  private formatCardioTime(row: CardioTrainingRow): string {
    const time = Number(row.time_minutes ?? row.time);
    if (Number.isFinite(time) && time > 0) {
      return `${Math.round(time)} min`;
    }

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

  private resolveOtherTitle(row: OtherTrainingRow): string {
    return this.fromSnakeCase(
      String(row['exercise_type'] ?? row['activity'] ?? row['name'] ?? 'other_activity')
    );
  }

  private resolveOtherDetails(row: OtherTrainingRow): string {
    const sets = this.toRoundedNonNegative(row['sets']);
    const reps = this.toRoundedNonNegative(row['reps'] ?? row['time']);
    const weights = this.formatWeight(row);

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
