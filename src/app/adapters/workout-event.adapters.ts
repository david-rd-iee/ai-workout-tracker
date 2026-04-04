import type { WorkoutSessionPerformance } from '../models/workout-session.model';
import type { WorkoutEvent } from '../../../shared/models/workout-event.model';
import type { WorkoutEventRecord } from '../../../shared/models/workout-event-record.model';
import {
  applyTrainerNotesToWorkoutEvent,
  createEmptyWorkoutEvent,
  mergeWorkoutEvents,
  normalizeWorkoutEventCandidate,
  workoutEventRecordToWorkoutEvent as sharedWorkoutEventRecordToWorkoutEvent,
  workoutEventToLegacyWorkoutSession,
  workoutEventToRecord,
} from '../../../shared/adapters/workout-event.adapters';

export function createEmptyWorkoutSessionPerformance(
  date = new Date().toISOString().slice(0, 10)
): WorkoutSessionPerformance {
  return workoutEventToWorkoutSessionPerformance(createEmptyWorkoutEvent(date));
}

export function workoutSessionPerformanceToWorkoutEvent(
  session: Partial<WorkoutSessionPerformance> | Record<string, unknown> | null | undefined
): WorkoutEvent {
  return normalizeWorkoutEventCandidate(session);
}

export function workoutEventToWorkoutSessionPerformance(
  event: WorkoutEvent
): WorkoutSessionPerformance {
  return workoutEventToLegacyWorkoutSession(event) as WorkoutSessionPerformance;
}

export function mergeWorkoutSessionPerformances(
  sessions: Array<Partial<WorkoutSessionPerformance> | Record<string, unknown> | null | undefined>,
  options: {
    date?: string;
    trainerNotes?: string;
    isComplete?: boolean;
    source?: WorkoutEvent['source'];
  } = {}
): WorkoutSessionPerformance {
  const merged = mergeWorkoutEvents(
    sessions.map((session) => workoutSessionPerformanceToWorkoutEvent(session)),
    options
  );
  return workoutEventToWorkoutSessionPerformance(merged);
}

export function applyTrainerNotesToWorkoutSessionPerformance(
  session: Partial<WorkoutSessionPerformance> | Record<string, unknown> | null | undefined,
  trainerNotes: string,
  isComplete = true
): WorkoutSessionPerformance {
  const event = workoutSessionPerformanceToWorkoutEvent(session);
  return workoutEventToWorkoutSessionPerformance(
    applyTrainerNotesToWorkoutEvent(event, trainerNotes, isComplete)
  );
}

export function workoutEventRecordFromWorkoutSessionPerformance(
  session: Partial<WorkoutSessionPerformance> | Record<string, unknown> | null | undefined
): WorkoutEventRecord {
  return workoutEventToRecord(workoutSessionPerformanceToWorkoutEvent(session));
}

export function workoutEventToWorkoutEventRecord(event: WorkoutEvent): WorkoutEventRecord {
  return workoutEventToRecord(event);
}

export function workoutEventRecordToWorkoutEvent(candidate: unknown): WorkoutEvent {
  return sharedWorkoutEventRecordToWorkoutEvent(candidate);
}
