// src/app/models/user-stats.model.ts
export interface Region {
  country: string;
  state: string;
  city: string;
  countryCode?: string;
  stateCode?: string;
  cityId?: string;
  countryName?: string;
  stateName?: string;
  cityName?: string;
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
  totalNumberOfDaysTracked: number;
  lastLoggedDay?: string;
}

export interface EarlyMorningWorkoutsTracker {
  dateLastUpdated?: string;
  earlyMorningWorkoutNumber: number;
}

export interface GroupRankingsMap {
  totalNumberOfMembers: number;
  lastUpdated?: string;
  [key: string]: number | string | undefined;
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
  earlymorningWorkoutsTracker: EarlyMorningWorkoutsTracker;
  groupRankings?: GroupRankingsMap;

  region?: Region;
  displayName?: string; // optional but nice for UI
  trainerVerified?: boolean;
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
  const maxStreak = Math.max(rawMaxStreak, currentStreak);
  const totalNumberOfDaysTracked = Math.max(
    toNonNegativeInteger(streakData['totalNumberOfDaysTracked']),
    maxStreak
  );
  const lastLoggedDay = typeof streakData['lastLoggedDay'] === 'string'
    ? streakData['lastLoggedDay'].trim()
    : '';

  return {
    currentStreak,
    maxStreak,
    totalNumberOfDaysTracked,
    ...(lastLoggedDay ? { lastLoggedDay } : {}),
  };
}

export function normalizeEarlyMorningWorkoutsTracker(
  value: unknown
): EarlyMorningWorkoutsTracker {
  const tracker = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const dateLastUpdated = normalizeDateKey(tracker['dateLastUpdated']);

  return {
    earlyMorningWorkoutNumber: toNonNegativeInteger(
      tracker['earlyMorningWorkoutNumber']
    ),
    ...(dateLastUpdated ? { dateLastUpdated } : {}),
  };
}

export function normalizeGroupRankings(value: unknown): GroupRankingsMap {
  const normalized: GroupRankingsMap = {
    totalNumberOfMembers: 0,
  };

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return normalized;
  }

  const rankings = value as Record<string, unknown>;
  normalized.totalNumberOfMembers = toNonNegativeInteger(
    rankings['totalNumberOfMembers']
  );
  const lastUpdated = normalizeTimestampString(rankings['lastUpdated']);
  if (lastUpdated) {
    normalized.lastUpdated = lastUpdated;
  }

  Object.entries(rankings).forEach(([groupId, candidateValue]) => {
    const normalizedGroupId = groupId.trim();
    if (
      !normalizedGroupId ||
      normalizedGroupId === 'totalNumberOfMembers' ||
      normalizedGroupId === 'lastUpdated'
    ) {
      return;
    }

    const parsed = Number(candidateValue);
    if (!Number.isFinite(parsed) || parsed < 0) {
      return;
    }

    normalized[normalizedGroupId] = parsed;
  });

  return normalized;
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

function normalizeDateKey(value: unknown): string | undefined {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : undefined;
}

function normalizeTimestampString(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || undefined;
  }

  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value.toISOString();
  }

  if (
    value &&
    typeof value === 'object' &&
    typeof (value as { toDate?: unknown }).toDate === 'function'
  ) {
    const timestampDate = (value as { toDate: () => Date }).toDate();
    if (timestampDate instanceof Date && Number.isFinite(timestampDate.getTime())) {
      return timestampDate.toISOString();
    }
  }

  return undefined;
}
