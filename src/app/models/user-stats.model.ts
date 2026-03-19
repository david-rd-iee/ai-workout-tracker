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

export interface ExpectedEffortCategoryMap {
  [key: string]: number;
}

export interface ExpectedEffortMap {
  Cardio: ExpectedEffortCategoryMap;
  Strength: ExpectedEffortCategoryMap;
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
  Expected_Effort?: ExpectedEffortMap;
  totalScore: number;

  level?: number;
  percentage_of_level?: number;

  region?: Region;
  displayName?: string; // optional but nice for UI
}

export interface UserLevelProgress {
  level: number;
  percentage_of_level: number;
}

export function calculateUserLevelProgress(totalScore: unknown): UserLevelProgress {
  const normalizedTotalScore = Number(totalScore);
  const safeTotalScore =
    Number.isFinite(normalizedTotalScore) && normalizedTotalScore > 0
      ? normalizedTotalScore
      : 0;
  const scaledLevelInHundredths = Math.round(0.2 * Math.sqrt(safeTotalScore) * 100);

  return {
    level: Math.floor(scaledLevelInHundredths / 100),
    percentage_of_level: scaledLevelInHundredths % 100,
  };
}
