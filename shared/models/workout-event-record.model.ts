import type { WorkoutEvent } from './workout-event.model';

export const WORKOUT_EVENT_RECORD_SCHEMA_VERSION = 1;

export interface WorkoutEventRecord {
  schemaVersion: typeof WORKOUT_EVENT_RECORD_SCHEMA_VERSION;
  event: WorkoutEvent;
  createdAt?: unknown;
  updatedAt?: unknown;
}
