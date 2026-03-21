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

export interface UserScore {
  cardioScore: CardioScoreMap;
  strengthScore: StrengthScoreMap;
  totalScore: number;
  maxAddedScoreWithinDay: number;
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

  userScore: UserScore;
  Expected_Effort?: ExpectedEffortMap;

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

export interface AddedScoreDaily {
  date: string;
  cardioScoreAddedToday: number;
  strengthScoreAddedToday: number;
  totalScoreAddedToday: number;
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

export function normalizeUserScore(
  value: unknown,
  legacyCardioScore?: unknown,
  legacyStrengthScore?: unknown,
  legacyTotalScore?: unknown,
  legacyWorkScore?: unknown
): UserScore {
  const userScore = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const cardioScore = normalizeCardioScoreMap(
    userScore['cardioScore'],
    legacyCardioScore
  );
  const strengthScore = normalizeStrengthScoreMap(
    userScore['strengthScore'],
    legacyStrengthScore ?? legacyWorkScore
  );
  const derivedTotalScore =
    normalizeScoreMapTotal(cardioScore, 'totalCardioScore') +
    normalizeScoreMapTotal(strengthScore, 'totalStrengthScore');

  return {
    cardioScore,
    strengthScore,
    totalScore: toWholeNumber(userScore['totalScore'] ?? legacyTotalScore, derivedTotalScore),
    maxAddedScoreWithinDay: toWholeNumber(userScore['maxAddedScoreWithinDay']),
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

function normalizeCardioScoreMap(
  value: unknown,
  legacyValue?: unknown
): CardioScoreMap {
  const normalized = normalizeScoreMap(value ?? legacyValue);
  return {
    ...normalized,
    totalCardioScore: normalizeScoreMapTotal(normalized, 'totalCardioScore'),
  };
}

function normalizeStrengthScoreMap(
  value: unknown,
  legacyValue?: unknown
): StrengthScoreMap {
  const normalized = normalizeScoreMap(value ?? legacyValue);
  return {
    ...normalized,
    totalStrengthScore: normalizeScoreMapTotal(normalized, 'totalStrengthScore'),
  };
}

function normalizeScoreMap(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return Object.entries(value as Record<string, unknown>).reduce<Record<string, number>>(
    (acc, [key, candidateValue]) => {
      const parsed = Number(candidateValue);
      if (Number.isFinite(parsed) && parsed >= 0) {
        acc[key] = Math.round(parsed);
      }
      return acc;
    },
    {}
  );
}

function normalizeScoreMapTotal(
  value: Record<string, number>,
  totalKey: string
): number {
  const explicitTotal = toWholeNumber(value[totalKey]);
  if (explicitTotal > 0) {
    return explicitTotal;
  }

  return Object.entries(value).reduce((sum, [key, score]) => (
    key === totalKey ? sum : sum + toWholeNumber(score)
  ), 0);
}

function toWholeNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return Math.max(0, Math.round(fallback));
  }

  return Math.round(parsed);
}
