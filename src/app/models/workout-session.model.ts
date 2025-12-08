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

export interface WorkoutSessionPerformance {
  date: string;
  sessionType?: string;
  notes?: string;              // overall notes for the trainer
  volume: number;              // total volume across all exercises
  calories: number;            // estimated calories for the workout
  exercises: SummaryExercise[]; // summarized exercises
  isComplete?: boolean;        // view summary button after logs complete
}
