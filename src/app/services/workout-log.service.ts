import { Injectable } from '@angular/core';
import { Auth } from '@angular/fire/auth';
import { Firestore } from '@angular/fire/firestore';
import { doc, getDoc } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import {
  workoutEventToWorkoutSessionPerformance,
  workoutSessionPerformanceToWorkoutEvent,
} from '../adapters/workout-event.adapters';
import { WorkoutSessionPerformance } from '../models/workout-session.model';
import type {
  CompleteWorkoutEventRequest,
  CompleteWorkoutEventResponse,
} from '../../../shared/models/complete-workout-event.model';
import type { WorkoutEvent } from '../../../shared/models/workout-event.model';
import type { WorkoutEventRecordSubmissionMetadata } from '../../../shared/models/workout-event-record.model';

export interface StreakUpdateResult {
  kind: 'unchanged' | 'started' | 'extended' | 'restarted';
  previousCurrentStreak: number;
  currentStreak: number;
  previousMaxStreak: number;
  maxStreak: number;
}

export interface ExerciseScoreDelta {
  exerciseType: string;
  addedScore: number;
}

export interface ScoreUpdateResult {
  addedCardioScore: number;
  addedStrengthScore: number;
  addedTotalScore: number;
  currentTotalScore: number;
  exerciseScoreDeltas: ExerciseScoreDelta[];
}

export interface SaveCompletedWorkoutResult {
  eventId: string;
  status: CompleteWorkoutEventResponse['status'];
  loggedAt: Date;
  savedEvent: WorkoutEvent;
  savedSession: WorkoutSessionPerformance;
  scoreUpdate: ScoreUpdateResult | null;
}

@Injectable({ providedIn: 'root' })
export class WorkoutLogService {
  private readonly callableName = 'completeWorkoutEvent';
  private static readonly SCORE_AGGREGATION_WAIT_TIMEOUT_MS = 8000;
  private static readonly WORKOUT_SUMMARY_WAIT_TIMEOUT_MS = 8000;
  private static readonly SCORE_AGGREGATION_POLL_INTERVAL_MS = 250;

  constructor(
    private auth: Auth,
    private firestore: Firestore
  ) {}

  async saveCompletedWorkout(session: WorkoutSessionPerformance): Promise<SaveCompletedWorkoutResult> {
    const user = this.auth.currentUser;

    if (!user) {
      throw new Error('User not authenticated');
    }

    const loggedAt = new Date();
    const defaultDate = this.readText(session.date) || this.toLocalDateKey(loggedAt);
    const trainerNotes = this.readText(session.trainer_notes ?? session.notes);
    const savedEvent = workoutSessionPerformanceToWorkoutEvent({
      ...session,
      date: defaultDate,
      trainer_notes: trainerNotes,
      notes: trainerNotes,
      isComplete: true,
    });

    if (savedEvent.entries.length === 0) {
      throw new Error('Workout must include at least one entry');
    }

    const savedSession = workoutEventToWorkoutSessionPerformance(savedEvent);
    const callable = httpsCallable<CompleteWorkoutEventRequest, CompleteWorkoutEventResponse>(
      getFunctions(undefined, 'us-central1'),
      this.callableName
    );
    const submissionMetadata = this.buildSubmissionMetadata(loggedAt);

    // Submit success ends when the backend-owned canonical event write returns persisted.
    const response = await callable({
      event: savedEvent,
      submissionMetadata,
    });
    const [scoreUpdate] = await Promise.all([
      this.waitForScoreAggregation(user.uid, response.data.eventId),
      this.waitForWorkoutSummaryProjection(user.uid, response.data.eventId),
    ]);

    return {
      eventId: response.data.eventId,
      status: response.data.status,
      loggedAt,
      savedEvent,
      savedSession,
      scoreUpdate,
    };
  }

  private buildSubmissionMetadata(loggedAt: Date): WorkoutEventRecordSubmissionMetadata {
    return {
      localSubmittedDate: this.toLocalDateKey(loggedAt),
      localSubmittedHour: loggedAt.getHours(),
    };
  }

  private readText(value: unknown): string {
    return typeof value === 'string'
      ? value.trim()
      : String(value ?? '').trim();
  }

  private toLocalDateKey(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private async waitForScoreAggregation(
    userId: string,
    eventId: string
  ): Promise<ScoreUpdateResult | null> {
    const scoreAggregationRef = doc(
      this.firestore,
      'users',
      userId,
      'workoutEvents',
      eventId,
      'derivations',
      'score_aggregation'
    );
    const deadline = Date.now() + WorkoutLogService.SCORE_AGGREGATION_WAIT_TIMEOUT_MS;

    while (Date.now() < deadline) {
      try {
        const snapshot = await getDoc(scoreAggregationRef);
        if (snapshot.exists()) {
          const status = this.readText(snapshot.data()?.['status']).toLowerCase();
          if (status === 'completed') {
            return this.parseScoreUpdate(snapshot.data());
          }

          if (status === 'failed') {
            const reason = this.readText(snapshot.data()?.['reason']) || 'score aggregation failed';
            throw new Error(reason);
          }
        }
      } catch (error) {
        console.warn('[WorkoutLogService] Failed while waiting for score aggregation:', error);
        return null;
      }

      await this.delay(WorkoutLogService.SCORE_AGGREGATION_POLL_INTERVAL_MS);
    }

    console.warn('[WorkoutLogService] Timed out waiting for score aggregation to complete.', {
      userId,
      eventId,
    });
    return null;
  }

  private async waitForWorkoutSummaryProjection(userId: string, eventId: string): Promise<void> {
    const workoutSummaryRef = doc(
      this.firestore,
      'users',
      userId,
      'workoutEvents',
      eventId,
      'derivations',
      'workout_summary'
    );
    const deadline = Date.now() + WorkoutLogService.WORKOUT_SUMMARY_WAIT_TIMEOUT_MS;

    while (Date.now() < deadline) {
      try {
        const snapshot = await getDoc(workoutSummaryRef);
        if (snapshot.exists()) {
          const status = this.readText(snapshot.data()?.['status']).toLowerCase();
          if (status === 'completed') {
            return;
          }

          if (status === 'failed') {
            return;
          }
        }
      } catch (error) {
        console.warn('[WorkoutLogService] Failed while waiting for workout summary projection:', error);
        return;
      }

      await this.delay(WorkoutLogService.SCORE_AGGREGATION_POLL_INTERVAL_MS);
    }

    console.warn('[WorkoutLogService] Timed out waiting for workout summary projection.', {
      userId,
      eventId,
    });
  }

  private delay(durationMs: number): Promise<void> {
    return new Promise((resolve) => {
      globalThis.setTimeout(resolve, durationMs);
    });
  }

  private parseScoreUpdate(candidate: Record<string, unknown> | undefined): ScoreUpdateResult | null {
    if (!candidate) {
      return null;
    }

    return {
      addedCardioScore: this.toWholeNumber(candidate['addedCardioScore']),
      addedStrengthScore: this.toWholeNumber(candidate['addedStrengthScore']),
      addedTotalScore: this.toWholeNumber(candidate['addedTotalScore']),
      currentTotalScore: this.toWholeNumber(candidate['currentTotalScore']),
      exerciseScoreDeltas: this.normalizeExerciseScoreDeltas(candidate['exerciseScoreDeltas']),
    };
  }

  private normalizeExerciseScoreDeltas(candidate: unknown): ExerciseScoreDelta[] {
    if (!Array.isArray(candidate)) {
      return [];
    }

    return candidate.reduce<ExerciseScoreDelta[]>((acc, entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        return acc;
      }

      const record = entry as Record<string, unknown>;
      const exerciseType = this.readText(record['exerciseType']);
      if (!exerciseType) {
        return acc;
      }

      acc.push({
        exerciseType,
        addedScore: this.toWholeNumber(record['addedScore']),
      });
      return acc;
    }, []);
  }

  private toWholeNumber(value: unknown): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) {
      return 0;
    }

    return Math.round(parsed);
  }
}
