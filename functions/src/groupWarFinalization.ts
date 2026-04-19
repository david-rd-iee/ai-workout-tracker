import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import { onSchedule } from "firebase-functions/v2/scheduler";

if (admin.apps.length === 0) {
  admin.initializeApp();
}

const db = admin.firestore();

const GROUP_WARS_COLLECTION = "groupWars";
const GROUPS_COLLECTION = "groupID";
const GROUP_LEADERBOARDS_COLLECTION = "groupLeaderboards";
const GROUP_LEADERBOARDS_GLOBAL_DOC_ID = "global";
const GROUP_LEADERBOARD_RANKINGS_SUBCOLLECTION = "rankings";
const WAR_CONTRIBUTIONS_SUBCOLLECTION = "contributions";
const WAR_MEMBERS_SUBCOLLECTION = "members";
const WAR_RECAP_SUBCOLLECTION = "recap";
const WAR_RECAP_SUMMARY_DOC_ID = "summary";

const WAR_STATUS_ACTIVE = "active";
const WAR_STATUS_FINALIZING = "finalizing";
const WAR_STATUS_FINALIZED = "finalized";
const FINALIZATION_LOCK_TIMEOUT_MS = 10 * 60 * 1000;
const EXPIRED_WAR_BATCH_LIMIT = 25;
const LEADERBOARD_SYNC_BATCH_WRITE_LIMIT = 400;
const TOP_MEMBER_RECAP_LIMIT = 5;

const WINNER_LEADERBOARD_POINTS = 3;
const LOSER_LEADERBOARD_POINTS = 1;
const TIE_LEADERBOARD_POINTS = 2;

interface FinalizationOutcome {
  finalized: boolean;
  warId: string;
}

interface WarResolution {
  result: "challenger_win" | "opponent_win" | "tie";
  winnerGroupId: string;
  groupAPointsAwarded: number;
  groupBPointsAwarded: number;
  challengerPointsAwarded: number;
  opponentPointsAwarded: number;
  groupAStatsDelta: {
    wins: number;
    losses: number;
    ties: number;
  };
  groupBStatsDelta: {
    wins: number;
    losses: number;
    ties: number;
  };
}

interface WarMemberRecap {
  userId: string;
  groupId: string;
  displayName: string;
  profilePicUrl?: string;
  normalizedWorkoutScoreTotal: number;
  totalContribution: number;
  cardioContributionTotal: number;
  strengthContributionTotal: number;
  exerciseContributionTotals: Record<string, number>;
  topExerciseTag?: string;
  workoutCount: number;
  rank: number;
}

interface WarContributionRecap {
  contributionId: string;
  workoutEventId: string;
  warId: string;
  groupId: string;
  userId: string;
  normalizedWorkoutScoreTotal: number;
  cardioContribution: number;
  strengthContribution: number;
  exerciseContributionDeltas: Record<string, number>;
  topExerciseTag?: string;
  contributedAt?: FirebaseFirestore.Timestamp;
}

interface GroupLeaderboardProjectionRow {
  groupId: string;
  groupName: string;
  groupImage?: string;
  dominantExerciseTag?: string;
  currentActiveWarId?: string;
  totalWarLeaderboardPoints: number;
  warRating: number;
  warWeight: number;
  wins: number;
  losses: number;
  ties: number;
  lastWarEndedAt?: FirebaseFirestore.Timestamp;
}

export const finalizeExpiredGroupWars = onSchedule("every 10 minutes", async () => {
  const now = new Date();
  const expiredWarIds = await loadExpiredWarIds(now);
  if (expiredWarIds.length === 0) {
    logger.info("Group war finalizer: no expired wars found.");
    return;
  }

  let finalizedCount = 0;
  for (const warId of expiredWarIds) {
    try {
      const outcome = await finalizeSingleWar(warId, now);
      if (outcome.finalized) {
        finalizedCount += 1;
      }
    } catch (error) {
      logger.error("Group war finalizer: failed to finalize war.", {
        warId,
        error: stringifyError(error),
      });
    }
  }

  let leaderboardSyncGroupCount = 0;
  if (finalizedCount > 0) {
    try {
      leaderboardSyncGroupCount = await syncGlobalGroupLeaderboardProjection();
    } catch (error) {
      logger.error("Group war finalizer: failed to sync global leaderboard projection.", {
        error: stringifyError(error),
      });
    }
  }

  logger.info("Group war finalizer: run completed.", {
    scannedCount: expiredWarIds.length,
    finalizedCount,
    leaderboardSyncGroupCount,
  });
});

async function loadExpiredWarIds(now: Date): Promise<string[]> {
  const nowTimestamp = admin.firestore.Timestamp.fromDate(now);
  const statuses = [WAR_STATUS_ACTIVE, WAR_STATUS_FINALIZING];
  const [endAtSnap, endsAtSnap] = await Promise.all([
    db.collection(GROUP_WARS_COLLECTION)
      .where("status", "in", statuses)
      .where("endAt", "<=", nowTimestamp)
      .orderBy("endAt", "asc")
      .limit(EXPIRED_WAR_BATCH_LIMIT)
      .get(),
    db.collection(GROUP_WARS_COLLECTION)
      .where("status", "in", statuses)
      .where("endsAt", "<=", nowTimestamp)
      .orderBy("endsAt", "asc")
      .limit(EXPIRED_WAR_BATCH_LIMIT)
      .get(),
  ]);

  const warsById = new Map<string, number>();
  const applySnapshots = (snap: FirebaseFirestore.QuerySnapshot) => {
    snap.docs.forEach((docSnap) => {
      const warData = docSnap.data() ?? {};
      const endAtDate = resolveWarEndDate(warData);
      const endAtMillis = endAtDate ? endAtDate.getTime() : Number.MAX_SAFE_INTEGER;
      const existing = warsById.get(docSnap.id);
      if (existing === undefined || endAtMillis < existing) {
        warsById.set(docSnap.id, endAtMillis);
      }
    });
  };

  applySnapshots(endAtSnap);
  applySnapshots(endsAtSnap);

  return Array.from(warsById.entries())
    .sort((left, right) => left[1] - right[1])
    .slice(0, EXPIRED_WAR_BATCH_LIMIT)
    .map(([warId]) => warId);
}

async function finalizeSingleWar(warId: string, now: Date): Promise<FinalizationOutcome> {
  const normalizedWarId = normalizeString(warId);
  if (!normalizedWarId) {
    return {finalized: false, warId: ""};
  }

  const lockToken = buildFinalizationLockToken(normalizedWarId);
  const lockAcquired = await acquireFinalizationLock(normalizedWarId, now, lockToken);
  if (!lockAcquired) {
    return {finalized: false, warId: normalizedWarId};
  }

  const finalized = await finalizeLockedWar(normalizedWarId, lockToken);
  if (!finalized) {
    return {finalized: false, warId: normalizedWarId};
  }

  await writeWarRecap(normalizedWarId);
  return {finalized: true, warId: normalizedWarId};
}

async function acquireFinalizationLock(
  warId: string,
  now: Date,
  lockToken: string
): Promise<boolean> {
  const warRef = db.doc(`${GROUP_WARS_COLLECTION}/${warId}`);
  return db.runTransaction(async (transaction) => {
    const warSnap = await transaction.get(warRef);
    if (!warSnap.exists) {
      return false;
    }

    const warData = warSnap.data() ?? {};
    const status = normalizeString(warData["status"]);
    if (status !== WAR_STATUS_ACTIVE && status !== WAR_STATUS_FINALIZING) {
      return false;
    }

    const warEndDate = resolveWarEndDate(warData);
    if (!warEndDate || warEndDate.getTime() > now.getTime()) {
      return false;
    }

    const existingLockToken = normalizeString(warData["finalizationLockToken"]);
    const existingLockDate = toDate(warData["finalizationLockedAt"]);
    const lockIsStale = !existingLockDate ||
      (now.getTime() - existingLockDate.getTime()) > FINALIZATION_LOCK_TIMEOUT_MS;

    if (
      status === WAR_STATUS_FINALIZING &&
      existingLockToken &&
      existingLockToken !== lockToken &&
      !lockIsStale
    ) {
      return false;
    }

    transaction.set(
      warRef,
      {
        status: WAR_STATUS_FINALIZING,
        finalizationLockToken: lockToken,
        finalizationLockedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      {merge: true}
    );
    return true;
  });
}

async function finalizeLockedWar(warId: string, lockToken: string): Promise<boolean> {
  const warRef = db.doc(`${GROUP_WARS_COLLECTION}/${warId}`);
  return db.runTransaction(async (transaction) => {
    const warSnap = await transaction.get(warRef);
    if (!warSnap.exists) {
      return false;
    }

    const warData = warSnap.data() ?? {};
    const status = normalizeString(warData["status"]);
    if (status !== WAR_STATUS_FINALIZING) {
      return false;
    }
    if (normalizeString(warData["finalizationLockToken"]) !== lockToken) {
      return false;
    }

    const groupAId = normalizeString(warData["groupAId"] ?? warData["challengerGroupId"]);
    const groupBId = normalizeString(warData["groupBId"] ?? warData["opponentGroupId"]);
    if (!groupAId || !groupBId || groupAId === groupBId) {
      transaction.set(
        warRef,
        {
          status: "cancelled",
          cancelledReason: "invalid_groups_at_finalization",
          finalizationLockToken: admin.firestore.FieldValue.delete(),
          finalizationLockedAt: admin.firestore.FieldValue.delete(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        {merge: true}
      );
      return false;
    }

    const groupARef = db.doc(`${GROUPS_COLLECTION}/${groupAId}`);
    const groupBRef = db.doc(`${GROUPS_COLLECTION}/${groupBId}`);
    const groupALeaderboardRef = db.doc(
      `${GROUP_LEADERBOARDS_COLLECTION}/${GROUP_LEADERBOARDS_GLOBAL_DOC_ID}/${GROUP_LEADERBOARD_RANKINGS_SUBCOLLECTION}/${groupAId}`
    );
    const groupBLeaderboardRef = db.doc(
      `${GROUP_LEADERBOARDS_COLLECTION}/${GROUP_LEADERBOARDS_GLOBAL_DOC_ID}/${GROUP_LEADERBOARD_RANKINGS_SUBCOLLECTION}/${groupBId}`
    );
    const [groupASnap, groupBSnap] = await Promise.all([
      transaction.get(groupARef),
      transaction.get(groupBRef),
    ]);

    const groupAData = groupASnap.exists ? groupASnap.data() ?? {} : {};
    const groupBData = groupBSnap.exists ? groupBSnap.data() ?? {} : {};
    const groupATotal = toWholeNumber(warData["groupAPoints"] ?? warData["challengerScoreTotal"]);
    const groupBTotal = toWholeNumber(warData["groupBPoints"] ?? warData["opponentScoreTotal"]);
    const resolution = resolveWarResult({
      warData,
      groupAId,
      groupBId,
      groupATotal,
      groupBTotal,
    });
    const shouldAwardPoints = warData["leaderboardPointsAwarded"] !== true;

    const groupAUpdate: Record<string, unknown> = {
      lastWarEndedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    if (normalizeString(groupAData["currentActiveWarId"]) === warId) {
      groupAUpdate["currentActiveWarId"] = admin.firestore.FieldValue.delete();
    }
    const groupBUpdate: Record<string, unknown> = {
      lastWarEndedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    if (normalizeString(groupBData["currentActiveWarId"]) === warId) {
      groupBUpdate["currentActiveWarId"] = admin.firestore.FieldValue.delete();
    }

    if (shouldAwardPoints) {
      groupAUpdate["wins"] = admin.firestore.FieldValue.increment(resolution.groupAStatsDelta.wins);
      groupAUpdate["losses"] = admin.firestore.FieldValue.increment(resolution.groupAStatsDelta.losses);
      groupAUpdate["ties"] = admin.firestore.FieldValue.increment(resolution.groupAStatsDelta.ties);
      groupAUpdate["totalWarLeaderboardPoints"] = admin.firestore.FieldValue.increment(
        resolution.groupAPointsAwarded
      );

      groupBUpdate["wins"] = admin.firestore.FieldValue.increment(resolution.groupBStatsDelta.wins);
      groupBUpdate["losses"] = admin.firestore.FieldValue.increment(resolution.groupBStatsDelta.losses);
      groupBUpdate["ties"] = admin.firestore.FieldValue.increment(resolution.groupBStatsDelta.ties);
      groupBUpdate["totalWarLeaderboardPoints"] = admin.firestore.FieldValue.increment(
        resolution.groupBPointsAwarded
      );
    }

    transaction.set(groupARef, groupAUpdate, {merge: true});
    transaction.set(groupBRef, groupBUpdate, {merge: true});

    if (shouldAwardPoints) {
      transaction.set(
        groupALeaderboardRef,
        buildLeaderboardUpdate({
          groupId: groupAId,
          groupData: groupAData,
          pointsAwarded: resolution.groupAPointsAwarded,
          statsDelta: resolution.groupAStatsDelta,
        }),
        {merge: true}
      );
      transaction.set(
        groupBLeaderboardRef,
        buildLeaderboardUpdate({
          groupId: groupBId,
          groupData: groupBData,
          pointsAwarded: resolution.groupBPointsAwarded,
          statsDelta: resolution.groupBStatsDelta,
        }),
        {merge: true}
      );
    }

    const challengerGroupId = normalizeString(warData["challengerGroupId"]) || groupAId;
    const opponentGroupId = normalizeString(warData["opponentGroupId"]) || groupBId;
    transaction.set(
      warRef,
      {
        status: WAR_STATUS_FINALIZED,
        result: resolution.result,
        ...(resolution.winnerGroupId ? {winnerGroupId: resolution.winnerGroupId} : {}),
        groupAPoints: groupATotal,
        groupBPoints: groupBTotal,
        challengerScoreTotal: challengerGroupId === groupAId ? groupATotal : groupBTotal,
        opponentScoreTotal: opponentGroupId === groupAId ? groupATotal : groupBTotal,
        groupAPointsAwarded: resolution.groupAPointsAwarded,
        groupBPointsAwarded: resolution.groupBPointsAwarded,
        challengerPointsAwarded: resolution.challengerPointsAwarded,
        opponentPointsAwarded: resolution.opponentPointsAwarded,
        leaderboardPointsAwarded: true,
        finalizedAt: admin.firestore.FieldValue.serverTimestamp(),
        finalizationLockToken: admin.firestore.FieldValue.delete(),
        finalizationLockedAt: admin.firestore.FieldValue.delete(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      {merge: true}
    );

    return true;
  });
}

async function writeWarRecap(warId: string): Promise<void> {
  const warRef = db.doc(`${GROUP_WARS_COLLECTION}/${warId}`);
  const [warSnap, membersSnap, contributionsSnap] = await Promise.all([
    warRef.get(),
    db.collection(`${GROUP_WARS_COLLECTION}/${warId}/${WAR_MEMBERS_SUBCOLLECTION}`).get(),
    db.collection(`${GROUP_WARS_COLLECTION}/${warId}/${WAR_CONTRIBUTIONS_SUBCOLLECTION}`).get(),
  ]);
  if (!warSnap.exists) {
    return;
  }

  const warData = warSnap.data() ?? {};
  const status = normalizeString(warData["status"]);
  if (status !== WAR_STATUS_FINALIZED) {
    return;
  }

  const groupAId = normalizeString(warData["groupAId"] ?? warData["challengerGroupId"]);
  const groupBId = normalizeString(warData["groupBId"] ?? warData["opponentGroupId"]);
  if (!groupAId || !groupBId) {
    return;
  }

  const [groupASnap, groupBSnap] = await Promise.all([
    db.doc(`${GROUPS_COLLECTION}/${groupAId}`).get(),
    db.doc(`${GROUPS_COLLECTION}/${groupBId}`).get(),
  ]);
  const groupAData = groupASnap.exists ? groupASnap.data() ?? {} : {};
  const groupBData = groupBSnap.exists ? groupBSnap.data() ?? {} : {};
  const challengerGroupId = normalizeString(warData["challengerGroupId"]) || groupAId;
  const opponentGroupId = normalizeString(warData["opponentGroupId"]) || groupBId;
  const challengerGroupName = readText(
    (challengerGroupId === groupAId ? groupAData["name"] : groupBData["name"]) ?? "Group"
  ) || "Group";
  const opponentGroupName = readText(
    (opponentGroupId === groupAId ? groupAData["name"] : groupBData["name"]) ?? "Group"
  ) || "Group";
  const members = membersSnap.docs.map((snap) => toWarMemberRecap(snap.data() ?? {}));
  const contributions = contributionsSnap.docs.map((snap) => toWarContributionRecap(snap.id, snap.data() ?? {}));
  const groupATopMembers = buildTopMembersForGroup(members, groupAId);
  const groupBTopMembers = buildTopMembersForGroup(members, groupBId);
  const challengerTopMembers = challengerGroupId === groupAId ? groupATopMembers : groupBTopMembers;
  const opponentTopMembers = opponentGroupId === groupAId ? groupATopMembers : groupBTopMembers;

  const groupNameById = new Map<string, string>([
    [groupAId, readText(groupAData["name"]) || "Group"],
    [groupBId, readText(groupBData["name"]) || "Group"],
    [challengerGroupId, challengerGroupName],
    [opponentGroupId, opponentGroupName],
  ]);
  const winnerGroupId = normalizeString(warData["winnerGroupId"]);
  const winnerGroupName = winnerGroupId ? (groupNameById.get(winnerGroupId) ?? "Group") : "";
  const challengerScoreTotal = toWholeNumber(warData["challengerScoreTotal"]);
  const opponentScoreTotal = toWholeNumber(warData["opponentScoreTotal"]);

  const challengerCardioPoints = firstDefinedWholeNumber(
    warData["challengerCardioScoreTotal"],
    challengerGroupId === groupAId ? warData["groupACardioPoints"] : warData["groupBCardioPoints"]
  );
  const challengerStrengthPoints = firstDefinedWholeNumber(
    warData["challengerStrengthScoreTotal"],
    challengerGroupId === groupAId ? warData["groupAStrengthPoints"] : warData["groupBStrengthPoints"]
  );
  const opponentCardioPoints = firstDefinedWholeNumber(
    warData["opponentCardioScoreTotal"],
    opponentGroupId === groupAId ? warData["groupACardioPoints"] : warData["groupBCardioPoints"]
  );
  const opponentStrengthPoints = firstDefinedWholeNumber(
    warData["opponentStrengthScoreTotal"],
    opponentGroupId === groupAId ? warData["groupAStrengthPoints"] : warData["groupBStrengthPoints"]
  );

  const workoutSubmissionSummary = buildWorkoutSubmissionSummary(
    contributions,
    challengerGroupId,
    opponentGroupId
  );
  const memberByUserId = new Map(members.map((member) => [member.userId, member]));
  const standoutContribution = resolveStandoutContribution(contributions, memberByUserId);

  const recapRef = db.doc(
    `${GROUP_WARS_COLLECTION}/${warId}/${WAR_RECAP_SUBCOLLECTION}/${WAR_RECAP_SUMMARY_DOC_ID}`
  );
  await recapRef.set(
    {
      warId,
      status,
      result: normalizeString(warData["result"]),
      challengerGroupId,
      challengerGroupName,
      opponentGroupId,
      opponentGroupName,
      activatedAt: warData["activatedAt"] ?? warData["startAt"] ?? null,
      endsAt: warData["endsAt"] ?? warData["endAt"] ?? null,
      finalizedAt: warData["finalizedAt"] ?? admin.firestore.FieldValue.serverTimestamp(),
      challengerScoreTotal,
      opponentScoreTotal,
      challengerPointsAwarded: toWholeNumber(warData["challengerPointsAwarded"]),
      opponentPointsAwarded: toWholeNumber(warData["opponentPointsAwarded"]),
      winnerGroupId,
      challengerTopMembers,
      opponentTopMembers,
      winner: winnerGroupId
        ? {
          type: "group",
          groupId: winnerGroupId,
          groupName: winnerGroupName,
        }
        : {
          type: "tie",
        },
      finalScore: {
        challenger: challengerScoreTotal,
        opponent: opponentScoreTotal,
        margin: Math.abs(challengerScoreTotal - opponentScoreTotal),
      },
      topContributorByTeam: {
        challenger: toTopContributorSummary(challengerTopMembers[0]),
        opponent: toTopContributorSummary(opponentTopMembers[0]),
      },
      mostUsedExerciseByTeam: {
        challenger: resolveMostUsedExerciseForGroup(contributions, challengerGroupId),
        opponent: resolveMostUsedExerciseForGroup(contributions, opponentGroupId),
      },
      totalWorkoutsSubmitted: workoutSubmissionSummary,
      cardioVsStrengthShare: {
        challenger: buildCategoryShare(challengerCardioPoints, challengerStrengthPoints),
        opponent: buildCategoryShare(opponentCardioPoints, opponentStrengthPoints),
        overall: buildCategoryShare(
          challengerCardioPoints + opponentCardioPoints,
          challengerStrengthPoints + opponentStrengthPoints
        ),
      },
      standoutSingleWorkoutContribution: standoutContribution,
      generatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    {merge: true}
  );
}

async function syncGlobalGroupLeaderboardProjection(): Promise<number> {
  const groupsSnap = await db.collection(GROUPS_COLLECTION).get();
  if (groupsSnap.empty) {
    return 0;
  }

  const rows = groupsSnap.docs
    .map((docSnap) => toGroupLeaderboardProjectionRow(docSnap.id, docSnap.data() ?? {}))
    .filter((row) => !!row.groupId);

  rows.sort((left, right) => {
    if (right.totalWarLeaderboardPoints !== left.totalWarLeaderboardPoints) {
      return right.totalWarLeaderboardPoints - left.totalWarLeaderboardPoints;
    }
    if (right.wins !== left.wins) {
      return right.wins - left.wins;
    }
    if (right.warRating !== left.warRating) {
      return right.warRating - left.warRating;
    }
    return left.groupId.localeCompare(right.groupId);
  });

  let batch = db.batch();
  let writeCount = 0;
  let syncedGroupCount = 0;
  const flushBatch = async () => {
    if (writeCount === 0) {
      return;
    }
    await batch.commit();
    batch = db.batch();
    writeCount = 0;
  };

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const rank = index + 1;
    const groupRef = db.doc(`${GROUPS_COLLECTION}/${row.groupId}`);
    const leaderboardRef = db.doc(
      `${GROUP_LEADERBOARDS_COLLECTION}/${GROUP_LEADERBOARDS_GLOBAL_DOC_ID}/${GROUP_LEADERBOARD_RANKINGS_SUBCOLLECTION}/${row.groupId}`
    );

    const leaderboardPayload: Record<string, unknown> = {
      groupId: row.groupId,
      groupName: row.groupName,
      rank,
      globalLeaderboardRank: rank,
      totalWarLeaderboardPoints: row.totalWarLeaderboardPoints,
      warRating: row.warRating,
      warWeight: row.warWeight,
      wins: row.wins,
      losses: row.losses,
      ties: row.ties,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    if (row.lastWarEndedAt) {
      leaderboardPayload["lastWarEndedAt"] = row.lastWarEndedAt;
    }
    if (row.groupImage) {
      leaderboardPayload["groupImage"] = row.groupImage;
    } else {
      leaderboardPayload["groupImage"] = admin.firestore.FieldValue.delete();
    }
    if (row.dominantExerciseTag) {
      leaderboardPayload["dominantExerciseTag"] = row.dominantExerciseTag;
    } else {
      leaderboardPayload["dominantExerciseTag"] = admin.firestore.FieldValue.delete();
    }
    if (row.currentActiveWarId) {
      leaderboardPayload["currentActiveWarId"] = row.currentActiveWarId;
    } else {
      leaderboardPayload["currentActiveWarId"] = admin.firestore.FieldValue.delete();
    }

    batch.set(
      groupRef,
      {
        globalLeaderboardRank: rank,
      },
      {merge: true}
    );
    batch.set(leaderboardRef, leaderboardPayload, {merge: true});

    writeCount += 2;
    syncedGroupCount += 1;

    if (writeCount >= LEADERBOARD_SYNC_BATCH_WRITE_LIMIT) {
      await flushBatch();
    }
  }

  await flushBatch();
  return syncedGroupCount;
}

function toGroupLeaderboardProjectionRow(
  groupId: unknown,
  groupData: Record<string, unknown>
): GroupLeaderboardProjectionRow {
  const normalizedGroupId = normalizeString(groupId);
  const groupImage = normalizeString(groupData["groupImage"]);
  const dominantExerciseTag = normalizeString(groupData["dominantExerciseTag"]);
  const currentActiveWarId = normalizeString(groupData["currentActiveWarId"]);
  const lastWarEndedAt = toTimestamp(groupData["lastWarEndedAt"]);

  return {
    groupId: normalizedGroupId,
    groupName: readText(groupData["name"]) || "Group",
    ...(groupImage ? {groupImage} : {}),
    ...(dominantExerciseTag ? {dominantExerciseTag} : {}),
    ...(currentActiveWarId ? {currentActiveWarId} : {}),
    ...(lastWarEndedAt ? {lastWarEndedAt} : {}),
    totalWarLeaderboardPoints: toWholeNumber(groupData["totalWarLeaderboardPoints"]),
    warRating: toWholeNumber(groupData["warRating"] ?? 1000),
    warWeight: toWholeNumber(groupData["warWeight"] ?? 1),
    wins: toWholeNumber(groupData["wins"]),
    losses: toWholeNumber(groupData["losses"]),
    ties: toWholeNumber(groupData["ties"]),
  };
}

function toWarMemberRecap(data: Record<string, unknown>): WarMemberRecap {
  return {
    userId: normalizeString(data["userId"]),
    groupId: normalizeString(data["groupId"]),
    displayName: readText(data["displayName"]) || "Member",
    ...(normalizeString(data["profilePicUrl"])
      ? {profilePicUrl: normalizeString(data["profilePicUrl"])}
      : {}),
    normalizedWorkoutScoreTotal: toWholeNumber(
      data["normalizedWorkoutScoreTotal"] ?? data["totalContribution"]
    ),
    totalContribution: toWholeNumber(data["totalContribution"] ?? data["normalizedWorkoutScoreTotal"]),
    cardioContributionTotal: toWholeNumber(data["cardioContributionTotal"]),
    strengthContributionTotal: toWholeNumber(data["strengthContributionTotal"]),
    exerciseContributionTotals: toNumberMap(
      data["exerciseContributionTotals"] ?? data["exerciseTotals"]
    ),
    ...(normalizeString(data["topExerciseTag"])
      ? {topExerciseTag: normalizeString(data["topExerciseTag"])}
      : {}),
    workoutCount: toWholeNumber(data["workoutCount"]),
    rank: toWholeNumber(data["rank"]),
  };
}

function toWarContributionRecap(
  contributionId: string,
  data: Record<string, unknown>
): WarContributionRecap {
  const normalizedContributionId = normalizeString(contributionId);
  const workoutEventId = normalizeString(data["workoutEventId"] ?? data["derivedFromWorkoutEventId"]) ||
    normalizedContributionId;
  return {
    contributionId: normalizeString(data["contributionId"]) || normalizedContributionId,
    workoutEventId,
    warId: normalizeString(data["warId"]),
    groupId: normalizeString(data["groupId"]),
    userId: normalizeString(data["userId"]),
    normalizedWorkoutScoreTotal: toWholeNumber(
      data["normalizedWorkoutScoreTotal"] ?? data["totalContribution"]
    ),
    cardioContribution: toWholeNumber(data["cardioContribution"]),
    strengthContribution: toWholeNumber(data["strengthContribution"]),
    exerciseContributionDeltas: toNumberMap(data["exerciseContributionDeltas"]),
    ...(normalizeString(data["topExerciseTag"])
      ? {topExerciseTag: normalizeString(data["topExerciseTag"])}
      : {}),
    ...(toTimestamp(data["contributedAt"])
      ? {contributedAt: toTimestamp(data["contributedAt"])}
      : {}),
  };
}

function buildWorkoutSubmissionSummary(
  contributions: WarContributionRecap[],
  challengerGroupId: string,
  opponentGroupId: string
): {total: number; challenger: number; opponent: number} {
  let challengerCount = 0;
  let opponentCount = 0;

  contributions.forEach((contribution) => {
    if (contribution.groupId === challengerGroupId) {
      challengerCount += 1;
      return;
    }
    if (contribution.groupId === opponentGroupId) {
      opponentCount += 1;
    }
  });

  return {
    total: challengerCount + opponentCount,
    challenger: challengerCount,
    opponent: opponentCount,
  };
}

function toTopContributorSummary(member?: WarMemberRecap): Record<string, unknown> | null {
  if (!member) {
    return null;
  }
  return {
    userId: member.userId,
    groupId: member.groupId,
    displayName: member.displayName,
    ...(member.profilePicUrl ? {profilePicUrl: member.profilePicUrl} : {}),
    normalizedWorkoutScoreTotal: member.normalizedWorkoutScoreTotal,
    workoutCount: member.workoutCount,
    ...(member.topExerciseTag ? {topExerciseTag: member.topExerciseTag} : {}),
  };
}

function resolveMostUsedExerciseForGroup(
  contributions: WarContributionRecap[],
  groupId: string
): Record<string, unknown> | null {
  const totals: Record<string, number> = {};
  contributions.forEach((contribution) => {
    if (contribution.groupId !== groupId) {
      return;
    }
    Object.entries(contribution.exerciseContributionDeltas).forEach(([exerciseTag, addedScore]) => {
      const normalizedExerciseTag = normalizeString(exerciseTag).toLowerCase();
      const normalizedScore = toWholeNumber(addedScore);
      if (!normalizedExerciseTag || normalizedScore <= 0) {
        return;
      }
      totals[normalizedExerciseTag] = toWholeNumber(
        toWholeNumber(totals[normalizedExerciseTag]) + normalizedScore
      );
    });
  });

  const topExerciseTag = resolveTopExerciseTagFromTotals(totals);
  if (!topExerciseTag) {
    return null;
  }
  return {
    exerciseTag: topExerciseTag,
    normalizedWorkoutScoreTotal: toWholeNumber(totals[topExerciseTag]),
  };
}

function resolveTopExerciseTagFromTotals(exerciseTotals: Record<string, number>): string {
  let topExerciseTag = "";
  let topScore = 0;

  Object.entries(exerciseTotals).forEach(([exerciseTag, total]) => {
    const normalizedExerciseTag = normalizeString(exerciseTag).toLowerCase();
    const normalizedTotal = toWholeNumber(total);
    if (!normalizedExerciseTag || normalizedTotal <= 0) {
      return;
    }

    if (
      normalizedTotal > topScore ||
      (normalizedTotal === topScore && normalizedExerciseTag.localeCompare(topExerciseTag) < 0)
    ) {
      topExerciseTag = normalizedExerciseTag;
      topScore = normalizedTotal;
    }
  });

  return topExerciseTag;
}

function buildCategoryShare(cardioPoints: number, strengthPoints: number): {
  cardioPoints: number;
  strengthPoints: number;
  cardioShare: number;
  strengthShare: number;
} {
  const normalizedCardioPoints = toWholeNumber(cardioPoints);
  const normalizedStrengthPoints = toWholeNumber(strengthPoints);
  const totalPoints = normalizedCardioPoints + normalizedStrengthPoints;
  if (totalPoints <= 0) {
    return {
      cardioPoints: normalizedCardioPoints,
      strengthPoints: normalizedStrengthPoints,
      cardioShare: 0,
      strengthShare: 0,
    };
  }

  return {
    cardioPoints: normalizedCardioPoints,
    strengthPoints: normalizedStrengthPoints,
    cardioShare: roundShare(normalizedCardioPoints / totalPoints),
    strengthShare: roundShare(normalizedStrengthPoints / totalPoints),
  };
}

function resolveStandoutContribution(
  contributions: WarContributionRecap[],
  memberByUserId: Map<string, WarMemberRecap>
): Record<string, unknown> | null {
  if (contributions.length === 0) {
    return null;
  }

  const sorted = [...contributions].sort((left, right) => {
    if (right.normalizedWorkoutScoreTotal !== left.normalizedWorkoutScoreTotal) {
      return right.normalizedWorkoutScoreTotal - left.normalizedWorkoutScoreTotal;
    }
    return toMillis(right.contributedAt) - toMillis(left.contributedAt);
  });

  const standout = sorted[0];
  const member = memberByUserId.get(standout.userId);
  return {
    contributionId: standout.contributionId,
    workoutEventId: standout.workoutEventId,
    userId: standout.userId,
    groupId: standout.groupId,
    displayName: member?.displayName ?? "Member",
    ...(member?.profilePicUrl ? {profilePicUrl: member.profilePicUrl} : {}),
    normalizedWorkoutScoreTotal: standout.normalizedWorkoutScoreTotal,
    cardioContribution: standout.cardioContribution,
    strengthContribution: standout.strengthContribution,
    ...(standout.topExerciseTag ? {topExerciseTag: standout.topExerciseTag} : {}),
    ...(standout.contributedAt ? {contributedAt: standout.contributedAt} : {}),
  };
}

function buildTopMembersForGroup(members: WarMemberRecap[], groupId: string): WarMemberRecap[] {
  const filtered = members.filter((member) => member.groupId === groupId);
  filtered.sort((left, right) => {
    if (right.normalizedWorkoutScoreTotal !== left.normalizedWorkoutScoreTotal) {
      return right.normalizedWorkoutScoreTotal - left.normalizedWorkoutScoreTotal;
    }
    if (right.workoutCount !== left.workoutCount) {
      return right.workoutCount - left.workoutCount;
    }
    return left.displayName.localeCompare(right.displayName);
  });

  return filtered.slice(0, TOP_MEMBER_RECAP_LIMIT).map((member, index) => ({
    ...member,
    rank: index + 1,
  }));
}

function resolveWarResult(params: {
  warData: Record<string, unknown>;
  groupAId: string;
  groupBId: string;
  groupATotal: number;
  groupBTotal: number;
}): WarResolution {
  const {warData, groupAId, groupBId, groupATotal, groupBTotal} = params;
  const challengerGroupId = normalizeString(warData["challengerGroupId"]) || groupAId;
  const opponentGroupId = normalizeString(warData["opponentGroupId"]) || groupBId;

  if (groupATotal === groupBTotal) {
    return {
      result: "tie",
      winnerGroupId: "",
      groupAPointsAwarded: TIE_LEADERBOARD_POINTS,
      groupBPointsAwarded: TIE_LEADERBOARD_POINTS,
      challengerPointsAwarded: TIE_LEADERBOARD_POINTS,
      opponentPointsAwarded: TIE_LEADERBOARD_POINTS,
      groupAStatsDelta: {wins: 0, losses: 0, ties: 1},
      groupBStatsDelta: {wins: 0, losses: 0, ties: 1},
    };
  }

  const groupAWon = groupATotal > groupBTotal;
  const winnerGroupId = groupAWon ? groupAId : groupBId;
  const groupAPointsAwarded = groupAWon ? WINNER_LEADERBOARD_POINTS : LOSER_LEADERBOARD_POINTS;
  const groupBPointsAwarded = groupAWon ? LOSER_LEADERBOARD_POINTS : WINNER_LEADERBOARD_POINTS;
  const challengerPointsAwarded = challengerGroupId === groupAId ? groupAPointsAwarded : groupBPointsAwarded;
  const opponentPointsAwarded = opponentGroupId === groupAId ? groupAPointsAwarded : groupBPointsAwarded;
  const result = winnerGroupId === challengerGroupId ? "challenger_win" : "opponent_win";

  return {
    result,
    winnerGroupId,
    groupAPointsAwarded,
    groupBPointsAwarded,
    challengerPointsAwarded,
    opponentPointsAwarded,
    groupAStatsDelta: groupAWon
      ? {wins: 1, losses: 0, ties: 0}
      : {wins: 0, losses: 1, ties: 0},
    groupBStatsDelta: groupAWon
      ? {wins: 0, losses: 1, ties: 0}
      : {wins: 1, losses: 0, ties: 0},
  };
}

function buildLeaderboardUpdate(params: {
  groupId: string;
  groupData: Record<string, unknown>;
  pointsAwarded: number;
  statsDelta: {
    wins: number;
    losses: number;
    ties: number;
  };
}): Record<string, unknown> {
  const {groupId, groupData, pointsAwarded, statsDelta} = params;
  const payload: Record<string, unknown> = {
    groupId,
    groupName: readText(groupData["name"]) || "Group",
    totalWarLeaderboardPoints: admin.firestore.FieldValue.increment(pointsAwarded),
    wins: admin.firestore.FieldValue.increment(statsDelta.wins),
    losses: admin.firestore.FieldValue.increment(statsDelta.losses),
    ties: admin.firestore.FieldValue.increment(statsDelta.ties),
    warRating: toWholeNumber(groupData["warRating"] ?? 1000),
    warWeight: toWholeNumber(groupData["warWeight"] ?? 1),
    lastWarEndedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  const groupImage = normalizeString(groupData["groupImage"]);
  if (groupImage) {
    payload["groupImage"] = groupImage;
  }
  const dominantExerciseTag = normalizeString(groupData["dominantExerciseTag"]);
  if (dominantExerciseTag) {
    payload["dominantExerciseTag"] = dominantExerciseTag;
  }

  payload["currentActiveWarId"] = admin.firestore.FieldValue.delete();
  return payload;
}

function resolveWarEndDate(warData: Record<string, unknown>): Date | null {
  return toDate(warData["endAt"] ?? warData["endsAt"]);
}

function buildFinalizationLockToken(warId: string): string {
  return `${warId}:${Date.now()}:${Math.floor(Math.random() * 1_000_000)}`;
}

function normalizeString(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
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

function toTimestamp(value: unknown): FirebaseFirestore.Timestamp | undefined {
  if (value instanceof admin.firestore.Timestamp) {
    return value;
  }

  const parsedDate = toDate(value);
  if (!parsedDate) {
    return undefined;
  }
  return admin.firestore.Timestamp.fromDate(parsedDate);
}

function toMillis(value: unknown): number {
  const dateValue = toDate(value);
  return dateValue ? dateValue.getTime() : 0;
}

function toNumberMap(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const result: Record<string, number> = {};
  Object.entries(value as Record<string, unknown>).forEach(([key, raw]) => {
    const normalizedKey = normalizeString(key).toLowerCase();
    const normalizedValue = toWholeNumber(raw);
    if (!normalizedKey || normalizedValue <= 0) {
      return;
    }
    result[normalizedKey] = normalizedValue;
  });
  return result;
}

function firstDefinedWholeNumber(...values: unknown[]): number {
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === null || value === undefined || value === "") {
      continue;
    }

    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return Math.round(parsed);
    }
  }
  return 0;
}

function roundShare(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }
  if (value >= 1) {
    return 1;
  }
  return Math.round(value * 10000) / 10000;
}

function toWholeNumber(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }
  return Math.round(parsed);
}

function stringifyError(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }
  return readText(error);
}
