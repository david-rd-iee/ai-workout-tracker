import type { WorkoutEvent, WorkoutEventDate } from './workout-event.model';

/**
 * Backend-owned daily workout projection built from one or more completed workout events.
 */
export interface WorkoutSummary {
  /**
   * Local workout date in YYYY-MM-DD format.
   */
  date: WorkoutEventDate;

  /**
   * Source workout event ids included in this daily summary.
   */
  workoutEventIds: string[];

  /**
   * Number of workout events represented by this summary.
   */
  eventCount: number;

  /**
   * Merged workout facts for the day.
   */
  aggregate: WorkoutEvent;

  /**
   * ISO timestamp of the first workout event included in the summary.
   */
  firstEventCreatedAt?: string;

  /**
   * ISO timestamp of the latest workout event included in the summary.
   */
  lastEventCreatedAt?: string;
}
