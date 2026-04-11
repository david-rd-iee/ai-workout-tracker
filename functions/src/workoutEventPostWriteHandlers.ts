import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import {
  workoutEventRecordToWorkoutEvent,
  workoutEventToLegacyWorkoutSession,
} from "../../shared/adapters/workout-event.adapters";
import type {
  CardioWorkoutEventEntry,
  StrengthWorkoutEventEntry,
  WorkoutEvent,
} from "../../shared/models/workout-event.model";

if (admin.apps.length === 0) {
  admin.initializeApp();
}

const db = admin.firestore();
const rtdb = admin.database();

const WORKOUT_EVENT_PATH = "users/{userId}/workoutEvents/{eventId}";
const DERIVATIONS_COLLECTION = "derivations";
const WORKOUT_SUMMARIES_COLLECTION = "workoutSummaries";
const EXERCISE_ESTIMATOR_ROOT_COLLECTION = "exercise_estimators";
const EXERCISE_ESTIMATOR_PARENT_DOC = "default";
const EXERCISE_ESTIMATOR_WORKOUT_LOGS_COLLECTION = "workout_logs";
const EXERCISE_ESTIMATOR_STRENGTH_CATEGORY = "Strength";
const EXERCISE_ESTIMATOR_CARDIO_CATEGORY = "Cardio";
const ESTIMATOR_IDS_INDEX_COLLECTION = "systemConfig";
const ESTIMATOR_IDS_INDEX_DOC = "exercise_estimators_index";
const DIRECT_CHAT_PREFIX = "direct";

type ExerciseEstimatorCategory =
  typeof EXERCISE_ESTIMATOR_STRENGTH_CATEGORY |
  typeof EXERCISE_ESTIMATOR_CARDIO_CATEGORY;

type ExerciseEstimatorModel =
  | "LinearRegression"
  | "RidgeRegression"
  | "WeightedLeastSquares"
  | "GeneralizedLeastSquares"
  | "ExponentialRegression"
  | "PolynomialRegression"
  | "LogLinearRegression"
  | "PowerLawRegression"
  | "NONE";

interface EstimatorDoc {
  exists: boolean;
  model: ExerciseEstimatorModel;
  coefficients: Record<string, number>;
  hasConfiguredEstimator: boolean;
}

interface ExpectedEffortMap {
  Cardio: Record<string, number>;
  Strength: Record<string, number>;
}

interface UserScoreState {
  cardioScore: Record<string, number>;
  strengthScore: Record<string, number>;
  totalScore: number;
  maxAddedScoreWithinDay: number;
}

interface GroupRankingsMap {
  totalNumberOfMembers: number;
  [key: string]: number | string | undefined;
}

interface StreakData {
  currentStreak: number;
  maxStreak: number;
  totalNumberOfDaysTracked: number;
  lastLoggedDay?: string;
}

interface EarlyMorningWorkoutsTracker {
  dateLastUpdated?: string;
  earlyMorningWorkoutNumber: number;
}

interface EstimatorWorkoutLogWrite {
  ref: FirebaseFirestore.DocumentReference;
  payload: Record<string, unknown>;
}

interface PersistedWorkoutEvent {
  workoutEvent: WorkoutEvent;
  createdAt: Date;
  localSubmittedDate: string;
  localSubmittedHour: number;
}

interface WorkoutEventProcessorContext {
  snapshot: FirebaseFirestore.QueryDocumentSnapshot;
  userId: string;
  eventId: string;
  persisted: PersistedWorkoutEvent;
}

interface WorkoutEventProcessor {
  name: string;
  process: (context: WorkoutEventProcessorContext) => Promise<void>;
}

async function processWorkoutEventCreatedStats(
  context: WorkoutEventProcessorContext
): Promise<void> {
  await processWorkoutEventCreatedUserStats(context);
  await processWorkoutEventCreatedScoreAggregation(context);
}

async function processWorkoutEventCreatedUserStats(
  context: WorkoutEventProcessorContext
): Promise<void> {
  const {snapshot, userId, eventId, persisted} = context;
  const markerRef = snapshot.ref.collection(DERIVATIONS_COLLECTION).doc("user_stats");
  const userStatsRef = db.doc(`userStats/${userId}`);

  await db.runTransaction(async (transaction) => {
    const [markerSnap, userStatsSnap] = await Promise.all([
      transaction.get(markerRef),
      transaction.get(userStatsRef),
    ]);

    if (markerSnap.exists) {
      return;
    }

    const currentUserStats = userStatsSnap.exists ? userStatsSnap.data() ?? {} : {};
    const currentStreakData = normalizeStreakData(
      currentUserStats["streakData"],
      currentUserStats["currentStreak"],
      currentUserStats["maxStreak"]
    );
    const nextStreakData = calculateNextStreakData(
      currentStreakData,
      persisted.workoutEvent.date
    );
    const currentEarlyMorningTracker = normalizeEarlyMorningWorkoutsTracker(
      currentUserStats["earlymorningWorkoutsTracker"]
    );
    const nextEarlyMorningTracker = calculateNextEarlyMorningWorkoutsTracker(
      currentEarlyMorningTracker,
      persisted.localSubmittedDate,
      persisted.localSubmittedHour
    );

    transaction.set(
      userStatsRef,
      {
        userId,
        streakData: nextStreakData,
        earlymorningWorkoutsTracker: nextEarlyMorningTracker,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      {merge: true}
    );
    transaction.set(
      markerRef,
      {
        status: "completed",
        processedAt: admin.firestore.FieldValue.serverTimestamp(),
        sourceModel: "workout_event",
        derivedFromWorkoutEventId: eventId,
      },
      {merge: true}
    );
  });
}

async function processWorkoutEventCreatedScoreAggregation(
  context: WorkoutEventProcessorContext
): Promise<void> {
  const {snapshot, userId, eventId, persisted} = context;
  const userStatsRef = db.doc(`userStats/${userId}`);
  const userRef = db.doc(`users/${userId}`);
  const scoreMarkerRef = snapshot.ref.collection(DERIVATIONS_COLLECTION).doc("score_aggregation");
  const [statsSnap, userSnap] = await Promise.all([
    userStatsRef.get(),
    userRef.get(),
  ]);

  const currentStats = statsSnap.exists ? statsSnap.data() ?? {} : {};
  const userDocData = userSnap.exists ? userSnap.data() ?? {} : {};
  const userGroupIds = normalizeStringArray(userDocData["groupID"]);
  const userAge = toNonNegativeNumber(currentStats["age"]);
  const userBmi = toNonNegativeNumber(currentStats["bmi"]);
  const userWeightKg = toNonNegativeNumber(
    currentStats["weightKg"] ??
    currentStats["weight_kg"] ??
    currentStats["weight"] ??
    userDocData["weightKg"] ??
    userDocData["weight_kg"] ??
    userDocData["weight"]
  );
  const userSexCode = toSexCode(currentStats["sex"]);
  const expectedEffort = normalizeExpectedEffort(
    currentStats["Expected_Effort"],
    currentStats["expected_strength_scores"]
  );
  const expectedEffortUpdates: ExpectedEffortMap = {
    Cardio: {},
    Strength: {},
  };
  const cardioScoreDeltaMap: Record<string, number> = {};
  const strengthScoreDeltaMap: Record<string, number> = {};

  const cardioEntries = getCardioEntries(persisted.workoutEvent);
  const strengthEntries = getStrengthEntries(persisted.workoutEvent);
  const genericCardioEstimator = await getEstimatorDoc({
    category: EXERCISE_ESTIMATOR_CARDIO_CATEGORY,
    exerciseType: "generic_cardio",
    createWhenMissing: false,
    createBlankDocWhenMissing: false,
  });
  const scaledStrengthEstimator = await getEstimatorDoc({
    category: EXERCISE_ESTIMATOR_STRENGTH_CATEGORY,
    exerciseType: "scaled_strength",
    createWhenMissing: false,
    createBlankDocWhenMissing: false,
  });
  const estimatorWorkoutLogWrites: EstimatorWorkoutLogWrite[] = [];

  for (let index = 0; index < cardioEntries.length; index += 1) {
    const entry = cardioEntries[index];
    const exerciseType = resolveCardioExerciseType(entry);
    if (!exerciseType) {
      continue;
    }

    const estimator = exerciseType === "generic_cardio"
      ? genericCardioEstimator
      : await getEstimatorDoc({
        category: EXERCISE_ESTIMATOR_CARDIO_CATEGORY,
        exerciseType,
        createWhenMissing: true,
        createBlankDocWhenMissing: true,
      });
    const usedGenericCardioEstimator =
      exerciseType !== "generic_cardio" && !estimator.hasConfiguredEstimator;
    const estimatorForCalculation = usedGenericCardioEstimator
      ? genericCardioEstimator
      : estimator;

    let expected = toNonNegativeNumber(expectedEffort.Cardio[exerciseType]);
    if (expected <= 0) {
      expected = calculateExpectedFromEstimator(estimatorForCalculation, {
        sexCode: userSexCode,
        bmi: userBmi,
        age: userAge,
      });
    }

    if (expected > 0) {
      expectedEffortUpdates.Cardio[exerciseType] = expected;
      expectedEffort.Cardio[exerciseType] = expected;
    }

    const cardioPerformance = resolveCardioPerformance(entry);
    const score = expected > 0 && cardioPerformance.actualVo2Max > 0
      ? (cardioPerformance.actualVo2Max / expected) * 100
      : 0;
    addScoreDelta(cardioScoreDeltaMap, exerciseType, score);

    const cardioLogPayload = {
      age: userAge,
      bmi: userBmi,
      sex: userSexCode,
      actual_vo2_max: cardioPerformance.actualVo2Max,
      sourceModel: "workout_event",
      derivedFromWorkoutEventId: eventId,
    };

    estimatorWorkoutLogWrites.push({
      ref: buildEstimatorWorkoutLogRef(
        EXERCISE_ESTIMATOR_CARDIO_CATEGORY,
        "generic_cardio",
        eventId,
        "generic",
        index
      ),
      payload: cardioLogPayload,
    });
    if (exerciseType !== "generic_cardio") {
      estimatorWorkoutLogWrites.push({
        ref: buildEstimatorWorkoutLogRef(
          EXERCISE_ESTIMATOR_CARDIO_CATEGORY,
          exerciseType,
          eventId,
          "specific",
          index
        ),
        payload: cardioLogPayload,
      });
    }
  }

  for (let index = 0; index < strengthEntries.length; index += 1) {
    const entry = strengthEntries[index];
    const exerciseType = normalizeEstimatorId(entry.exerciseType);
    if (!exerciseType) {
      continue;
    }

    const estimator = await getEstimatorDoc({
        category: EXERCISE_ESTIMATOR_STRENGTH_CATEGORY,
        exerciseType,
        createWhenMissing: true,
        createBlankDocWhenMissing: false,
    });

    let usedScaledStrengthEstimator = !estimator.hasConfiguredEstimator;
    let expected = toNonNegativeNumber(expectedEffort.Strength[exerciseType]);
    if (expected <= 0 && estimator.hasConfiguredEstimator) {
      expected = calculateExpectedFromEstimator(estimator, {
        sexCode: userSexCode,
        bmi: userBmi,
        age: userAge,
      });
      usedScaledStrengthEstimator = false;
    }

    if (expected <= 0) {
      expected = calculateExpectedFromEstimator(scaledStrengthEstimator, {
        sexCode: userSexCode,
        bmi: userBmi,
        age: userAge,
      });
      usedScaledStrengthEstimator = true;
    }

    if (expected > 0) {
      expectedEffortUpdates.Strength[exerciseType] = expected;
      expectedEffort.Strength[exerciseType] = expected;
    }

    const reps = toNonNegativeNumber(entry.reps);
    const weightKg = resolveWeightKg(entry.load.displayText, entry.load.weightKg, userWeightKg);
    const e1rm = weightKg > 0 ? weightKg * (1 + reps / 30) : 0;
    const scaledActualStrength = scaleActualStrength(e1rm, userWeightKg);
    const actual = usedScaledStrengthEstimator
      ? scaledActualStrength
      : e1rm;
    const score = expected > 0 && actual > 0
      ? (actual / expected) * 100
      : 0;
    addScoreDelta(strengthScoreDeltaMap, exerciseType, score);

    estimatorWorkoutLogWrites.push({
      ref: buildEstimatorWorkoutLogRef(
        EXERCISE_ESTIMATOR_STRENGTH_CATEGORY,
        "scaled_strength",
        eventId,
        "scaled",
        index
      ),
      payload: {
        age: userAge,
        bmi: userBmi,
        sex: userSexCode,
        actual_scaled_strength: scaledActualStrength,
        sourceModel: "workout_event",
        derivedFromWorkoutEventId: eventId,
      },
    });

    if (exerciseType !== "scaled_strength") {
      estimatorWorkoutLogWrites.push({
        ref: buildEstimatorWorkoutLogRef(
          EXERCISE_ESTIMATOR_STRENGTH_CATEGORY,
          exerciseType,
          eventId,
          "specific",
          index
        ),
        payload: {
          age: userAge,
          bmi: userBmi,
          sex: userSexCode,
          actual_one_rep_max: e1rm,
          sourceModel: "workout_event",
          derivedFromWorkoutEventId: eventId,
        },
      });
    }
  }

    const addedCardioScore = toWholeNumber(
      sumScoreEntries(cardioScoreDeltaMap, "totalCardioScore")
    );
    const addedStrengthScore = toWholeNumber(
      sumScoreEntries(strengthScoreDeltaMap, "totalStrengthScore")
    );
    const addedTotalScore = toWholeNumber(addedCardioScore + addedStrengthScore);
    const scoreDate = persisted.localSubmittedDate || persisted.workoutEvent.date || toLocalDateKey(persisted.createdAt);
    const addedScoreRef = db.doc(`userStats/${userId}/addedScore/${scoreDate}`);

    await db.runTransaction(async (transaction) => {
      const [markerSnap, latestStatsSnap, addedScoreSnap] = await Promise.all([
        transaction.get(scoreMarkerRef),
        transaction.get(userStatsRef),
        transaction.get(addedScoreRef),
      ]);

      if (markerSnap.exists) {
        return;
      }

      const latest = latestStatsSnap.exists ? latestStatsSnap.data() ?? {} : {};
      const latestUserScore = normalizeUserScore(
        latest["userScore"],
        latest["cardioScore"],
        latest["strengthScore"],
        latest["totalScore"],
        latest["workScore"]
      );
      const latestExpectedEffort = normalizeExpectedEffort(
        latest["Expected_Effort"],
        latest["expected_strength_scores"]
      );
      const nextExpectedEffort: ExpectedEffortMap = {
        Cardio: {
          ...latestExpectedEffort.Cardio,
          ...expectedEffortUpdates.Cardio,
        },
        Strength: {
          ...latestExpectedEffort.Strength,
          ...expectedEffortUpdates.Strength,
        },
      };
      const nextCardioMap = applyScoreDeltas(
        latestUserScore.cardioScore,
        cardioScoreDeltaMap,
        "totalCardioScore"
      );
      const nextStrengthMap = applyScoreDeltas(
        latestUserScore.strengthScore,
        strengthScoreDeltaMap,
        "totalStrengthScore"
      );
      const newCardioScore = resolveScoreTotal(nextCardioMap, "totalCardioScore");
      const newStrengthScore = resolveScoreTotal(nextStrengthMap, "totalStrengthScore");
      const nextTotalScore = toWholeNumber(newCardioScore + newStrengthScore);
      const levelProgress = calculateUserLevelProgress(nextTotalScore);
      const nextGroupRankings = await calculateGroupRankings(transaction, {
        userId,
        nextTotalScore,
        userGroupIds,
      });
      const currentAddedScore = addedScoreSnap.exists ? addedScoreSnap.data() ?? {} : {};
      const nextCardioScoreAddedToday = toWholeNumber(
        toNonNegativeNumber(currentAddedScore["cardioScoreAddedToday"]) + addedCardioScore
      );
      const nextStrengthScoreAddedToday = toWholeNumber(
        toNonNegativeNumber(currentAddedScore["strengthScoreAddedToday"]) + addedStrengthScore
      );
      const nextTotalScoreAddedToday = toWholeNumber(
        nextCardioScoreAddedToday + nextStrengthScoreAddedToday
      );
      const nextMaxAddedScoreWithinDay = toWholeNumber(Math.max(
        latestUserScore.maxAddedScoreWithinDay,
        nextTotalScoreAddedToday
      ));

      transaction.set(
        userStatsRef,
        {
          userScore: {
            cardioScore: nextCardioMap,
            strengthScore: nextStrengthMap,
            totalScore: nextTotalScore,
            maxAddedScoreWithinDay: nextMaxAddedScoreWithinDay,
          },
          Expected_Effort: nextExpectedEffort,
          cardioScore: admin.firestore.FieldValue.delete(),
          strengthScore: admin.firestore.FieldValue.delete(),
          totalScore: admin.firestore.FieldValue.delete(),
          workScore: admin.firestore.FieldValue.delete(),
          expected_strength_scores: admin.firestore.FieldValue.delete(),
          groupRankings: {
            ...nextGroupRankings,
            lastUpdated: new Date().toISOString(),
          },
          ...levelProgress,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        {merge: true}
      );
      transaction.set(
        addedScoreRef,
        {
          date: scoreDate,
          cardioScoreAddedToday: nextCardioScoreAddedToday,
          strengthScoreAddedToday: nextStrengthScoreAddedToday,
          totalScoreAddedToday: nextTotalScoreAddedToday,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        {merge: true}
      );

      estimatorWorkoutLogWrites.forEach(({ref, payload}) => {
        transaction.set(
          ref,
          {
            ...payload,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          {merge: true}
        );
      });

      transaction.set(
        scoreMarkerRef,
        {
          status: "completed",
          processedAt: admin.firestore.FieldValue.serverTimestamp(),
          sourceModel: "workout_event",
          derivedFromWorkoutEventId: eventId,
          addedCardioScore,
          addedStrengthScore,
          addedTotalScore,
          scoreDate,
          estimatorLogWriteCount: estimatorWorkoutLogWrites.length,
        },
        {merge: true}
      );
    });
}

async function processWorkoutEventCreatedTrainerSummary(
  context: WorkoutEventProcessorContext
): Promise<void> {
  const {snapshot, userId, eventId, persisted} = context;
  const markerRef = snapshot.ref.collection(DERIVATIONS_COLLECTION).doc("trainer_summary");
  const markerSnap = await markerRef.get();
  if (markerSnap.exists) {
    return;
  }

  const trainerUid = await resolveCurrentTrainerUid(userId);
  if (!trainerUid) {
    await markerRef.set(
      {
        status: "skipped",
        skippedAt: admin.firestore.FieldValue.serverTimestamp(),
        reason: "no_trainer",
        sourceModel: "workout_event",
        derivedFromWorkoutEventId: eventId,
      },
      {merge: true}
    );
    return;
  }

  const legacySession = toLegacyWorkoutSessionRecord(persisted.workoutEvent);
  const trainingRows = getTrainingRows(legacySession);
  const summaryRef = db.doc(
    `users/${trainerUid}/${WORKOUT_SUMMARIES_COLLECTION}/${buildTrainerSummaryId(userId, eventId)}`
  );
  const date = readText(legacySession["date"]) || persisted.workoutEvent.date;
  const trainerNotes = readText(legacySession["trainer_notes"] ?? legacySession["notes"]);
  const estimatedCalories = toRoundedNonNegative(
    legacySession["estimated_calories"] ??
    legacySession["calories"]
  );
  const totalVolume = toNonNegativeNumber(legacySession["volume"]);

  await Promise.all([
    summaryRef.set(
      {
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        date,
        clientUid: userId,
        clientWorkoutEventId: eventId,
        estimatedCalories,
        totalVolume,
        trainerNotes,
        isComplete: true,
        rows: trainingRows.map((row) => ({
          trainingType: readText(row["Training_Type"]),
          estimatedCalories: toRoundedNonNegative(row["estimated_calories"]),
          exerciseType: readText(row["exercise_type"]),
          exercise: fromSnakeCase(readText(row["exercise_type"])),
          sets: toRoundedNonNegative(row["sets"]),
          reps: toRoundedNonNegative(row["reps"]),
          weights: formatWeight(row),
        })),
        source: readText(legacySession["sessionType"]) || "workout_event",
        sourceModel: "workout_event",
        isDerivedProjection: true,
        derivedProjectionType: "trainer_summary",
      },
      {merge: true}
    ),
    db.doc(`users/${trainerUid}`).set(
      {
        lastWorkoutSummaryAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      {merge: true}
    ),
    markerRef.set(
      {
        status: "completed",
        processedAt: admin.firestore.FieldValue.serverTimestamp(),
        sourceModel: "workout_event",
        derivedFromWorkoutEventId: eventId,
        trainerUid,
      },
      {merge: true}
    ),
  ]);
}

async function processWorkoutEventCreatedChatSummary(
  context: WorkoutEventProcessorContext
): Promise<void> {
  const {snapshot, userId, eventId, persisted} = context;
  const markerRef = snapshot.ref.collection(DERIVATIONS_COLLECTION).doc("trainer_chat_summary");
  const markerSnap = await markerRef.get();
  if (markerSnap.exists) {
    return;
  }

  const trainerUid = await resolveCurrentTrainerUid(userId);
  if (!trainerUid) {
    await markerRef.set(
      {
        status: "skipped",
        skippedAt: admin.firestore.FieldValue.serverTimestamp(),
        reason: "no_trainer",
        sourceModel: "workout_event",
        derivedFromWorkoutEventId: eventId,
      },
      {merge: true}
    );
    return;
  }

  const chatId = await findOrCreateDirectChat(userId, trainerUid);
  const messageId = `workout_summary_${eventId}`;
  const timestamp = persisted.createdAt.toISOString();
  const messageText = buildSummaryChatMessage(persisted.workoutEvent, persisted.createdAt);

  await Promise.all([
    rtdb.ref(`chats/${chatId}/messages/${messageId}`).set({
      senderId: userId,
      text: messageText,
      timestamp,
      read: false,
      type: "workout_summary",
      sourceModel: "workout_event",
      derivedFromWorkoutEventId: eventId,
    }),
    rtdb.ref(`chats/${chatId}/lastMessage`).set(messageText),
    rtdb.ref(`chats/${chatId}/lastMessageTime`).set(timestamp),
    markerRef.set(
      {
        status: "completed",
        processedAt: admin.firestore.FieldValue.serverTimestamp(),
        sourceModel: "workout_event",
        derivedFromWorkoutEventId: eventId,
        trainerUid,
        chatId,
      },
      {merge: true}
    ),
  ]);
}

const workoutEventCreatedProcessors: WorkoutEventProcessor[] = [
  {
    name: "update stats",
    process: processWorkoutEventCreatedStats,
  },
  {
    name: "create trainer summary",
    process: processWorkoutEventCreatedTrainerSummary,
  },
  {
    name: "enqueue/send chat summary",
    process: processWorkoutEventCreatedChatSummary,
  },
];

export const onWorkoutEventCreated = onDocumentCreated(
  WORKOUT_EVENT_PATH,
  async (event) => {
    const snapshot = event.data;
    if (!snapshot) {
      return;
    }

    const userId = readText(event.params.userId);
    const eventId = readText(event.params.eventId);
    if (!userId || !eventId) {
      logger.warn("[WorkoutEventHandlers] Missing workout event params for processor trigger.", {
        userId,
        eventId,
      });
      return;
    }

    const persisted = parsePersistedWorkoutEvent(snapshot);
    if (!persisted || !persisted.workoutEvent.summary.isComplete) {
      return;
    }

    const context: WorkoutEventProcessorContext = {
      snapshot,
      userId,
      eventId,
      persisted,
    };

    for (const processor of workoutEventCreatedProcessors) {
      logger.info("[WorkoutEventHandlers] Running processor.", {
        processor: processor.name,
        userId,
        eventId,
      });
      await processor.process(context);
    }
  }
);

function parsePersistedWorkoutEvent(
  snapshot: FirebaseFirestore.DocumentSnapshot
): PersistedWorkoutEvent | null {
  const rawRecord = snapshot.data();
  if (!rawRecord) {
    return null;
  }

  const rawData = rawRecord as Record<string, unknown>;
  const workoutEvent = workoutEventRecordToWorkoutEvent(rawData);
  const createdAt = toDate(rawData["createdAt"]) ?? new Date();
  const submissionMetadata = toRecord(rawData["submissionMetadata"]);
  return {
    workoutEvent,
    createdAt,
    localSubmittedDate: readText(submissionMetadata["localSubmittedDate"]) || workoutEvent.date,
    localSubmittedHour: toInteger(
      submissionMetadata["localSubmittedHour"],
      createdAt.getHours()
    ),
  };
}

function normalizeStreakData(
  value: unknown,
  legacyCurrentStreak?: unknown,
  legacyMaxStreak?: unknown
): StreakData {
  const streakData = toRecord(value);
  const currentStreak = toNonNegativeInteger(streakData["currentStreak"] ?? legacyCurrentStreak);
  const rawMaxStreak = toNonNegativeInteger(streakData["maxStreak"] ?? legacyMaxStreak);
  const maxStreak = Math.max(rawMaxStreak, currentStreak);
  const totalNumberOfDaysTracked = Math.max(
    toNonNegativeInteger(streakData["totalNumberOfDaysTracked"]),
    maxStreak
  );
  const lastLoggedDay = readText(streakData["lastLoggedDay"]);

  return {
    currentStreak,
    maxStreak,
    totalNumberOfDaysTracked,
    ...(lastLoggedDay ? {lastLoggedDay} : {}),
  };
}

function normalizeEarlyMorningWorkoutsTracker(value: unknown): EarlyMorningWorkoutsTracker {
  const tracker = toRecord(value);
  const dateLastUpdated = readText(tracker["dateLastUpdated"]);

  return {
    earlyMorningWorkoutNumber: toNonNegativeInteger(tracker["earlyMorningWorkoutNumber"]),
    ...(dateLastUpdated ? {dateLastUpdated} : {}),
  };
}

function calculateNextStreakData(currentStreakData: StreakData, loggedDay: string): StreakData {
  if (currentStreakData.lastLoggedDay === loggedDay) {
    return {...currentStreakData};
  }

  const dayGap = calculateDayGap(currentStreakData.lastLoggedDay, loggedDay);
  const nextCurrentStreak = dayGap === 1
    ? currentStreakData.currentStreak + 1
    : 1;

  return {
    currentStreak: nextCurrentStreak,
    maxStreak: Math.max(currentStreakData.maxStreak, nextCurrentStreak),
    totalNumberOfDaysTracked: currentStreakData.totalNumberOfDaysTracked + 1,
    lastLoggedDay: loggedDay,
  };
}

function calculateNextEarlyMorningWorkoutsTracker(
  currentTracker: EarlyMorningWorkoutsTracker,
  localSubmittedDate: string,
  localSubmittedHour: number
): EarlyMorningWorkoutsTracker {
  if (localSubmittedHour >= 7) {
    return {...currentTracker};
  }

  if (!localSubmittedDate || currentTracker.dateLastUpdated === localSubmittedDate) {
    return {...currentTracker};
  }

  return {
    dateLastUpdated: localSubmittedDate,
    earlyMorningWorkoutNumber: currentTracker.earlyMorningWorkoutNumber + 1,
  };
}

function calculateDayGap(previousLoggedDay: string | undefined, currentLoggedDay: string): number | null {
  const previousDate = parseLocalDayKey(previousLoggedDay);
  const currentDate = parseLocalDayKey(currentLoggedDay);
  if (!previousDate || !currentDate) {
    return null;
  }

  return Math.round((currentDate.getTime() - previousDate.getTime()) / 86_400_000);
}

function parseLocalDayKey(value: string | undefined): Date | null {
  if (!value) {
    return null;
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const day = Number(match[3]);
  const parsed = new Date(year, monthIndex, day);
  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== monthIndex ||
    parsed.getDate() !== day
  ) {
    return null;
  }

  return parsed;
}

function getCardioEntries(workoutEvent: WorkoutEvent): CardioWorkoutEventEntry[] {
  return workoutEvent.entries.filter(
    (entry): entry is CardioWorkoutEventEntry => entry.kind === "cardio"
  );
}

function getStrengthEntries(workoutEvent: WorkoutEvent): StrengthWorkoutEventEntry[] {
  return workoutEvent.entries.filter(
    (entry): entry is StrengthWorkoutEventEntry => entry.kind === "strength"
  );
}

async function getEstimatorDoc(params: {
  category: ExerciseEstimatorCategory;
  exerciseType: string;
  createWhenMissing: boolean;
  createBlankDocWhenMissing: boolean;
}): Promise<EstimatorDoc> {
  const estimatorId = normalizeEstimatorId(params.exerciseType);
  const estimatorRef = getEstimatorDocRef(params.category, estimatorId);
  const estimatorSnap = await estimatorRef.get();

  if (!estimatorSnap.exists) {
    if (params.createWhenMissing) {
      const payload: Record<string, unknown> = {
        isUserDefined: true,
        createdBy: "workout_event_post_write_handler",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      };
      if (!params.createBlankDocWhenMissing) {
        payload["model"] = "NONE";
        payload["coefficients"] = {};
      }

      await estimatorRef.set(payload, {merge: true});
      if (params.category === EXERCISE_ESTIMATOR_STRENGTH_CATEGORY) {
        await upsertStrengthEstimatorIdsIndex([estimatorId]);
      }
    }

    return {
      exists: false,
      model: "NONE",
      coefficients: {},
      hasConfiguredEstimator: false,
    };
  }

  const raw = estimatorSnap.data() ?? {};
  const rawModel = readText(raw["model"]) || "NONE";
  const model: ExerciseEstimatorModel = (
    rawModel === "LinearRegression" ||
    rawModel === "RidgeRegression" ||
    rawModel === "WeightedLeastSquares" ||
    rawModel === "GeneralizedLeastSquares" ||
    rawModel === "ExponentialRegression" ||
    rawModel === "PolynomialRegression" ||
    rawModel === "LogLinearRegression" ||
    rawModel === "PowerLawRegression" ||
    rawModel === "NONE"
  )
    ? rawModel
    : "NONE";
  const coefficients = toNumberMap(raw["coefficients"]);

  return {
    exists: true,
    model,
    coefficients,
    hasConfiguredEstimator: model !== "NONE" && Object.keys(coefficients).length > 0,
  };
}

async function upsertStrengthEstimatorIdsIndex(ids: string[]): Promise<void> {
  const normalizedIds = normalizeEstimatorIdArray(ids);
  if (normalizedIds.length === 0) {
    return;
  }

  const indexRef = db.doc(`${ESTIMATOR_IDS_INDEX_COLLECTION}/${ESTIMATOR_IDS_INDEX_DOC}`);
  await indexRef.set({
    ids: admin.firestore.FieldValue.arrayUnion(...normalizedIds),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, {merge: true});
}

function buildEstimatorWorkoutLogRef(
  category: ExerciseEstimatorCategory,
  estimatorId: string,
  workoutEventId: string,
  scope: string,
  index: number
): FirebaseFirestore.DocumentReference {
  const normalizedEstimatorId = normalizeEstimatorId(estimatorId);
  const normalizedScope = normalizeEstimatorId(scope) || "sample";
  const documentId = `${readText(workoutEventId)}_${normalizedScope}_${index}`;
  return db.doc(
    `${EXERCISE_ESTIMATOR_ROOT_COLLECTION}/${EXERCISE_ESTIMATOR_PARENT_DOC}/${category}/${normalizedEstimatorId}/${EXERCISE_ESTIMATOR_WORKOUT_LOGS_COLLECTION}/${documentId}`
  );
}

function getEstimatorDocRef(
  category: ExerciseEstimatorCategory,
  estimatorId: string
): FirebaseFirestore.DocumentReference {
  return db.doc(
    `${EXERCISE_ESTIMATOR_ROOT_COLLECTION}/${EXERCISE_ESTIMATOR_PARENT_DOC}/${category}/${estimatorId}`
  );
}

function normalizeEstimatorIdArray(candidate: unknown): string[] {
  if (!Array.isArray(candidate)) {
    return [];
  }

  const ids = candidate
    .map((value) => normalizeEstimatorId(String(value ?? "")))
    .filter((value) => !!value);

  return Array.from(new Set(ids)).sort((a, b) => a.localeCompare(b));
}

function calculateExpectedFromEstimator(
  estimator: EstimatorDoc,
  params: {
    sexCode: number;
    bmi: number;
    age: number;
  }
): number {
  const intercept = getCoefficient(estimator.coefficients, "intercept");

  if (
    estimator.model === "LinearRegression" ||
    estimator.model === "RidgeRegression" ||
    estimator.model === "WeightedLeastSquares" ||
    estimator.model === "GeneralizedLeastSquares"
  ) {
    return Math.max(0, calculateLinearExpected(estimator.coefficients, params, intercept));
  }

  if (estimator.model === "ExponentialRegression") {
    const scaleA = getCoefficient(estimator.coefficients, "scale_a");
    const sexCoefficient = getCoefficient(estimator.coefficients, ["sex_code", "sex"]);
    const bmiCoefficient = getCoefficient(estimator.coefficients, ["bmi", "BMI"]);
    const ageCoefficient = getCoefficient(estimator.coefficients, ["age", "age_years"]);
    const exponent =
      (sexCoefficient * params.sexCode) +
      (bmiCoefficient * params.bmi) +
      (ageCoefficient * params.age);

    return Math.max(0, intercept + (scaleA * Math.exp(exponent)));
  }

  if (estimator.model === "PolynomialRegression") {
    const ageCoefficient = getCoefficient(estimator.coefficients, ["age_years", "age"]);
    const sexCoefficient = getCoefficient(estimator.coefficients, ["sex", "sex_code"]);
    const bmiCoefficient = getCoefficient(estimator.coefficients, ["bmi", "BMI"]);
    const ageSquaredCoefficient = getCoefficient(estimator.coefficients, [
      "age_years^2",
      "age_squared",
    ]);
    const ageSexCoefficient = getCoefficient(estimator.coefficients, [
      "age_years sex",
      "age_sex",
    ]);
    const ageBmiCoefficient = getCoefficient(estimator.coefficients, [
      "age_years bmi",
      "age_bmi",
    ]);
    const sexSquaredCoefficient = getCoefficient(estimator.coefficients, [
      "sex^2",
      "sex_squared",
    ]);
    const sexBmiCoefficient = getCoefficient(estimator.coefficients, [
      "sex bmi",
      "sex_bmi",
    ]);
    const bmiSquaredCoefficient = getCoefficient(estimator.coefficients, [
      "bmi^2",
      "bmi_squared",
    ]);

    return Math.max(
      0,
      intercept +
        (ageCoefficient * params.age) +
        (sexCoefficient * params.sexCode) +
        (bmiCoefficient * params.bmi) +
        (ageSquaredCoefficient * Math.pow(params.age, 2)) +
        (ageSexCoefficient * params.age * params.sexCode) +
        (ageBmiCoefficient * params.age * params.bmi) +
        (sexSquaredCoefficient * Math.pow(params.sexCode, 2)) +
        (sexBmiCoefficient * params.sexCode * params.bmi) +
        (bmiSquaredCoefficient * Math.pow(params.bmi, 2))
    );
  }

  if (estimator.model === "LogLinearRegression") {
    if (params.sexCode <= 0 || params.bmi <= 0 || params.age <= 0) {
      return 0;
    }

    const logSexCoefficient = getCoefficient(estimator.coefficients, [
      "log_sex_code",
      "log_sex",
    ]);
    const logBmiCoefficient = getCoefficient(estimator.coefficients, [
      "log_bmi",
      "ln_bmi",
    ]);
    const logAgeCoefficient = getCoefficient(estimator.coefficients, [
      "log_age",
      "ln_age",
    ]);

    return Math.max(
      0,
      intercept +
        (logSexCoefficient * Math.log(params.sexCode)) +
        (logBmiCoefficient * Math.log(params.bmi)) +
        (logAgeCoefficient * Math.log(params.age))
    );
  }

  if (estimator.model === "PowerLawRegression") {
    if (params.sexCode <= 0 || params.bmi <= 0 || params.age <= 0) {
      return 0;
    }

    const scaleA = getCoefficient(estimator.coefficients, "scale_a");
    const sexExponent = getCoefficient(estimator.coefficients, [
      "sex_exponent",
      "sex_power",
    ]);
    const bmiExponent = getCoefficient(estimator.coefficients, [
      "bmi_exponent",
      "bmi_power",
    ]);
    const ageExponent = getCoefficient(estimator.coefficients, [
      "age_exponent",
      "age_power",
    ]);

    return Math.max(
      0,
      intercept +
        (scaleA *
          Math.pow(params.sexCode, sexExponent) *
          Math.pow(params.bmi, bmiExponent) *
          Math.pow(params.age, ageExponent))
    );
  }

  return 0;
}

function calculateLinearExpected(
  coefficients: Record<string, number>,
  params: {
    sexCode: number;
    bmi: number;
    age: number;
  },
  intercept: number
): number {
  const sexCoefficient = getCoefficient(coefficients, ["sex_code", "sex"]);
  const bmiCoefficient = getCoefficient(coefficients, ["bmi", "BMI"]);
  const ageCoefficient = getCoefficient(coefficients, ["age", "age_years"]);

  return intercept +
    (sexCoefficient * params.sexCode) +
    (bmiCoefficient * params.bmi) +
    (ageCoefficient * params.age);
}

function getCoefficient(coefficients: Record<string, number>, keys: string | string[]): number {
  const candidates = Array.isArray(keys) ? keys : [keys];
  for (const candidate of candidates) {
    const exactValue = coefficients[candidate];
    if (typeof exactValue === "number" && Number.isFinite(exactValue)) {
      return exactValue;
    }
  }

  const normalizedCandidates = new Set(
    candidates.map((candidate) => normalizeCoefficientKey(candidate))
  );
  const entry = Object.entries(coefficients).find(([candidate]) =>
    normalizedCandidates.has(normalizeCoefficientKey(candidate))
  );
  if (!entry) {
    return 0;
  }

  const candidateValue = entry[1];
  return Number.isFinite(candidateValue) ? candidateValue : 0;
}

function normalizeCoefficientKey(rawKey: string): string {
  return readText(rawKey)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function resolveCardioPerformance(entry: CardioWorkoutEventEntry): {
  actualVo2Max: number;
} {
  const timeMinutes = toNonNegativeNumber(entry.duration?.minutes);
  const distanceMeters = toNonNegativeNumber(entry.distance?.meters);
  const speedMetersPerMinute = timeMinutes > 0
    ? distanceMeters / timeMinutes
    : 0;
  const actualVo2Max = speedMetersPerMinute > 0
    ? toNonNegativeNumber(((speedMetersPerMinute * 12) - 504.9) / 44.73)
    : 0;

  return {
    actualVo2Max,
  };
}

function resolveCardioExerciseType(entry: CardioWorkoutEventEntry): string {
  return normalizeEstimatorId(entry.cardioType);
}

function resolveWeightKg(displayText: string, explicitWeightKg: number, fallbackBodyweightKg = 0): number {
  if (Number.isFinite(explicitWeightKg) && explicitWeightKg > 0) {
    return explicitWeightKg;
  }

  const text = readText(displayText).toLowerCase();
  if (!text || text.includes("body")) {
    return fallbackBodyweightKg > 0 ? fallbackBodyweightKg : 0;
  }

  const match = text.match(
    /([0-9]*\.?[0-9]+)\s*(kg|kgs|kilogram|kilograms|lb|lbs|pound|pounds)?\b/
  );
  if (!match) {
    const parsed = Number(text);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }

  const amount = Number(match[1] ?? 0);
  const unit = readText(match[2] ?? "kg").toLowerCase();
  if (!Number.isFinite(amount) || amount <= 0) {
    return 0;
  }

  if (unit === "lb" || unit === "lbs" || unit === "pound" || unit === "pounds") {
    return amount * 0.45359237;
  }

  return amount;
}

function scaleActualStrength(e1rm: number, userWeightKg: number): number {
  if (e1rm <= 0 || userWeightKg <= 0) {
    return 0;
  }

  return e1rm / Math.pow(userWeightKg, 0.67);
}

async function calculateGroupRankings(
  transaction: FirebaseFirestore.Transaction,
  params: {
    userId: string;
    nextTotalScore: number;
    userGroupIds: string[];
  }
): Promise<GroupRankingsMap> {
  const groupRankings: GroupRankingsMap = {
    totalNumberOfMembers: 0,
  };
  const groupIds = normalizeStringArray(params.userGroupIds);
  if (groupIds.length === 0) {
    return groupRankings;
  }

  const groupSnaps = await Promise.all(
    groupIds.map((groupId) => transaction.get(db.doc(`groupID/${groupId}`)))
  );
  const validGroups = new Map<string, string[]>();
  const memberIdsToLoad = new Set<string>();

  groupSnaps.forEach((groupSnap, index) => {
    if (!groupSnap.exists) {
      return;
    }

    const groupId = groupIds[index];
    const groupData = groupSnap.data() ?? {};
    const memberIds = normalizeStringArray(groupData["userIDs"]);
    if (memberIds.length <= 1 || !memberIds.includes(params.userId)) {
      return;
    }

    validGroups.set(groupId, memberIds);
    memberIds.forEach((memberId) => {
      if (memberId !== params.userId) {
        memberIdsToLoad.add(memberId);
      }
    });
  });

  if (validGroups.size === 0) {
    return groupRankings;
  }

  const otherMemberIds = Array.from(memberIdsToLoad);
  const otherMemberStatSnaps = await Promise.all(
    otherMemberIds.map((memberId) => transaction.get(db.doc(`userStats/${memberId}`)))
  );
  const scoreByUserId = new Map<string, number>([[params.userId, params.nextTotalScore]]);

  otherMemberStatSnaps.forEach((memberStatsSnap, index) => {
    const memberId = otherMemberIds[index];
    const memberStats = memberStatsSnap.exists ? memberStatsSnap.data() ?? {} : {};
    const memberUserScore = normalizeUserScore(
      memberStats["userScore"],
      memberStats["cardioScore"],
      memberStats["strengthScore"],
      memberStats["totalScore"],
      memberStats["workScore"]
    );
    scoreByUserId.set(memberId, toWholeNumber(memberUserScore.totalScore));
  });

  Array.from(validGroups.entries()).forEach(([groupId, memberIds]) => {
    const rankedMembers = memberIds
      .map((memberId, originalIndex) => ({
        memberId,
        originalIndex,
        totalScore: toWholeNumber(scoreByUserId.get(memberId) ?? 0),
      }))
      .sort((left, right) => {
        if (right.totalScore !== left.totalScore) {
          return right.totalScore - left.totalScore;
        }
        return left.originalIndex - right.originalIndex;
      });
    const userIndex = rankedMembers.findIndex(
      (member) => member.memberId === params.userId
    );

    if (userIndex === -1 || rankedMembers.length <= 1) {
      return;
    }

    const totalNumberOfMembers = rankedMembers.length;
    const userRank = userIndex + 1;
    groupRankings[groupId] = totalNumberOfMembers - userRank;
    groupRankings.totalNumberOfMembers += totalNumberOfMembers;
  });

  return groupRankings;
}

function normalizeUserScore(
  value: unknown,
  legacyCardioScore?: unknown,
  legacyStrengthScore?: unknown,
  legacyTotalScore?: unknown,
  legacyWorkScore?: unknown
): UserScoreState {
  const userScore = toRecord(value);
  const cardioScore = normalizeScoreMap(userScore["cardioScore"], legacyCardioScore, "totalCardioScore");
  const strengthScore = normalizeScoreMap(
    userScore["strengthScore"],
    legacyStrengthScore ?? legacyWorkScore,
    "totalStrengthScore"
  );
  const derivedTotalScore =
    resolveScoreTotal(cardioScore, "totalCardioScore") +
    resolveScoreTotal(strengthScore, "totalStrengthScore");

  return {
    cardioScore,
    strengthScore,
    totalScore: toWholeNumber(userScore["totalScore"] ?? legacyTotalScore ?? derivedTotalScore),
    maxAddedScoreWithinDay: toWholeNumber(userScore["maxAddedScoreWithinDay"]),
  };
}

function normalizeScoreMap(
  value: unknown,
  legacyValue: unknown,
  totalKey: string
): Record<string, number> {
  const rawMap = Object.keys(toNumberMap(value)).length > 0
    ? toNumberMap(value)
    : toNumberMap(legacyValue);
  const rounded = roundScoreMap(rawMap);
  rounded[totalKey] = resolveScoreTotal(rounded, totalKey);
  return rounded;
}

function normalizeExpectedEffort(value: unknown, legacyStrengthScores?: unknown): ExpectedEffortMap {
  const expectedEffort = toRecord(value);
  return {
    Cardio: toNumberMap(expectedEffort["Cardio"]),
    Strength: toNumberMap(expectedEffort["Strength"] ?? legacyStrengthScores),
  };
}

function calculateUserLevelProgress(totalScore: unknown): {level: number; percentage_of_level: number} {
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

function addScoreDelta(
  scoreDeltaMap: Record<string, number>,
  exerciseType: string,
  roundedScore: number
): void {
  const normalizedExerciseType = normalizeEstimatorId(exerciseType);
  if (!normalizedExerciseType || roundedScore <= 0) {
    return;
  }

  const priorScore = toWholeNumber(toNonNegativeNumber(scoreDeltaMap[normalizedExerciseType]));
  scoreDeltaMap[normalizedExerciseType] = priorScore + toWholeNumber(roundedScore);
}

function applyScoreDeltas(
  currentScoreMap: Record<string, number>,
  deltaMap: Record<string, number>,
  totalKey: string
): Record<string, number> {
  const nextScoreMap = {
    ...roundScoreMap(currentScoreMap),
  };

  Object.entries(deltaMap).forEach(([exerciseType, addedScore]) => {
    const normalizedExerciseType = normalizeEstimatorId(exerciseType);
    if (!normalizedExerciseType || normalizedExerciseType === totalKey) {
      return;
    }

    const priorExerciseScore = toWholeNumber(
      toNonNegativeNumber(nextScoreMap[normalizedExerciseType])
    );
    nextScoreMap[normalizedExerciseType] = priorExerciseScore + toWholeNumber(addedScore);
  });

  nextScoreMap[totalKey] = toWholeNumber(sumScoreEntries(nextScoreMap, totalKey));
  return nextScoreMap;
}

function sumScoreEntries(scoreMap: Record<string, number>, totalKey: string): number {
  return Object.entries(scoreMap).reduce((sum, [key, value]) => {
    if (key === totalKey) {
      return sum;
    }
    return sum + toNonNegativeNumber(value);
  }, 0);
}

function resolveScoreTotal(scoreMap: Record<string, number>, totalKey: string): number {
  const explicitTotal = toNonNegativeNumber(scoreMap[totalKey]);
  if (explicitTotal > 0) {
    return toWholeNumber(explicitTotal);
  }

  return toWholeNumber(sumScoreEntries(scoreMap, totalKey));
}

function roundScoreMap(value: Record<string, number>): Record<string, number> {
  return Object.entries(value).reduce<Record<string, number>>((acc, [key, candidate]) => {
    acc[key] = toWholeNumber(toNonNegativeNumber(candidate));
    return acc;
  }, {});
}

async function resolveCurrentTrainerUid(clientUid: string): Promise<string> {
  const [userDocSnap, clientDocSnap] = await Promise.all([
    db.doc(`users/${clientUid}`).get(),
    db.doc(`clients/${clientUid}`).get(),
  ]);
  const userData = userDocSnap.exists ? userDocSnap.data() ?? {} : {};
  const fromUsersDoc = readText(userData["trainerId"]);
  if (fromUsersDoc) {
    return fromUsersDoc;
  }

  const clientData = clientDocSnap.exists ? clientDocSnap.data() ?? {} : {};
  return readText(clientData["trainerId"]);
}

async function findOrCreateDirectChat(userId1: string, userId2: string): Promise<string> {
  const userChatsSnapshot = await rtdb.ref(`userChats/${userId1}`).once("value");
  const userChats = userChatsSnapshot.val() as Record<string, unknown> | null;

  if (userChats) {
    for (const chatId of Object.keys(userChats)) {
      const chatSnapshot = await rtdb.ref(`chats/${chatId}`).once("value");
      const chatData = toRecord(chatSnapshot.val());
      const participants = Array.isArray(chatData["participants"])
        ? (chatData["participants"] as unknown[])
            .map((entry) => readText(entry))
            .filter((entry) => entry.length > 0)
        : [];
      if (participants.includes(userId1) && participants.includes(userId2)) {
        return chatId;
      }
    }
  }

  const chatId = buildDirectChatId(userId1, userId2);
  const chatRef = rtdb.ref(`chats/${chatId}`);
  const chatSnapshot = await chatRef.once("value");

  if (!chatSnapshot.exists()) {
    const timestamp = new Date().toISOString();
    await chatRef.set({
      chatId,
      participants: [userId1, userId2],
      lastMessage: "",
      lastMessageTime: timestamp,
      messages: {},
    });
  }

  await Promise.all([
    rtdb.ref(`userChats/${userId1}/${chatId}`).set(true),
    rtdb.ref(`userChats/${userId2}/${chatId}`).set(true),
  ]);

  return chatId;
}

function buildDirectChatId(userId1: string, userId2: string): string {
  const [left, right] = [normalizeEstimatorId(userId1), normalizeEstimatorId(userId2)].sort();
  return `${DIRECT_CHAT_PREFIX}_${left}_${right}`;
}

function buildTrainerSummaryId(clientUid: string, workoutEventId: string): string {
  return `${readText(clientUid)}_${readText(workoutEventId)}`;
}

function buildSummaryChatMessage(workoutEvent: WorkoutEvent, loggedAt: Date): string {
  const legacySession = toLegacyWorkoutSessionRecord(workoutEvent);
  const trainingRows = getTrainingRows(legacySession);
  const strengthRows = getStrengthRows(legacySession, trainingRows);
  const cardioRows = getCardioRows(legacySession, trainingRows);
  const otherRows = getOtherRows(legacySession, trainingRows);
  const estimatedCalories = toRoundedNonNegative(
    legacySession["estimated_calories"] ?? legacySession["calories"]
  );
  const trainerNotes = readText(legacySession["trainer_notes"] ?? legacySession["notes"]);
  const lines: string[] = [
    "Workout Summary",
    "",
    loggedAt.toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    }),
    loggedAt.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    }),
    `Estimated Total Calories: ${Math.round(estimatedCalories)} kcal`,
  ];

  if (strengthRows.length > 0) {
    lines.push("", "Strength:", "");
    strengthRows.forEach((row) => {
      lines.push(
        fromSnakeCase(readText(row["exercise_type"])),
        `Sets: ${toRoundedNonNegative(row["sets"])}`,
        `Reps: ${toRoundedNonNegative(row["reps"])}`,
        `Weights: ${formatWeight(row)}`,
        `Calories Burned: ${toRoundedNonNegative(row["estimated_calories"])}`,
        ""
      );
    });
  }

  if (cardioRows.length > 0) {
    lines.push("", "Cardio:", "");
    cardioRows.forEach((row) => {
      lines.push(
        fromSnakeCase(readText(row["cardio_type"])),
        `Distance: ${formatCardioDistance(row)}`,
        `Time: ${formatCardioTime(row)}`,
        `Calories Burned: ${toRoundedNonNegative(row["estimated_calories"])}`,
        ""
      );
    });
  }

  if (otherRows.length > 0) {
    lines.push("", "Other:", "");
    otherRows.forEach((row) => {
      lines.push(
        resolveOtherTitle(row),
        `Details: ${resolveOtherDetails(row)}`,
        `Calories Burned: ${toRoundedNonNegative(row["estimated_calories"])}`,
        ""
      );
    });
  }

  if (trainerNotes) {
    lines.push("", "Notes for Trainer:", trainerNotes);
  }

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function toLegacyWorkoutSessionRecord(workoutEvent: WorkoutEvent): Record<string, unknown> {
  return workoutEventToLegacyWorkoutSession(workoutEvent) as Record<string, unknown>;
}

function getTrainingRows(session: Record<string, unknown>): Array<Record<string, unknown>> {
  return toObjectArray(session["trainingRows"]);
}

function getStrengthRows(
  session: Record<string, unknown>,
  trainingRows: Array<Record<string, unknown>>
): Array<Record<string, unknown>> {
  const structured = toObjectArray(session["strengthTrainingRow"] ?? session["strengthTrainingRowss"]);
  if (structured.length > 0) {
    return structured;
  }

  return trainingRows.filter((row) => readText(row["Training_Type"]).toLowerCase() === "strength");
}

function getCardioRows(
  session: Record<string, unknown>,
  trainingRows: Array<Record<string, unknown>>
): Array<Record<string, unknown>> {
  const structured = toObjectArray(session["cardioTrainingRow"]);
  if (structured.length > 0) {
    return structured;
  }

  return trainingRows.filter((row) => readText(row["Training_Type"]).toLowerCase() === "cardio");
}

function getOtherRows(
  session: Record<string, unknown>,
  trainingRows: Array<Record<string, unknown>>
): Array<Record<string, unknown>> {
  const structured = toObjectArray(session["otherTrainingRow"]);
  if (structured.length > 0) {
    return structured;
  }

  return trainingRows.filter((row) => readText(row["Training_Type"]).toLowerCase() === "other");
}

function formatWeight(row: Record<string, unknown>): string {
  const weightKg = Number(row["weights_kg"] ?? row["weights"] ?? row["weight_kg"]);
  if (Number.isFinite(weightKg) && weightKg > 0) {
    return `${Math.round(weightKg * 100) / 100} kg`;
  }

  const displayValue = readText(row["displayed_weights_metric"] ?? row["displayWeight"]);
  if (isBodyweightDisplayValue(displayValue)) {
    return "bodyweight";
  }
  if (displayValue) {
    return displayValue;
  }

  const text = readText(row["weights"] ?? row["weight"]);
  if (!text || text.toLowerCase().includes("body")) {
    return "bodyweight";
  }

  return text;
}

function isBodyweightDisplayValue(value: unknown): boolean {
  const text = readText(value).toLowerCase();
  return text === "bodyweight" || text === "body weight";
}

function formatCardioDistance(row: Record<string, unknown>): string {
  const distance = Number(row["distance_meters"] ?? row["distance"]);
  if (Number.isFinite(distance) && distance > 0) {
    return `${Math.round(distance)} m`;
  }

  const text = readText(
    row["display_distance"] ??
    row["distance_input"] ??
    row["distanceText"] ??
    row["distance_text"]
  );
  return text || "N/A";
}

function formatCardioTime(row: Record<string, unknown>): string {
  const time = Number(row["time_minutes"] ?? row["time"]);
  if (Number.isFinite(time) && time > 0) {
    return `${Math.round(time)} min`;
  }

  const text = readText(
    row["display_time"] ??
    row["time_input"] ??
    row["timeText"] ??
    row["time_text"]
  );
  return text || "N/A";
}

function resolveOtherTitle(row: Record<string, unknown>): string {
  return fromSnakeCase(
    readText(row["exercise_type"] ?? row["activity"] ?? row["name"] ?? "other_activity")
  );
}

function resolveOtherDetails(row: Record<string, unknown>): string {
  const sets = toRoundedNonNegative(row["sets"]);
  const reps = toRoundedNonNegative(row["reps"] ?? row["time"]);
  const weights = formatWeight(row);

  if (sets > 0 || reps > 0) {
    return `${sets} x ${reps} @ ${weights}`;
  }

  return readText(row["activity"] ?? row["name"] ?? row["type"]) || "Activity logged";
}

function fromSnakeCase(value: string): string {
  return readText(value)
    .split("_")
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

function toObjectArray(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) {
    return value.filter(
      (entry): entry is Record<string, unknown> => !!entry && typeof entry === "object"
    );
  }

  if (value && typeof value === "object") {
    return [value as Record<string, unknown>];
  }

  return [];
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function readText(value: unknown): string {
  return typeof value === "string"
    ? value.trim()
    : String(value ?? "").trim();
}

function toDate(value: unknown): Date | null {
  try {
    const dateValue = (value as {toDate?: () => Date} | null | undefined)?.toDate?.() ?? value;
    if (dateValue instanceof Date && !Number.isNaN(dateValue.getTime())) {
      return dateValue;
    }

    const parsed = new Date(readText(dateValue));
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  } catch {
    return null;
  }
}

function toNumberMap(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.entries(value as Record<string, unknown>).reduce<Record<string, number>>(
    (acc, [key, candidateValue]) => {
      const parsed = Number(candidateValue);
      if (Number.isFinite(parsed)) {
        acc[key] = parsed;
      }
      return acc;
    },
    {}
  );
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(
    new Set(
      value
        .map((entry) => readText(entry))
        .filter((entry) => entry.length > 0)
    )
  );
}

function normalizeEstimatorId(rawId: string): string {
  return readText(rawId)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
}

function toSexCode(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }

  const text = readText(value).toLowerCase();
  if (text === "male" || text === "m") {
    return 1;
  }
  if (text === "female" || text === "f") {
    return 2;
  }
  if (text === "nonbinary" || text === "non-binary" || text === "nb" || text === "other") {
    return 1.5;
  }

  const parsed = Number(text);
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }

  return 0;
}

function toNonNegativeNumber(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }
  return parsed;
}

function toNonNegativeInteger(value: unknown): number {
  return Math.round(toNonNegativeNumber(value));
}

function toInteger(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : fallback;
}

function toWholeNumber(value: unknown): number {
  return Math.round(Number(value) || 0);
}

function toRoundedNonNegative(value: unknown): number {
  return Math.round(toNonNegativeNumber(value));
}

function toLocalDateKey(value: Date): string {
  const year = value.getFullYear();
  const month = `${value.getMonth() + 1}`.padStart(2, "0");
  const day = `${value.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}
