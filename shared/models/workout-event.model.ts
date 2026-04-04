/**
 * Authoritative workout domain contract shared across workout submission flows.
 *
 * Scope:
 * - Captures workout facts and workout-entry data only.
 * - Excludes booking/calendar state, chat transcript data, trainer report projections,
 *   leaderboard aggregates, and storage-specific aliases.
 */

/**
 * Local workout date in YYYY-MM-DD format.
 */
export type WorkoutEventDate = string;

/**
 * Submission/source hint for the workout event. This is domain metadata, not a UI routing field.
 */
export type WorkoutEventSource =
  | 'chat'
  | 'treadmill_logger'
  | 'map_tracking'
  | 'manual'
  | 'imported';

export interface WorkoutEvent {
  /**
   * Local workout date.
   * Current adapters map this from legacy `date`.
   */
  date: WorkoutEventDate;

  /**
   * Canonical domain entries for the workout.
   * This replaces legacy row collections such as `trainingRows`,
   * `strengthTrainingRow`, `cardioTrainingRow`, and `otherTrainingRow`.
   */
  entries: WorkoutEventEntry[];

  /**
   * Session-level summary shared across current workout ingestion flows.
   */
  summary: WorkoutEventSummary;

  /**
   * Optional source hint for ingestion-specific adapters.
   * Current adapters may map this from `sessionType` or row-level activity metadata.
   */
  source?: WorkoutEventSource;
}

export interface WorkoutEventSummary {
  /**
   * Total estimated calories for the workout event.
   * Current adapters map this from legacy `estimated_calories` / `estimatedCalories` / `calories`.
   */
  estimatedCalories: number;

  /**
   * Notes intended for the trainer.
   * Current adapters map this from legacy `trainer_notes`, `trainerNotes`, or `notes`.
   */
  trainerNotes: string;

  /**
   * Indicates whether the workout event is complete and ready for downstream processing.
   */
  isComplete: boolean;
}

export type WorkoutEventEntry =
  | StrengthWorkoutEventEntry
  | CardioWorkoutEventEntry
  | OtherWorkoutEventEntry;

interface WorkoutEventEntryBase {
  /**
   * Per-entry estimated calories used by score and history projections.
   */
  estimatedCalories: number;
}

export interface StrengthWorkoutLoad {
  /**
   * Original user-facing load text such as `135 lb`, `60 kg`, or `bodyweight`.
   */
  displayText: string;

  /**
   * Normalized kilogram value used for calculations.
   */
  weightKg: number;
}

export interface StrengthWorkoutEventEntry extends WorkoutEventEntryBase {
  kind: 'strength';
  exerciseType: string;
  sets: number;
  reps: number;
  load: StrengthWorkoutLoad;
}

export interface WorkoutDistanceMeasurement {
  displayText?: string;
  meters?: number;
}

export interface WorkoutDurationMeasurement {
  displayText?: string;
  minutes?: number;
}

export interface CardioWorkoutRoutePoint {
  lat: number;
  lng: number;
  recordedAt: string;
  accuracyMeters?: number;
}

export interface CardioWorkoutRouteBounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

export interface CardioWorkoutRoute {
  points: CardioWorkoutRoutePoint[];
  bounds?: CardioWorkoutRouteBounds;
}

export interface CardioWorkoutEventEntry extends WorkoutEventEntryBase {
  kind: 'cardio';
  cardioType: string;
  distance?: WorkoutDistanceMeasurement;
  duration?: WorkoutDurationMeasurement;
  activitySource?: string;
  startedAt?: string;
  endedAt?: string;
  averagePaceMinutesPerKm?: number;
  averagePaceMinutesPerMile?: number;
  route?: CardioWorkoutRoute;
}

export interface OtherWorkoutEventEntry extends WorkoutEventEntryBase {
  kind: 'other';
  activityType: string;
  /**
   * Free-form structured details for activities that do not fit the strength/cardio contracts.
   */
  details?: Record<string, unknown>;
}
