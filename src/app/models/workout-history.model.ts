export type StrengthHistoryEntry = {
  exercise: string;
  sets: number;
  reps: number;
  weights: string;
  caloriesBurned: number;
};

export type CardioHistoryEntry = {
  exercise: string;
  distance: string;
  time: string;
  caloriesBurned: number;
};

export type OtherHistoryEntry = {
  exercise: string;
  details: string;
  caloriesBurned: number;
};

export type WorkoutHistoryDateGroup = {
  date: string;
  strength: StrengthHistoryEntry[];
  cardio: CardioHistoryEntry[];
  other: OtherHistoryEntry[];
  totalCaloriesBurned: number;
  trainerNotes: string;
};
