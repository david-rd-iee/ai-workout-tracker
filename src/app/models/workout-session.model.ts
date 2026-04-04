// Legacy UI/storage workout shape. The authoritative workout domain contract lives in shared/models/workout-event.model.ts.
export interface ExerciseSet {
  setNumber: number;
  weight: number;
  reps: number;
  notes?: string; // optional, for any comments the trainer should know
}

export interface ExerciseLog {
  name: string;
  isMainLift: boolean;
  sets: ExerciseSet[];
}

// Summary exercise shape used by AI + summary page
export interface SummaryExercise {
  name: string;   // e.g. "Bench Press"
  metric: string; // e.g. "3 x 8 @ 135 lb"
  volume: number; // per-exercise volume
}

export type TrainingType = 'Strength' | 'Cardio' | 'Other';
export type RowWeight = number | 'body weight';

export interface WorkoutTrainingRow {
  Training_Type: TrainingType;
  estimated_calories: number;
  exercise_type: string; // snake_case estimator id
  sets: number;
  reps: number;
  displayed_weights_metric?: string;
  weights_kg?: number;
  weights?: RowWeight; // legacy compatibility
}

export interface CardioRoutePoint {
  lat: number;
  lng: number;
  recorded_at: string;
  accuracy_meters?: number;
}

export interface CardioRouteBounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

export interface CardioTrainingRow {
  Training_Type: 'Cardio';
  estimated_calories: number;
  cardio_type: string; // e.g. running, biking
  exercise_type?: string; // compatibility alias used in some persisted logs
  display_distance?: string;
  distance_meters?: number;
  display_time?: string;
  time_minutes?: number;
  distance?: number; // legacy compatibility
  time?: number; // legacy compatibility
  activity_source?: string;
  started_at?: string;
  ended_at?: string;
  average_pace_minutes_per_km?: number;
  average_pace_minutes_per_mile?: number;
  route_points?: CardioRoutePoint[];
  route_bounds?: CardioRouteBounds;
  [key: string]: unknown;
}

export interface OtherTrainingRow {
  Training_Type: 'Other';
  estimated_calories: number;
  [key: string]: unknown;
}

export interface WorkoutSessionPerformance {
  date: string;
  trainingRows: WorkoutTrainingRow[];
  Training_Type?: TrainingType;
  strengthTrainingRow?: WorkoutTrainingRow[] | WorkoutTrainingRow;
  strengthTrainingRowss?: WorkoutTrainingRow[];
  cardioTrainingRow?: CardioTrainingRow[] | CardioTrainingRow;
  otherTrainingRow?: OtherTrainingRow[] | OtherTrainingRow;
  estimated_calories: number;
  trainer_notes: string;
  isComplete?: boolean;        // true when notes phase is complete

  // Legacy compatibility fields used by history/summary screens.
  sessionType?: string;
  notes?: string;              // overall notes for the trainer
  volume: number;              // total volume across all exercises
  calories: number;            // estimated calories for the workout
  exercises: SummaryExercise[]; // summarized exercises
}
