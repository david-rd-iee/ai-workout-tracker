// src/app/models/user-stats.model.ts
export interface Region {
  country: string;
  state: string;
  city: string;
}

export interface CardioScoreMap {
  totalCardioScore: number;
}

export interface StrengthScoreMap {
  totalStrengthScore: number;
}

export interface UserStats {
  userId: string;

  age: number;
  heightMeters: number;
  weightKg: number;
  bmi: number;

  cardioScore: CardioScoreMap;
  strengthScore: StrengthScoreMap;
  totalScore: number;

  level?: number;

  region?: Region;
  displayName?: string; // optional but nice for UI
}
