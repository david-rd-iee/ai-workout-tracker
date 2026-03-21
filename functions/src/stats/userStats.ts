import * as admin from 'firebase-admin';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';

interface WorkoutSession {
  userId: string;
  workoutType: 'strength' | 'cardio';
  loggedAt?: unknown;
  timeZone?: string;
  timezone?: string;
  exercises: Array<{
    sets?: number;
    reps?: number;
    weight?: number; // in kg
    duration?: number; // in minutes
    distance?: number; // in km
    intensity?: number; // 1-10 scale
  }>;
  workScore?: number;
}

interface UserScore {
  cardioScore: Record<string, number>;
  strengthScore: Record<string, number>;
  totalScore: number;
  maxAddedScoreWithinDay: number;
}

interface EarlyMorningWorkoutsTracker {
  dateLastUpdated?: string;
  earlyMorningWorkoutNumber: number;
}

function calculateUserLevelProgress(totalScore: unknown): {
  level: number;
  percentage_of_level: number;
} {
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

function calculateWorkScore(session: WorkoutSession): number {
  if (session.workScore) {
    return session.workScore; // Use pre-calculated score if available
  }

  let score = 0;
  
  if (session.workoutType === 'strength') {
    // For strength training: score based on volume (sets * reps * weight)
    score = session.exercises.reduce((total, exercise) => {
      const volume = (exercise.sets || 0) * (exercise.reps || 0) * (exercise.weight || 0);
      return total + volume;
    }, 0) / 100; // Normalize the score to a reasonable range
  } else if (session.workoutType === 'cardio') {
    // For cardio: score based on duration and intensity
    score = session.exercises.reduce((total, exercise) => {
      const durationScore = (exercise.duration || 0) * 2; // Base score from duration
      const intensityMultiplier = (exercise.intensity || 5) / 5; // Scale from 0.2 to 2.0
      return total + (durationScore * intensityMultiplier);
    }, 0);
  }
  
  return Math.round(score);
}

function normalizeUserScore(current: Record<string, any>): UserScore {
  const userScore =
    current?.userScore && typeof current.userScore === 'object'
      ? current.userScore
      : {};
  const cardioScore = normalizeScoreMap(userScore.cardioScore ?? current?.cardioScore);
  const strengthScore = normalizeScoreMap(
    userScore.strengthScore ?? current?.strengthScore ?? current?.workScore
  );
  const derivedTotalScore =
    resolveScoreTotal(cardioScore, 'totalCardioScore') +
    resolveScoreTotal(strengthScore, 'totalStrengthScore');

  return {
    cardioScore: {
      ...cardioScore,
      totalCardioScore: resolveScoreTotal(cardioScore, 'totalCardioScore'),
    },
    strengthScore: {
      ...strengthScore,
      totalStrengthScore: resolveScoreTotal(strengthScore, 'totalStrengthScore'),
    },
    totalScore: toWholeNumber(userScore.totalScore ?? current?.totalScore, derivedTotalScore),
    maxAddedScoreWithinDay: toWholeNumber(userScore.maxAddedScoreWithinDay),
  };
}

function normalizeEarlyMorningWorkoutsTracker(
  value: unknown
): EarlyMorningWorkoutsTracker {
  const tracker = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const dateLastUpdated = normalizeDateKey(tracker.dateLastUpdated);

  return {
    earlyMorningWorkoutNumber: toWholeNumber(tracker.earlyMorningWorkoutNumber),
    ...(dateLastUpdated ? { dateLastUpdated } : {}),
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

function resolveScoreTotal(scoreMap: Record<string, number>, totalKey: string): number {
  const explicitTotal = toWholeNumber(scoreMap[totalKey]);
  if (explicitTotal > 0) {
    return explicitTotal;
  }

  return Object.entries(scoreMap).reduce((sum, [key, value]) => (
    key === totalKey ? sum : sum + toWholeNumber(value)
  ), 0);
}

function toWholeNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return Math.max(0, Math.round(fallback));
  }

  return Math.round(parsed);
}

function toDateKey(value: Date): string {
  const year = value.getFullYear();
  const month = `${value.getMonth() + 1}`.padStart(2, '0');
  const day = `${value.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function normalizeDateKey(value: unknown): string | undefined {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : undefined;
}

function resolveSessionLoggedAt(value: unknown): Date | null {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value;
  }

  if (value && typeof value === 'object' && typeof (value as {toDate?: unknown}).toDate === 'function') {
    const loggedAt = (value as {toDate: () => Date}).toDate();
    return loggedAt instanceof Date && Number.isFinite(loggedAt.getTime())
      ? loggedAt
      : null;
  }

  if (typeof value === 'string' || typeof value === 'number') {
    const loggedAt = new Date(value);
    return Number.isFinite(loggedAt.getTime()) ? loggedAt : null;
  }

  return null;
}

function resolveSessionLocalDateContext(
  session: WorkoutSession
): { dateKey: string; hour: number } | null {
  const loggedAt = resolveSessionLoggedAt(session.loggedAt);
  const timeZone = typeof session.timeZone === 'string'
    ? session.timeZone.trim()
    : typeof session.timezone === 'string'
      ? session.timezone.trim()
      : '';

  if (!loggedAt || !timeZone) {
    return null;
  }

  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(loggedAt);
    const year = parts.find((part) => part.type === 'year')?.value ?? '';
    const month = parts.find((part) => part.type === 'month')?.value ?? '';
    const day = parts.find((part) => part.type === 'day')?.value ?? '';
    const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? NaN);
    const dateKey = normalizeDateKey(`${year}-${month}-${day}`);

    if (!dateKey || !Number.isFinite(hour)) {
      return null;
    }

    return {
      dateKey,
      hour,
    };
  } catch {
    return null;
  }
}

function calculateNextEarlyMorningWorkoutsTracker(
  current: Record<string, any>,
  session: WorkoutSession
): EarlyMorningWorkoutsTracker {
  const tracker = normalizeEarlyMorningWorkoutsTracker(
    current.earlymorningWorkoutsTracker
  );
  const localDateContext = resolveSessionLocalDateContext(session);

  if (!localDateContext || localDateContext.hour >= 7) {
    return tracker;
  }

  if (tracker.dateLastUpdated === localDateContext.dateKey) {
    return tracker;
  }

  return {
    dateLastUpdated: localDateContext.dateKey,
    earlyMorningWorkoutNumber: tracker.earlyMorningWorkoutNumber + 1,
  };
}

export const onWorkoutSessionCreate = onDocumentCreated('workoutSessions/{sessionId}', async (event) => {
  const session = event.data?.data() as WorkoutSession | undefined;
  if (!session || !session.userId) return;

  const userId = session.userId;
  const statsRef = admin.firestore().doc(`userStats/${userId}`);
  const currentDate = toDateKey(new Date());
  const addedScoreRef = statsRef.collection('addedScore').doc(currentDate);
  const workScore = calculateWorkScore(session);
  const addedCardioScore = session.workoutType === 'cardio' ? workScore : 0;
  const addedStrengthScore = session.workoutType === 'strength' ? workScore : 0;

  await admin.firestore().runTransaction(async (transaction) => {
    const [statsSnap, addedScoreSnap] = await Promise.all([
      transaction.get(statsRef),
      transaction.get(addedScoreRef),
    ]);
    const current = (statsSnap.data() || {}) as Record<string, any>;
    const currentUserScore = normalizeUserScore(current);
    const nextCardioTotal = currentUserScore.cardioScore.totalCardioScore + addedCardioScore;
    const nextStrengthTotal = currentUserScore.strengthScore.totalStrengthScore + addedStrengthScore;
    const totalScore = nextCardioTotal + nextStrengthTotal;
    const levelProgress = calculateUserLevelProgress(totalScore);
    const currentAddedScore = (addedScoreSnap.data() || {}) as Record<string, any>;
    const cardioScoreAddedToday =
      toWholeNumber(currentAddedScore.cardioScoreAddedToday) + addedCardioScore;
    const strengthScoreAddedToday =
      toWholeNumber(currentAddedScore.strengthScoreAddedToday) + addedStrengthScore;
    const totalScoreAddedToday = cardioScoreAddedToday + strengthScoreAddedToday;
    const maxAddedScoreWithinDay = Math.max(
      currentUserScore.maxAddedScoreWithinDay,
      totalScoreAddedToday
    );
    const earlymorningWorkoutsTracker = calculateNextEarlyMorningWorkoutsTracker(
      current,
      session
    );

    transaction.set(statsRef, {
      userScore: {
        cardioScore: {
          ...currentUserScore.cardioScore,
          totalCardioScore: nextCardioTotal,
        },
        strengthScore: {
          ...currentUserScore.strengthScore,
          totalStrengthScore: nextStrengthTotal,
        },
        totalScore,
        maxAddedScoreWithinDay,
      },
      cardioScore: admin.firestore.FieldValue.delete(),
      strengthScore: admin.firestore.FieldValue.delete(),
      totalScore: admin.firestore.FieldValue.delete(),
      workScore: admin.firestore.FieldValue.delete(),
      earlymorningWorkoutsTracker,
      ...levelProgress,
      lastUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    transaction.set(addedScoreRef, {
      date: currentDate,
      cardioScoreAddedToday,
      strengthScoreAddedToday,
      totalScoreAddedToday,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  });
});
