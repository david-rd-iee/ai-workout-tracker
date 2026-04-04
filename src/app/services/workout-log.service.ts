import { Injectable } from '@angular/core';
import {
  Firestore,
  DocumentData,
  DocumentReference,
  getDocs,
  doc,
  getDoc,
  setDoc,
  collection,
  addDoc,
  query,
  runTransaction,
  serverTimestamp,
  where,
} from '@angular/fire/firestore';
import { Auth } from '@angular/fire/auth';
import {
  workoutEventRecordToWorkoutEvent,
  workoutEventToWorkoutEventRecord,
  workoutEventToWorkoutSessionPerformance,
  workoutSessionPerformanceToWorkoutEvent,
} from '../adapters/workout-event.adapters';
import {
  CardioRouteBounds,
  CardioRoutePoint,
  CardioTrainingRow,
  OtherTrainingRow,
  WorkoutSessionPerformance,
  WorkoutTrainingRow,
} from '../models/workout-session.model';
import {
  EarlyMorningWorkoutsTracker,
  normalizeEarlyMorningWorkoutsTracker,
  normalizeStreakData,
  StreakData,
} from '../models/user-stats.model';
import type { WorkoutEvent } from '../../../shared/models/workout-event.model';
import { ChatsService } from './chats.service';
import { UpdateScoreResult, UpdateScoreService } from './update-score.service';
import { WorkoutSessionFormatterService } from './workout-session-formatter.service';

export interface StreakUpdateResult {
  kind: 'unchanged' | 'started' | 'extended' | 'restarted';
  previousCurrentStreak: number;
  currentStreak: number;
  previousMaxStreak: number;
  maxStreak: number;
}

export interface SaveCompletedWorkoutResult {
  workoutEventRef: DocumentReference<DocumentData>;
  loggedAt: Date;
  savedEvent: WorkoutEvent;
  savedSession: WorkoutSessionPerformance;
  scoreUpdate: UpdateScoreResult | null;
  streakUpdate: StreakUpdateResult;
}

type StoredWorkoutTrainingRow = WorkoutTrainingRow;

@Injectable({ providedIn: 'root' })
export class WorkoutLogService {
  constructor(
    private firestore: Firestore,
    private auth: Auth,
    private chatsService: ChatsService,
    private updateScoreService: UpdateScoreService,
    private workoutSessionFormatter: WorkoutSessionFormatterService
  ) {}

  async saveCompletedWorkout(session: WorkoutSessionPerformance): Promise<SaveCompletedWorkoutResult> {
    const user = this.auth.currentUser;

    if (!user) {
      throw new Error('User not authenticated');
    }

    const workoutEventsRef = collection(
      this.firestore,
      `users/${user.uid}/workoutEvents`
    );
    const loggedAt = new Date();
    const defaultDate = this.readText(session.date) || this.toLocalDateKey(loggedAt);
    const normalizedIncomingSession = this.workoutSessionFormatter.applyTrainerNotes(
      this.workoutSessionFormatter.normalizeSession(session, {
        defaultDate,
        defaultTrainerNotes: this.readText(session.trainer_notes ?? session.notes),
      }),
      this.readText(session.trainer_notes ?? session.notes),
      true
    );
    const savedEvent = workoutSessionPerformanceToWorkoutEvent(normalizedIncomingSession);
    const savedSession = workoutEventToWorkoutSessionPerformance(savedEvent);
    const workoutEventRef = doc(workoutEventsRef);
    const trainingRows = Array.isArray(savedSession.trainingRows)
      ? savedSession.trainingRows
      : [];
    const estimatedCalories = Number(
      savedSession.estimated_calories ?? savedSession.calories ?? 0
    );
    const trainerNotes = savedSession.trainer_notes ?? savedSession.notes ?? '';
    const totalVolume = Number(savedSession.volume ?? 0);
    const trainerUid = await this.resolveCurrentTrainerUid(user.uid);
    const streakUpdate = await this.saveWorkoutEventAndUpdateStreak({
      userId: user.uid,
      workoutEventRef,
      eventToStore: savedEvent,
      loggedAt,
    });
    await this.refreshDerivedWorkoutHistoryDay({
      userId: user.uid,
      loggedDay: savedEvent.date,
    });

    let scoreUpdate: UpdateScoreResult | null = null;
    try {
      scoreUpdate = await this.updateScoreService.updateScoreAfterWorkout({
        userId: user.uid,
        event: savedEvent,
        workoutEventId: workoutEventRef.id,
      });
    } catch (error) {
      console.error('[WorkoutLogService] Failed to update user score:', error);
    }

    if (trainerUid) {
      await this.sendSummaryToCurrentTrainer({
        trainerUid,
        clientUid: user.uid,
        clientWorkoutEventId: workoutEventRef.id,
        session: savedSession,
        trainingRows,
        estimatedCalories,
        totalVolume,
        trainerNotes,
      });
      await this.sendSummaryMessageToTrainer({
        trainerUid,
        clientUid: user.uid,
        session: savedSession,
        trainingRows,
        estimatedCalories,
        trainerNotes,
        loggedAt,
      });
    }

    return {
      workoutEventRef,
      loggedAt,
      savedEvent,
      savedSession,
      scoreUpdate,
      streakUpdate,
    };
  }

  private async sendSummaryToCurrentTrainer(params: {
    trainerUid: string;
    clientUid: string;
    clientWorkoutEventId: string;
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
      clientWorkoutEventId: params.clientWorkoutEventId,
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
      source: this.readText(params.session.sessionType) || 'workout_event',
      sourceModel: 'workout_event',
      isDerivedProjection: true,
      derivedProjectionType: 'trainer_summary',
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
    loggedAt: Date;
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
      params.loggedAt
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

  private async saveWorkoutEventAndUpdateStreak(params: {
    userId: string;
    workoutEventRef: DocumentReference<DocumentData>;
    eventToStore: WorkoutEvent;
    loggedAt: Date;
  }): Promise<StreakUpdateResult> {
    const loggedDay = this.readText(params.eventToStore.date) || this.toLocalDateKey(params.loggedAt);
    const userStatsRef = doc(this.firestore, 'userStats', params.userId);

    return runTransaction(this.firestore, async (transaction) => {
      const [userStatsSnap, workoutEventSnap] = await Promise.all([
        transaction.get(userStatsRef),
        transaction.get(params.workoutEventRef),
      ]);
      const currentUserStats = userStatsSnap.exists()
        ? userStatsSnap.data() as Record<string, unknown>
        : {};
      const currentStreakData = normalizeStreakData(
        currentUserStats['streakData'],
        currentUserStats['currentStreak'],
        currentUserStats['maxStreak']
      );
      const nextStreakData = this.calculateNextStreakData(currentStreakData, loggedDay);
      const currentEarlyMorningWorkoutsTracker = normalizeEarlyMorningWorkoutsTracker(
        currentUserStats['earlymorningWorkoutsTracker']
      );
      const nextEarlyMorningWorkoutsTracker = this.calculateNextEarlyMorningWorkoutsTracker(
        currentEarlyMorningWorkoutsTracker,
        params.loggedAt
      );
      const payload = this.buildPersistedWorkoutEventRecordPayload(params.eventToStore);
      transaction.set(
        params.workoutEventRef,
        {
          ...payload,
          ...(workoutEventSnap.exists() ? {} : { createdAt: serverTimestamp() }),
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      transaction.set(
        userStatsRef,
        {
          userId: params.userId,
          streakData: nextStreakData,
          earlymorningWorkoutsTracker: nextEarlyMorningWorkoutsTracker,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      return this.buildStreakUpdateResult(currentStreakData, nextStreakData);
    });
  }

  private async refreshDerivedWorkoutHistoryDay(params: {
    userId: string;
    loggedDay: string;
  }): Promise<void> {
    const workoutEventsRef = collection(
      this.firestore,
      `users/${params.userId}/workoutEvents`
    );
    const workoutLogRef = doc(
      this.firestore,
      `users/${params.userId}/workoutLogs/${params.loggedDay}`
    );
    const [eventSnap, workoutLogSnap] = await Promise.all([
      getDocs(query(workoutEventsRef, where('event.date', '==', params.loggedDay))),
      getDoc(workoutLogRef),
    ]);

    const derivedEvents = eventSnap.docs
      .map((docSnap) => {
        const raw = docSnap.data() as Record<string, unknown>;
        return {
          workoutEventId: docSnap.id,
          createdAt: raw['createdAt'],
          event: workoutEventRecordToWorkoutEvent(raw),
        };
      })
      .sort((left, right) => (
        this.toTimestampMillis(left.createdAt) - this.toTimestampMillis(right.createdAt)
      ));

    if (derivedEvents.length === 0) {
      return;
    }

    const derivedSession = this.workoutSessionFormatter.mergeSessions(
      derivedEvents.map(({ event }) => workoutEventToWorkoutSessionPerformance(event)),
      {
        date: params.loggedDay,
        isComplete: derivedEvents.every(({ event }) => !!event.summary.isComplete),
      }
    );
    const payload = this.buildDerivedWorkoutHistoryPayload({
      session: derivedSession,
      workoutEventIds: derivedEvents.map(({ workoutEventId }) => workoutEventId),
    });

    await setDoc(
      workoutLogRef,
      {
        ...payload,
        ...(workoutLogSnap.exists() ? {} : { createdAt: serverTimestamp() }),
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
  }

  private buildDerivedWorkoutHistoryPayload(params: {
    session: WorkoutSessionPerformance;
    workoutEventIds: string[];
  }): Record<string, unknown> {
    const normalizedSession = this.workoutSessionFormatter.normalizeSession(params.session, {
      defaultDate: this.readText(params.session.date) || this.toLocalDateKey(new Date()),
      defaultTrainerNotes: this.readText(params.session.trainer_notes ?? params.session.notes),
      isComplete: !!params.session.isComplete,
      sessionType: this.readText(params.session.sessionType),
    });
    const trainerNotes = this.readText(
      normalizedSession.trainer_notes ?? normalizedSession.notes
    );
    const estimatedCalories = this.toRoundedNonNegative(
      normalizedSession.estimated_calories ?? normalizedSession.calories
    );
    const totalVolume = this.toRoundedNonNegative(normalizedSession.volume);
    const strengthTrainingRow = this.toObjectArray(
      normalizedSession.strengthTrainingRow ?? normalizedSession.strengthTrainingRowss ?? []
    );

    return this.stripUndefinedDeep({
      date: normalizedSession.date,
      trainingRows: Array.isArray(normalizedSession.trainingRows)
        ? normalizedSession.trainingRows
        : [],
      strengthTrainingRow,
      strengthTrainingRowss: strengthTrainingRow,
      cardioTrainingRow: this.toObjectArray(normalizedSession.cardioTrainingRow ?? []),
      otherTrainingRow: this.toObjectArray(normalizedSession.otherTrainingRow ?? []),
      estimatedCalories,
      estimated_calories: estimatedCalories,
      calories: estimatedCalories,
      totalVolume,
      volume: totalVolume,
      trainerNotes,
      trainer_notes: trainerNotes,
      notes: trainerNotes,
      isComplete: !!normalizedSession.isComplete,
      sessionType: this.readText(normalizedSession.sessionType),
      exercises: Array.isArray(normalizedSession.exercises) ? normalizedSession.exercises : [],
      sourceModel: 'workout_event',
      isDerivedProjection: true,
      derivedProjectionType: 'workout_history_day',
      derivedFromWorkoutEventIds: params.workoutEventIds,
      derivedFromWorkoutEventCount: params.workoutEventIds.length,
    }) as Record<string, unknown>;
  }

  private calculateNextStreakData(currentStreakData: StreakData, loggedDay: string): StreakData {
    if (currentStreakData.lastLoggedDay === loggedDay) {
      return { ...currentStreakData };
    }

    const dayGap = this.calculateDayGap(currentStreakData.lastLoggedDay, loggedDay);
    const nextCurrentStreak = dayGap === 1
      ? currentStreakData.currentStreak + 1
      : 1;

    return {
      currentStreak: nextCurrentStreak,
      maxStreak: Math.max(currentStreakData.maxStreak, nextCurrentStreak),
      totalNumberOfDaysTracked: currentStreakData.totalNumberOfDaysTracked + 1,
      lastLoggedDay: loggedDay,
    };
  }

  private buildStreakUpdateResult(
    currentStreakData: StreakData,
    nextStreakData: StreakData
  ): StreakUpdateResult {
    let kind: StreakUpdateResult['kind'] = 'started';

    if (currentStreakData.lastLoggedDay === nextStreakData.lastLoggedDay) {
      kind = 'unchanged';
    } else if (nextStreakData.currentStreak === currentStreakData.currentStreak + 1) {
      kind = 'extended';
    } else if (currentStreakData.currentStreak > 0 && nextStreakData.currentStreak === 1) {
      kind = 'restarted';
    }

    return {
      kind,
      previousCurrentStreak: currentStreakData.currentStreak,
      currentStreak: nextStreakData.currentStreak,
      previousMaxStreak: currentStreakData.maxStreak,
      maxStreak: nextStreakData.maxStreak,
    };
  }

  private calculateNextEarlyMorningWorkoutsTracker(
    currentTracker: EarlyMorningWorkoutsTracker,
    loggedAt: Date
  ): EarlyMorningWorkoutsTracker {
    if (!(loggedAt instanceof Date) || !Number.isFinite(loggedAt.getTime())) {
      return { ...currentTracker };
    }

    if (loggedAt.getHours() >= 7) {
      return { ...currentTracker };
    }

    const loggedDay = this.toLocalDateKey(loggedAt);
    if (currentTracker.dateLastUpdated === loggedDay) {
      return { ...currentTracker };
    }

    return {
      dateLastUpdated: loggedDay,
      earlyMorningWorkoutNumber: currentTracker.earlyMorningWorkoutNumber + 1,
    };
  }

  private calculateDayGap(previousLoggedDay: string | undefined, currentLoggedDay: string): number | null {
    const previousDate = this.parseLocalDayKey(previousLoggedDay);
    const currentDate = this.parseLocalDayKey(currentLoggedDay);
    if (!previousDate || !currentDate) {
      return null;
    }

    return Math.round((currentDate.getTime() - previousDate.getTime()) / 86400000);
  }

  private parseLocalDayKey(value: string | undefined): Date | null {
    if (!value) {
      return null;
    }

    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
    if (!match) {
      return null;
    }

    const year = Number(match[1]);
    const monthIndex = Number(match[2]) - 1;
    const day = Number(match[3]);
    const parsed = new Date(year, monthIndex, day);
    if (
      parsed.getFullYear() !== year ||
      parsed.getMonth() !== monthIndex ||
      parsed.getDate() !== day
    ) {
      return null;
    }

    return parsed;
  }

  private toLocalDateKey(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private toTimestampMillis(value: unknown): number {
    try {
      const dateValue = (value as { toDate?: () => Date } | null | undefined)?.toDate?.() ?? value;
      if (dateValue instanceof Date && !Number.isNaN(dateValue.getTime())) {
        return dateValue.getTime();
      }

      const parsed = new Date(String(dateValue ?? ''));
      return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
    } catch {
      return 0;
    }
  }

  private buildPersistedWorkoutEventRecordPayload(
    event: WorkoutEvent
  ): Record<string, unknown> {
    return this.stripUndefinedDeep(
      workoutEventToWorkoutEventRecord(event)
    ) as Record<string, unknown>;
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
        exercise_type: String(
          row['exercise_type'] ?? row['cardio_type'] ?? row['type'] ?? 'cardio_activity'
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
        activity_source: this.readText(row['activity_source'] ?? row['activitySource']),
        started_at: this.readText(row['started_at'] ?? row['startedAt']),
        ended_at: this.readText(row['ended_at'] ?? row['endedAt']),
        average_pace_minutes_per_km: this.toOptionalPositiveNumber(
          row['average_pace_minutes_per_km'] ?? row['averagePaceMinutesPerKm']
        ),
        average_pace_minutes_per_mile: this.toOptionalPositiveNumber(
          row['average_pace_minutes_per_mile'] ?? row['averagePaceMinutesPerMile']
        ),
        route_points: this.normalizeRoutePoints(row['route_points'] ?? row['routePoints']),
        route_bounds: this.normalizeRouteBounds(row['route_bounds'] ?? row['routeBounds']),
      };
    });
  }

  private prepareOtherRowsForStorage(rows: Array<Record<string, unknown>>): OtherTrainingRow[] {
    return rows.map((row) => ({
      ...row,
      Training_Type: 'Other',
      estimated_calories: this.toRoundedNonNegative(row['estimated_calories']),
    })) as OtherTrainingRow[];
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
        exercise_type: String(
          row['exercise_type'] ?? row['cardio_type'] ?? row['type'] ?? 'cardio_activity'
        ),
        display_distance: this.readText(
          row['display_distance'] ?? row['distance_input'] ?? row['distanceText'] ?? row['distance_text']
        ),
        distance_meters: Number.isFinite(distance) && distance > 0 ? distance : undefined,
        display_time: this.readText(
          row['display_time'] ?? row['time_input'] ?? row['timeText'] ?? row['time_text']
        ),
        time_minutes: Number.isFinite(time) && time > 0 ? time : undefined,
        activity_source: this.readText(row['activity_source'] ?? row['activitySource']),
        started_at: this.readText(row['started_at'] ?? row['startedAt']),
        ended_at: this.readText(row['ended_at'] ?? row['endedAt']),
        average_pace_minutes_per_km: this.toOptionalPositiveNumber(
          row['average_pace_minutes_per_km'] ?? row['averagePaceMinutesPerKm']
        ),
        average_pace_minutes_per_mile: this.toOptionalPositiveNumber(
          row['average_pace_minutes_per_mile'] ?? row['averagePaceMinutesPerMile']
        ),
        route_points: this.normalizeRoutePoints(row['route_points'] ?? row['routePoints']),
        route_bounds: this.normalizeRouteBounds(row['route_bounds'] ?? row['routeBounds']),
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
        exercise_type: row.exercise_type,
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

  private normalizeRoutePoints(value: unknown): CardioRoutePoint[] | undefined {
    const points = this.toObjectArray(value)
      .map((point): CardioRoutePoint | null => {
        const lat = Number(point['lat']);
        const lng = Number(point['lng']);
        const recordedAt = this.readText(point['recorded_at'] ?? point['recordedAt']);
        const accuracyMeters = Number(point['accuracy_meters'] ?? point['accuracyMeters']);

        if (!Number.isFinite(lat) || !Number.isFinite(lng) || !recordedAt) {
          return null;
        }

        return {
          lat,
          lng,
          recorded_at: recordedAt,
          accuracy_meters: Number.isFinite(accuracyMeters) && accuracyMeters >= 0
            ? accuracyMeters
            : undefined,
        };
      })
      .filter((point): point is CardioRoutePoint => !!point);

    return points.length > 0 ? points : undefined;
  }

  private normalizeRouteBounds(value: unknown): CardioRouteBounds | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return undefined;
    }

    const bounds = value as Record<string, unknown>;
    const north = Number(bounds['north']);
    const south = Number(bounds['south']);
    const east = Number(bounds['east']);
    const west = Number(bounds['west']);

    if (
      !Number.isFinite(north) ||
      !Number.isFinite(south) ||
      !Number.isFinite(east) ||
      !Number.isFinite(west)
    ) {
      return undefined;
    }

    return { north, south, east, west };
  }

  private toOptionalPositiveNumber(value: unknown): number | undefined {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
  }

  private stripUndefinedDeep(value: unknown): unknown {
    if (value === undefined) {
      return undefined;
    }

    if (Array.isArray(value)) {
      return value
        .map((entry) => this.stripUndefinedDeep(entry))
        .filter((entry) => entry !== undefined);
    }

    if (value && typeof value === 'object') {
      return Object.entries(value as Record<string, unknown>).reduce<Record<string, unknown>>(
        (sanitized, [key, entry]) => {
          const cleanedEntry = this.stripUndefinedDeep(entry);
          if (cleanedEntry !== undefined) {
            sanitized[key] = cleanedEntry;
          }
          return sanitized;
        },
        {}
      );
    }

    return value;
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
