import { Injectable } from '@angular/core';
import { Auth } from '@angular/fire/auth';
import {
  Firestore,
  DocumentData,
  DocumentReference,
  collection,
  doc,
  serverTimestamp,
  setDoc,
} from '@angular/fire/firestore';
import {
  workoutEventToWorkoutEventRecord,
  workoutEventToWorkoutSessionPerformance,
  workoutSessionPerformanceToWorkoutEvent,
} from '../adapters/workout-event.adapters';
import { WorkoutSessionPerformance } from '../models/workout-session.model';
import type { WorkoutEvent } from '../../../shared/models/workout-event.model';
import type { WorkoutEventRecordSubmissionMetadata } from '../../../shared/models/workout-event-record.model';

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
}

@Injectable({ providedIn: 'root' })
export class WorkoutLogService {
  constructor(
    private firestore: Firestore,
    private auth: Auth
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
    const workoutEventRef = doc(
      collection(this.firestore, `users/${user.uid}/workoutEvents`)
    );

    // Submit success ends at the canonical event write. Downstream effects run asynchronously.
    await setDoc(workoutEventRef, {
      ...this.buildPersistedWorkoutEventRecordPayload(savedEvent, {
        localSubmittedDate: this.toLocalDateKey(loggedAt),
        localSubmittedHour: loggedAt.getHours(),
      }),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    return {
      workoutEventRef,
      loggedAt,
      savedEvent,
      savedSession,
    };
  }

  private buildPersistedWorkoutEventRecordPayload(
    event: WorkoutEvent,
    submissionMetadata?: WorkoutEventRecordSubmissionMetadata
  ): Record<string, unknown> {
    return this.stripUndefinedDeep({
      ...workoutEventToWorkoutEventRecord(event),
      ...(submissionMetadata ? { submissionMetadata } : {}),
    }) as Record<string, unknown>;
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
}
