export interface ExerciseSet {
    setNumber: number;
    weight: number;
    reps: number;

    notes?: string; //optional, for any comments the trainer should know
}

export interface ExerciseLog {
    name: string;
    isMainLift: boolean;
    sets: ExerciseSet[];
}

export interface WorkoutSessionPerformance {
    date: string;
    sessionType: string;
    exercises: ExerciseLog[];
}