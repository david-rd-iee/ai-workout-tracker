import { Injectable } from '@angular/core';
import { Auth } from '@angular/fire/auth';
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

export interface SaveCompletedWorkoutResult {
  eventId: string;
  status: CompleteWorkoutEventResponse['status'];
  loggedAt: Date;
  savedEvent: WorkoutEvent;
  savedSession: WorkoutSessionPerformance;
}

@Injectable({ providedIn: 'root' })
export class WorkoutLogService {
  private readonly callableName = 'completeWorkoutEvent';

  constructor(private auth: Auth) {}

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

    return {
      eventId: response.data.eventId,
      status: response.data.status,
      loggedAt,
      savedEvent,
      savedSession,
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
}
