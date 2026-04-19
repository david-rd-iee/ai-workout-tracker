import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import { onSchedule } from "firebase-functions/v2/scheduler";

if (admin.apps.length === 0) {
  admin.initializeApp();
}

const db = admin.firestore();

const GROUPS_COLLECTION = "groupID";
const GROUP_WARS_COLLECTION = "groupWars";
const USER_STATS_COLLECTION = "userStats";

const WAR_PROPOSAL_STATUS = "pending_confirmation";
const UNRESOLVED_WAR_STATUSES = new Set<string>([
  "pending_confirmation",
  "pending_acceptance",
  "active",
  "finalizing",
]);
const WAR_HISTORY_SCAN_LIMIT = 750;
const USER_STATS_BATCH_READ_SIZE = 300;
const REPEAT_OPPONENT_COOLDOWN_DAYS = 21;

const WAR_WEIGHT_GAP_RATIO_TOLERANCE = 0.35;
const ACTIVE_MEMBER_GAP_RATIO_TOLERANCE = 0.3;
const ACTIVE_MEMBER_GAP_MIN = 1;
const BIAS_GAP_TOLERANCE = 0.2;

interface GroupCandidate {
  groupId: string;
  ownerUserId: string;
  userIds: string[];
  warOptIn: boolean;
  warEnabled: boolean;
  warWeight: number;
  isPTGroup: boolean;
  currentActiveWarId: string;
}

interface UserScoreTotals {
  totalScore: number;
  totalStrengthScore: number;
  totalCardioScore: number;
}

interface GroupMatchProfile extends GroupCandidate {
  totalScoreSum: number;
  totalStrengthSum: number;
  totalCardioSum: number;
  activeMemberCount: number;
  strengthShare: number;
  cardioShare: number;
  effectiveWarWeight: number;
}

interface MatchProposal {
  challenger: GroupMatchProfile;
  opponent: GroupMatchProfile;
  compatibilityScore: number;
}

interface WarSnapshot {
  challengerGroupId: string;
  opponentGroupId: string;
  status: string;
  createdAtMillis: number;
}

export const proposeGroupWarMatches = onSchedule("every minute", async () => {
  const groupsSnap = await db.collection(GROUPS_COLLECTION)
    .where("warOptIn", "==", true)
    .get();

  const scannedGroups = groupsSnap.docs.map((snap) => buildGroupCandidate(snap.id, snap.data()));
  const baseEligibleGroups = scannedGroups.filter((group) => isBaseEligible(group));
  if (baseEligibleGroups.length < 2) {
    logger.info("Group war matchmaker: not enough eligible opted-in groups.", {
      scannedGroupCount: scannedGroups.length,
      baseEligibleGroupCount: baseEligibleGroups.length,
    });
    return;
  }

  const warSnapshots = await loadRecentWarSnapshots();
  const latestPairTimestampByPairKey = buildLatestPairTimestampMap(warSnapshots);
  const unresolvedGroupIds = buildUnresolvedGroupSet(warSnapshots);
  const unresolvedPairKeys = buildUnresolvedPairSet(warSnapshots);

  const eligibleGroups = baseEligibleGroups.filter((group) => !unresolvedGroupIds.has(group.groupId));
  if (eligibleGroups.length < 2) {
    logger.info("Group war matchmaker: all opted-in groups are currently busy.", {
      scannedGroupCount: scannedGroups.length,
      baseEligibleGroupCount: baseEligibleGroups.length,
      unresolvedGroupCount: unresolvedGroupIds.size,
    });
    return;
  }

  const userScoreTotalsByUserId = await loadUserScoreTotalsForGroups(eligibleGroups);
  const profiles = eligibleGroups
    .map((group) => buildMatchProfile(group, userScoreTotalsByUserId))
    .filter((profile) => profile.activeMemberCount > 0);

  if (profiles.length < 2) {
    logger.info("Group war matchmaker: no groups with active members found.", {
      scannedGroupCount: scannedGroups.length,
      baseEligibleGroupCount: baseEligibleGroups.length,
      eligibleGroupCount: eligibleGroups.length,
    });
    return;
  }

  const proposals = buildMatchProposals({
    profiles,
    unresolvedPairKeys,
    latestPairTimestampByPairKey,
  });

  if (proposals.length === 0) {
    logger.info("Group war matchmaker: no compatible proposals generated.", {
      scannedGroupCount: scannedGroups.length,
      baseEligibleGroupCount: baseEligibleGroups.length,
      eligibleGroupCount: eligibleGroups.length,
      profileCount: profiles.length,
    });
    return;
  }

  const batch = db.batch();
  const now = admin.firestore.FieldValue.serverTimestamp();

  proposals.forEach((proposal) => {
    const warRef = db.collection(GROUP_WARS_COLLECTION).doc();
    batch.set(warRef, {
      groupAId: proposal.challenger.groupId,
      groupBId: proposal.opponent.groupId,
      challengerGroupId: proposal.challenger.groupId,
      opponentGroupId: proposal.opponent.groupId,
      challengerOwnerUid: proposal.challenger.ownerUserId,
      opponentOwnerUid: proposal.opponent.ownerUserId,
      groupAAccepted: false,
      groupBAccepted: false,
      status: WAR_PROPOSAL_STATUS,
      challengerScoreTotal: 0,
      opponentScoreTotal: 0,
      leaderboardPointsAwarded: false,
      challengerMemberUserIdsAtStart: [],
      opponentMemberUserIdsAtStart: [],
      proposalSource: "auto_matchmaker",
      compatibilityScore: proposal.compatibilityScore,
      createdAt: now,
      updatedAt: now,
    });
  });

  await batch.commit();

  logger.info("Group war matchmaker: proposals created.", {
    scannedGroupCount: scannedGroups.length,
    baseEligibleGroupCount: baseEligibleGroups.length,
    eligibleGroupCount: eligibleGroups.length,
    profileCount: profiles.length,
    proposalCount: proposals.length,
    proposals: proposals.map((proposal) => ({
      challengerGroupId: proposal.challenger.groupId,
      opponentGroupId: proposal.opponent.groupId,
      compatibilityScore: proposal.compatibilityScore,
    })),
  });
});

async function loadRecentWarSnapshots(): Promise<WarSnapshot[]> {
  const warsSnap = await db.collection(GROUP_WARS_COLLECTION)
    .orderBy("createdAt", "desc")
    .limit(WAR_HISTORY_SCAN_LIMIT)
    .get();

  return warsSnap.docs.map((snap) => buildWarSnapshot(snap.data()));
}

function buildWarSnapshot(data: FirebaseFirestore.DocumentData): WarSnapshot {
  const createdAt = data["createdAt"];
  const createdAtMillis =
    createdAt instanceof admin.firestore.Timestamp ? createdAt.toMillis() : 0;

  return {
    challengerGroupId: normalizeString(data["challengerGroupId"] ?? data["groupAId"]),
    opponentGroupId: normalizeString(data["opponentGroupId"] ?? data["groupBId"]),
    status: normalizeString(data["status"]),
    createdAtMillis,
  };
}

function buildLatestPairTimestampMap(warSnapshots: WarSnapshot[]): Map<string, number> {
  const latestPairTimestampByPairKey = new Map<string, number>();

  warSnapshots.forEach((war) => {
    if (!war.challengerGroupId || !war.opponentGroupId) {
      return;
    }
    if (war.createdAtMillis <= 0) {
      return;
    }

    const pairKey = toPairKey(war.challengerGroupId, war.opponentGroupId);
    if (!latestPairTimestampByPairKey.has(pairKey)) {
      latestPairTimestampByPairKey.set(pairKey, war.createdAtMillis);
    }
  });

  return latestPairTimestampByPairKey;
}

function buildUnresolvedGroupSet(warSnapshots: WarSnapshot[]): Set<string> {
  const unresolvedGroups = new Set<string>();
  warSnapshots.forEach((war) => {
    if (!UNRESOLVED_WAR_STATUSES.has(war.status)) {
      return;
    }
    if (war.challengerGroupId) {
      unresolvedGroups.add(war.challengerGroupId);
    }
    if (war.opponentGroupId) {
      unresolvedGroups.add(war.opponentGroupId);
    }
  });
  return unresolvedGroups;
}

function buildUnresolvedPairSet(warSnapshots: WarSnapshot[]): Set<string> {
  const unresolvedPairs = new Set<string>();
  warSnapshots.forEach((war) => {
    if (!UNRESOLVED_WAR_STATUSES.has(war.status)) {
      return;
    }
    if (!war.challengerGroupId || !war.opponentGroupId) {
      return;
    }
    unresolvedPairs.add(toPairKey(war.challengerGroupId, war.opponentGroupId));
  });
  return unresolvedPairs;
}

async function loadUserScoreTotalsForGroups(
  groups: GroupCandidate[]
): Promise<Map<string, UserScoreTotals>> {
  const memberIds = new Set<string>();
  groups.forEach((group) => {
    group.userIds.forEach((userId) => memberIds.add(userId));
  });

  const memberIdList = Array.from(memberIds);
  if (memberIdList.length === 0) {
    return new Map<string, UserScoreTotals>();
  }

  const refs = memberIdList.map((userId) => db.doc(`${USER_STATS_COLLECTION}/${userId}`));
  const totalsByUserId = new Map<string, UserScoreTotals>();

  for (let index = 0; index < refs.length; index += USER_STATS_BATCH_READ_SIZE) {
    const batchRefs = refs.slice(index, index + USER_STATS_BATCH_READ_SIZE);
    const snaps = await db.getAll(...batchRefs);
    snaps.forEach((snap, snapIndex) => {
      const userId = memberIdList[index + snapIndex];
      const data = snap.exists ? snap.data() ?? {} : {};
      totalsByUserId.set(userId, readUserScoreTotals(data));
    });
  }

  return totalsByUserId;
}

function readUserScoreTotals(data: Record<string, unknown>): UserScoreTotals {
  const userScore = toRecord(data["userScore"]);
  const cardioMap = toNumberMap(userScore["cardioScore"]);
  const strengthMap = toNumberMap(userScore["strengthScore"]);

  const totalScore = toWholeNumber(
    userScore["totalScore"] ??
    data["totalScore"] ??
    resolveScoreMapTotal(cardioMap, "totalCardioScore") + resolveScoreMapTotal(strengthMap, "totalStrengthScore")
  );
  const totalStrengthScore = toWholeNumber(
    strengthMap["totalStrengthScore"] ??
    data["totalStrengthScore"] ??
    data["workScore"] ??
    resolveScoreMapTotal(strengthMap, "totalStrengthScore")
  );
  const totalCardioScore = toWholeNumber(
    cardioMap["totalCardioScore"] ??
    data["totalCardioScore"] ??
    resolveScoreMapTotal(cardioMap, "totalCardioScore")
  );

  return {
    totalScore,
    totalStrengthScore,
    totalCardioScore,
  };
}

function buildMatchProfile(
  group: GroupCandidate,
  userScoreTotalsByUserId: Map<string, UserScoreTotals>
): GroupMatchProfile {
  let totalScoreSum = 0;
  let totalStrengthSum = 0;
  let totalCardioSum = 0;
  let activeMemberCount = 0;

  group.userIds.forEach((userId) => {
    const totals = userScoreTotalsByUserId.get(userId) ?? {
      totalScore: 0,
      totalStrengthScore: 0,
      totalCardioScore: 0,
    };
    totalScoreSum += totals.totalScore;
    totalStrengthSum += totals.totalStrengthScore;
    totalCardioSum += totals.totalCardioScore;
    if (totals.totalScore > 0) {
      activeMemberCount += 1;
    }
  });

  const strengthShare = totalScoreSum > 0 ? clamp01(totalStrengthSum / totalScoreSum) : 0;
  const cardioShare = totalScoreSum > 0 ? clamp01(totalCardioSum / totalScoreSum) : 0;

  return {
    ...group,
    totalScoreSum,
    totalStrengthSum,
    totalCardioSum,
    activeMemberCount,
    strengthShare,
    cardioShare,
    effectiveWarWeight: group.warWeight > 0
      ? group.warWeight
      : computeWarWeight(totalScoreSum, totalStrengthSum, totalCardioSum),
  };
}

function buildMatchProposals(params: {
  profiles: GroupMatchProfile[];
  unresolvedPairKeys: Set<string>;
  latestPairTimestampByPairKey: Map<string, number>;
}): MatchProposal[] {
  const orderedProfiles = [...params.profiles].sort(
    (left, right) => right.effectiveWarWeight - left.effectiveWarWeight
  );
  const proposedPairs = new Set<string>();
  const matchedGroupIds = new Set<string>();
  const proposals: MatchProposal[] = [];

  for (let index = 0; index < orderedProfiles.length; index += 1) {
    const source = orderedProfiles[index];
    if (matchedGroupIds.has(source.groupId)) {
      continue;
    }

    let bestMatch: {candidate: GroupMatchProfile; score: number} | undefined;
    for (let innerIndex = index + 1; innerIndex < orderedProfiles.length; innerIndex += 1) {
      const candidate = orderedProfiles[innerIndex];
      if (matchedGroupIds.has(candidate.groupId)) {
        continue;
      }
      if (!isCompatibleMatch(source, candidate)) {
        continue;
      }

      const pairKey = toPairKey(source.groupId, candidate.groupId);
      if (params.unresolvedPairKeys.has(pairKey) || proposedPairs.has(pairKey)) {
        continue;
      }
      if (hasRecentOpponentConflict(pairKey, params.latestPairTimestampByPairKey)) {
        continue;
      }

      const score = calculateCompatibilityScore(source, candidate);
      if (!bestMatch || score < bestMatch.score) {
        bestMatch = {candidate, score};
      }
    }

    if (!bestMatch) {
      continue;
    }

    matchedGroupIds.add(source.groupId);
    matchedGroupIds.add(bestMatch.candidate.groupId);
    const pairKey = toPairKey(source.groupId, bestMatch.candidate.groupId);
    proposedPairs.add(pairKey);

    const [challenger, opponent] = [source, bestMatch.candidate].sort((left, right) =>
      left.groupId.localeCompare(right.groupId)
    );

    proposals.push({
      challenger,
      opponent,
      compatibilityScore: bestMatch.score,
    });
  }

  return proposals;
}

function hasRecentOpponentConflict(
  pairKey: string,
  latestPairTimestampByPairKey: Map<string, number>
): boolean {
  const lastMatchedAtMillis = latestPairTimestampByPairKey.get(pairKey);
  if (!lastMatchedAtMillis) {
    return false;
  }

  const cooldownMillis = REPEAT_OPPONENT_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;
  return Date.now() - lastMatchedAtMillis < cooldownMillis;
}

function isCompatibleMatch(left: GroupMatchProfile, right: GroupMatchProfile): boolean {
  if (!left.ownerUserId || !right.ownerUserId) {
    return false;
  }

  const warWeightGapRatio = toGapRatio(left.effectiveWarWeight, right.effectiveWarWeight);
  if (warWeightGapRatio > WAR_WEIGHT_GAP_RATIO_TOLERANCE) {
    return false;
  }

  const maxActiveMembers = Math.max(left.activeMemberCount, right.activeMemberCount);
  const activeMemberTolerance = Math.max(
    ACTIVE_MEMBER_GAP_MIN,
    Math.ceil(maxActiveMembers * ACTIVE_MEMBER_GAP_RATIO_TOLERANCE)
  );
  const activeMemberGap = Math.abs(left.activeMemberCount - right.activeMemberCount);
  if (activeMemberGap > activeMemberTolerance) {
    return false;
  }

  const biasGap = Math.max(
    Math.abs(left.strengthShare - right.strengthShare),
    Math.abs(left.cardioShare - right.cardioShare)
  );

  return biasGap <= BIAS_GAP_TOLERANCE;
}

function calculateCompatibilityScore(left: GroupMatchProfile, right: GroupMatchProfile): number {
  const warWeightGapRatio = toGapRatio(left.effectiveWarWeight, right.effectiveWarWeight);
  const activeMemberGapRatio = toGapRatio(left.activeMemberCount, right.activeMemberCount);
  const biasGap = Math.max(
    Math.abs(left.strengthShare - right.strengthShare),
    Math.abs(left.cardioShare - right.cardioShare)
  );

  return Number((warWeightGapRatio * 0.55 + activeMemberGapRatio * 0.2 + biasGap * 0.25).toFixed(6));
}

function buildGroupCandidate(groupId: string, data: FirebaseFirestore.DocumentData): GroupCandidate {
  return {
    groupId: normalizeString(groupId),
    ownerUserId: normalizeString(data["ownerUserId"]),
    userIds: normalizeStringArray(data["userIDs"]),
    warOptIn: data["warOptIn"] === true,
    warEnabled: data["warEnabled"] === true,
    warWeight: toNonNegativeNumber(data["warWeight"]),
    isPTGroup: data["isPTGroup"] === true,
    currentActiveWarId: normalizeString(data["currentActiveWarId"]),
  };
}

function isBaseEligible(group: GroupCandidate): boolean {
  if (!group.groupId) {
    return false;
  }
  if (!group.ownerUserId) {
    return false;
  }
  if (!group.warOptIn || !group.warEnabled) {
    return false;
  }
  if (group.isPTGroup) {
    return false;
  }
  if (group.currentActiveWarId) {
    return false;
  }
  return group.userIds.length > 0;
}

function computeWarWeight(totalScore: number, totalStrengthScore: number, totalCardioScore: number): number {
  const safeTotalScore = toWholeNumber(totalScore);
  if (safeTotalScore <= 0) {
    return 1;
  }
  const strengthShare = clamp01(totalStrengthScore / safeTotalScore);
  const cardioShare = clamp01(totalCardioScore / safeTotalScore);
  const normalizedStrength = safeTotalScore * strengthShare;
  const normalizedCardio = safeTotalScore * cardioShare;

  return Math.max(
    1,
    toWholeNumber(Math.sqrt(
      (safeTotalScore * safeTotalScore) +
      (normalizedStrength * normalizedStrength) +
      (normalizedCardio * normalizedCardio)
    ))
  );
}

function toPairKey(groupAId: string, groupBId: string): string {
  return [groupAId, groupBId].sort((left, right) => left.localeCompare(right)).join("::");
}

function toGapRatio(left: number, right: number): number {
  const numerator = Math.abs(left - right);
  const denominator = Math.max(1, left, right);
  return numerator / denominator;
}

function normalizeString(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => normalizeString(entry))
    .filter((entry) => entry.length > 0);
}

function toNonNegativeNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function toWholeNumber(value: unknown): number {
  return Math.round(toNonNegativeNumber(value));
}

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function toNumberMap(value: unknown): Record<string, number> {
  const source = toRecord(value);
  return Object.entries(source).reduce<Record<string, number>>((accumulator, [key, entryValue]) => {
    const parsed = Number(entryValue);
    if (!Number.isFinite(parsed) || parsed < 0) {
      return accumulator;
    }
    accumulator[key] = Math.round(parsed);
    return accumulator;
  }, {});
}

function resolveScoreMapTotal(scoreMap: Record<string, number>, totalKey: string): number {
  const explicitTotal = toNonNegativeNumber(scoreMap[totalKey]);
  if (explicitTotal > 0) {
    return Math.round(explicitTotal);
  }
  return Object.entries(scoreMap).reduce((sum, [key, value]) => {
    if (key === totalKey) {
      return sum;
    }
    return sum + toNonNegativeNumber(value);
  }, 0);
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  return value;
}
