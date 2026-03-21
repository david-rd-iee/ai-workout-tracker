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

export interface StreakData {
  currentStreak: number;
  maxStreak: number;
  lastLoggedDay?: string;
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
  streakData?: StreakData;

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

export function normalizeStreakData(
  value: unknown,
  legacyCurrentStreak?: unknown,
  legacyMaxStreak?: unknown
): StreakData {
  const streakData = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const currentStreak = toNonNegativeInteger(
    streakData['currentStreak'] ?? legacyCurrentStreak
  );
  const rawMaxStreak = toNonNegativeInteger(
    streakData['maxStreak'] ?? legacyMaxStreak
  );
  const lastLoggedDay = typeof streakData['lastLoggedDay'] === 'string'
    ? streakData['lastLoggedDay'].trim()
    : '';

  return {
    currentStreak,
    maxStreak: Math.max(rawMaxStreak, currentStreak),
    ...(lastLoggedDay ? { lastLoggedDay } : {}),
  };
}

function toNonNegativeInteger(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }

  return Math.floor(parsed);
}
