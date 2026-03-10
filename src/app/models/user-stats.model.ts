// src/app/models/user-stats.model.ts
export interface Region {
  country: string;
  state: string;
  city: string;
}

export interface CardioScoreMap {
  [key: string]: number;
  totalCardioScore: number;
}

export interface StrengthScoreMap {
  [key: string]: number;
  totalStrengthScore: number;
}

export interface UserStats {
  userId: string;

  age: number;
  heightMeters: number;
  weightKg: number;
  bmi: number;
  sex: number;

  cardioScore: CardioScoreMap;
  strengthScore: StrengthScoreMap;
  expected_strength_scores?: Record<string, number>;
  totalScore: number;

  level?: number;

  region?: Region;
  displayName?: string; // optional but nice for UI
}
