/**
 * Seeds one fake finalized Group War recap for a specific user.
 *
 * Usage:
 *   node scripts/seedGroupWarRecapForUserViaRest.js <targetUid> [warId]
 *
 * Examples:
 *   node scripts/seedGroupWarRecapForUserViaRest.js SSuKPzr70mSqsKAQawiu7B0bEVK2
 *   node scripts/seedGroupWarRecapForUserViaRest.js SSuKPzr70mSqsKAQawiu7B0bEVK2 gw_seed_custom_recap
 *
 * Optional environment overrides:
 *   FIREBASE_PROJECT_ID=<project-id>
 *   FIREBASE_DATABASE_ID=<database-id>
 *   TARGET_GROUP_ID=<group-id>  // force challenger group
 *   FIREBASE_ACCESS_TOKEN=<oauth-access-token>
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'ai-fitness-f8ed4';
const DATABASE_ID = process.env.FIREBASE_DATABASE_ID || '(default)';
const API_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/${DATABASE_ID}/documents`;

const targetUid = String(process.argv[2] || '').trim();
const explicitWarId = String(process.argv[3] || '').trim();
const explicitGroupId = String(process.env.TARGET_GROUP_ID || '').trim();
const nowIso = new Date().toISOString();

async function main() {
  if (!targetUid) {
    throw new Error('Missing target uid. Usage: node scripts/seedGroupWarRecapForUserViaRest.js <targetUid> [warId]');
  }

  const accessToken = readFirebaseCliAccessToken();
  const userDoc = await getDocument(accessToken, `users/${targetUid}`);
  if (!userDoc) {
    throw new Error(`Target user doc not found: users/${targetUid}`);
  }

  const targetGroupIds = readStringArray(userDoc.fields?.groupID);
  const challengerGroupId =
    explicitGroupId ||
    targetGroupIds[0] ||
    `gw_seed_${targetUid.slice(0, 8).toLowerCase()}_home`;
  const opponentGroupId = `gw_seed_${targetUid.slice(0, 8).toLowerCase()}_rival`;
  const warId = explicitWarId || `gw_seed_recap_${targetUid.slice(0, 8).toLowerCase()}`;

  await ensureGroupMembership(accessToken, targetUid, challengerGroupId, targetGroupIds);

  const challengerGroupDoc = await getDocument(accessToken, `groupID/${challengerGroupId}`);
  const challengerGroupName = readString(challengerGroupDoc?.fields?.name) || 'Target User Group';
  const challengerOwnerUid = readString(challengerGroupDoc?.fields?.ownerUserId) || targetUid;
  const challengerUserIds = readStringArray(challengerGroupDoc?.fields?.userIDs);

  const opponentOwnerUid = `gw_seed_owner_${targetUid.slice(0, 8).toLowerCase()}`;
  const opponentUserIds = [
    opponentOwnerUid,
    `gw_seed_${targetUid.slice(0, 8).toLowerCase()}_r01`,
    `gw_seed_${targetUid.slice(0, 8).toLowerCase()}_r02`,
  ];
  await seedOpponentGroup(accessToken, {
    opponentGroupId,
    opponentOwnerUid,
    opponentUserIds,
  });

  const targetDisplayName = resolveDisplayName(userDoc.fields, targetUid);
  const opponentTopName = 'Rival Captain';

  const now = Date.now();
  const activatedAtIso = new Date(now - 8 * 24 * 60 * 60 * 1000).toISOString();
  const endsAtIso = new Date(now - 60 * 60 * 1000).toISOString();
  const finalizedAtIso = new Date(now - 20 * 60 * 1000).toISOString();

  const challengerScoreTotal = 18640;
  const opponentScoreTotal = 17310;
  const challengerCardio = 8120;
  const challengerStrength = 10520;
  const opponentCardio = 7430;
  const opponentStrength = 9880;
  const totalPoints = challengerScoreTotal + opponentScoreTotal;
  const overallCardio = challengerCardio + opponentCardio;
  const overallStrength = challengerStrength + opponentStrength;

  await patchDocument(accessToken, `groupWars/${warId}`, {
    groupAId: challengerGroupId,
    groupBId: opponentGroupId,
    challengerGroupId,
    opponentGroupId,
    challengerOwnerUid,
    opponentOwnerUid,
    groupAAccepted: true,
    groupBAccepted: true,
    acceptedAt: asTimestamp(activatedAtIso),
    startAt: asTimestamp(activatedAtIso),
    endAt: asTimestamp(endsAtIso),
    activatedAt: asTimestamp(activatedAtIso),
    endsAt: asTimestamp(endsAtIso),
    finalizedAt: asTimestamp(finalizedAtIso),
    status: 'finalized',
    result: 'challenger_win',
    challengerScoreTotal,
    opponentScoreTotal,
    groupAPoints: challengerScoreTotal,
    groupBPoints: opponentScoreTotal,
    groupACardioPoints: challengerCardio,
    groupAStrengthPoints: challengerStrength,
    groupBCardioPoints: opponentCardio,
    groupBStrengthPoints: opponentStrength,
    leaderboardPointsAwarded: true,
    challengerPointsAwarded: 30,
    opponentPointsAwarded: 15,
    challengerMemberUserIdsAtStart: challengerUserIds.length > 0 ? challengerUserIds : [targetUid],
    opponentMemberUserIdsAtStart: opponentUserIds,
    createdAt: asTimestamp(activatedAtIso),
    updatedAt: asTimestamp(nowIso),
  });

  await patchDocument(accessToken, `groupWars/${warId}/recap/summary`, {
    warId,
    status: 'finalized',
    result: 'challenger_win',
    challengerGroupId,
    challengerGroupName,
    opponentGroupId,
    opponentGroupName: 'Seeded Rival Group',
    activatedAt: asTimestamp(activatedAtIso),
    endsAt: asTimestamp(endsAtIso),
    finalizedAt: asTimestamp(finalizedAtIso),
    challengerScoreTotal,
    opponentScoreTotal,
    challengerPointsAwarded: 30,
    opponentPointsAwarded: 15,
    winnerGroupId: challengerGroupId,
    challengerTopMembers: [
      {
        warId,
        groupId: challengerGroupId,
        userId: targetUid,
        displayName: targetDisplayName,
        normalizedWorkoutScoreTotal: 6420,
        workoutCount: 6,
        rank: 1,
        totalContribution: 6420,
        cardioContributionTotal: 2880,
        strengthContributionTotal: 3540,
        topExerciseTag: 'hybrid_strength',
      },
      {
        warId,
        groupId: challengerGroupId,
        userId: `gw_seed_${targetUid.slice(0, 8).toLowerCase()}_ally`,
        displayName: 'Seeded Ally',
        normalizedWorkoutScoreTotal: 4210,
        workoutCount: 5,
        rank: 2,
        totalContribution: 4210,
        cardioContributionTotal: 1880,
        strengthContributionTotal: 2330,
        topExerciseTag: 'strength',
      },
    ],
    opponentTopMembers: [
      {
        warId,
        groupId: opponentGroupId,
        userId: opponentOwnerUid,
        displayName: opponentTopName,
        normalizedWorkoutScoreTotal: 6110,
        workoutCount: 7,
        rank: 1,
        totalContribution: 6110,
        cardioContributionTotal: 2860,
        strengthContributionTotal: 3250,
        topExerciseTag: 'cardio',
      },
    ],
    winner: {
      type: 'group',
      groupId: challengerGroupId,
      groupName: challengerGroupName,
    },
    finalScore: {
      challenger: challengerScoreTotal,
      opponent: opponentScoreTotal,
      margin: challengerScoreTotal - opponentScoreTotal,
    },
    topContributorByTeam: {
      challenger: {
        userId: targetUid,
        groupId: challengerGroupId,
        displayName: targetDisplayName,
        normalizedWorkoutScoreTotal: 6420,
        workoutCount: 6,
        topExerciseTag: 'hybrid_strength',
      },
      opponent: {
        userId: opponentOwnerUid,
        groupId: opponentGroupId,
        displayName: opponentTopName,
        normalizedWorkoutScoreTotal: 6110,
        workoutCount: 7,
        topExerciseTag: 'cardio',
      },
    },
    mostUsedExerciseByTeam: {
      challenger: {
        exerciseTag: 'hybrid_strength',
        normalizedWorkoutScoreTotal: 9480,
      },
      opponent: {
        exerciseTag: 'cardio',
        normalizedWorkoutScoreTotal: 9040,
      },
    },
    totalWorkoutsSubmitted: {
      total: 24,
      challenger: 13,
      opponent: 11,
    },
    cardioVsStrengthShare: {
      challenger: {
        cardioPoints: challengerCardio,
        strengthPoints: challengerStrength,
        cardioShare: safeShare(challengerCardio, challengerScoreTotal),
        strengthShare: safeShare(challengerStrength, challengerScoreTotal),
      },
      opponent: {
        cardioPoints: opponentCardio,
        strengthPoints: opponentStrength,
        cardioShare: safeShare(opponentCardio, opponentScoreTotal),
        strengthShare: safeShare(opponentStrength, opponentScoreTotal),
      },
      overall: {
        cardioPoints: overallCardio,
        strengthPoints: overallStrength,
        cardioShare: safeShare(overallCardio, totalPoints),
        strengthShare: safeShare(overallStrength, totalPoints),
      },
    },
    standoutSingleWorkoutContribution: {
      contributionId: `${warId}_standout_01`,
      workoutEventId: `${warId}_workout_01`,
      userId: targetUid,
      groupId: challengerGroupId,
      displayName: targetDisplayName,
      normalizedWorkoutScoreTotal: 1380,
      cardioContribution: 520,
      strengthContribution: 860,
      topExerciseTag: 'strength',
      contributedAt: asTimestamp(new Date(now - 3 * 24 * 60 * 60 * 1000).toISOString()),
    },
    updatedAt: asTimestamp(nowIso),
  });

  console.log('Seed complete.');
  console.log(`Project: ${PROJECT_ID}`);
  console.log(`User: ${targetUid}`);
  console.log(`Challenger group: ${challengerGroupId} (${challengerGroupName})`);
  console.log(`War ID: ${warId}`);
  console.log(`Recap route: /group-wars/recap/${warId}`);
}

async function ensureGroupMembership(accessToken, uid, groupId, existingUserGroupIds) {
  const nextGroupIds = Array.from(new Set([...(existingUserGroupIds || []), groupId]));
  await patchDocument(accessToken, `users/${uid}`, {
    groupID: nextGroupIds,
    updatedAt: asTimestamp(nowIso),
  });

  const existingGroupDoc = await getDocument(accessToken, `groupID/${groupId}`);
  const existingOwnerUid = readString(existingGroupDoc?.fields?.ownerUserId);
  const existingName = readString(existingGroupDoc?.fields?.name);
  const existingUserIds = readStringArray(existingGroupDoc?.fields?.userIDs);
  const mergedUserIds = Array.from(new Set([...existingUserIds, uid]));

  await patchDocument(accessToken, `groupID/${groupId}`, {
    name: existingName || 'Seeded User Group',
    isPTGroup: existingGroupDoc ? readBoolean(existingGroupDoc.fields?.isPTGroup, false) : false,
    ownerUserId: existingOwnerUid || uid,
    groupImage: readString(existingGroupDoc?.fields?.groupImage),
    userIDs: mergedUserIds,
    warOptIn: true,
    warEnabled: true,
    warRating: readNumber(existingGroupDoc?.fields?.warRating, 1035),
    warWeight: readNumber(existingGroupDoc?.fields?.warWeight, 68900),
    totalWarLeaderboardPoints: readNumber(existingGroupDoc?.fields?.totalWarLeaderboardPoints, 220),
    wins: readNumber(existingGroupDoc?.fields?.wins, 3),
    losses: readNumber(existingGroupDoc?.fields?.losses, 2),
    ties: readNumber(existingGroupDoc?.fields?.ties, 1),
    updatedAt: asTimestamp(nowIso),
    created_at: existingGroupDoc ? asTimestamp(nowIso) : asTimestamp(nowIso),
  });
}

async function seedOpponentGroup(accessToken, config) {
  const { opponentGroupId, opponentOwnerUid, opponentUserIds } = config;

  await patchDocument(accessToken, `users/${opponentOwnerUid}`, {
    firstName: 'Rival',
    lastName: 'Owner',
    username: `seed_${opponentOwnerUid.slice(-6)}`,
    isPT: false,
    groupID: [opponentGroupId],
    updatedAt: asTimestamp(nowIso),
    created_at: asTimestamp(nowIso),
  });

  await patchDocument(accessToken, `groupID/${opponentGroupId}`, {
    name: 'Seeded Rival Group',
    isPTGroup: false,
    ownerUserId: opponentOwnerUid,
    groupImage: '',
    userIDs: opponentUserIds,
    warOptIn: true,
    warEnabled: true,
    warRating: 1012,
    warWeight: 68110,
    totalWarLeaderboardPoints: 205,
    wins: 2,
    losses: 3,
    ties: 1,
    dominantExerciseTag: 'cardio',
    updatedAt: asTimestamp(nowIso),
    created_at: asTimestamp(nowIso),
  });
}

function resolveDisplayName(userFields, fallbackUid) {
  const username = readString(userFields?.username);
  const firstName = readString(userFields?.firstName);
  const lastName = readString(userFields?.lastName);
  const fullName = `${firstName} ${lastName}`.trim();
  if (fullName) {
    return fullName;
  }
  if (username) {
    return `@${username}`;
  }
  return `User ${String(fallbackUid || '').slice(0, 8)}`;
}

function safeShare(part, total) {
  const numerator = Number(part);
  const denominator = Number(total);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) {
    return 0;
  }
  return numerator / denominator;
}

function asTimestamp(isoString) {
  return { __timestampValue: isoString };
}

function readString(fieldValue) {
  if (!fieldValue) {
    return '';
  }
  if (typeof fieldValue === 'string') {
    return fieldValue.trim();
  }
  if (typeof fieldValue.stringValue === 'string') {
    return fieldValue.stringValue.trim();
  }
  return '';
}

function readBoolean(fieldValue, fallback) {
  if (!fieldValue) {
    return fallback;
  }
  if (typeof fieldValue === 'boolean') {
    return fieldValue;
  }
  if (typeof fieldValue.booleanValue === 'boolean') {
    return fieldValue.booleanValue;
  }
  return fallback;
}

function readNumber(fieldValue, fallback) {
  if (!fieldValue) {
    return fallback;
  }
  if (typeof fieldValue === 'number' && Number.isFinite(fieldValue)) {
    return fieldValue;
  }
  if (typeof fieldValue.integerValue === 'string') {
    const parsedInt = Number(fieldValue.integerValue);
    return Number.isFinite(parsedInt) ? parsedInt : fallback;
  }
  if (typeof fieldValue.doubleValue === 'number') {
    return Number.isFinite(fieldValue.doubleValue) ? fieldValue.doubleValue : fallback;
  }
  return fallback;
}

function readStringArray(fieldValue) {
  const values = fieldValue?.arrayValue?.values;
  if (!Array.isArray(values)) {
    return [];
  }
  return values
    .map((entry) => readString(entry))
    .filter((value) => value.length > 0);
}

function readFirebaseCliAccessToken() {
  const explicitToken = String(process.env.FIREBASE_ACCESS_TOKEN || '').trim();
  if (explicitToken) {
    return explicitToken;
  }

  const gcloudToken = readAccessTokenFromCommand('gcloud auth print-access-token');
  if (gcloudToken) {
    return gcloudToken;
  }

  const configPath = path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json');
  if (!fs.existsSync(configPath)) {
    throw new Error('firebase-tools login cache not found. Run `firebase login` first.');
  }

  const raw = fs.readFileSync(configPath, 'utf8');
  const parsed = JSON.parse(raw);
  const token = parsed?.tokens?.access_token;
  const expiresAt = Number(parsed?.tokens?.expires_at ?? 0);

  if (!token) {
    throw new Error('No access token found in firebase-tools cache. Run `firebase login --reauth`.');
  }

  const msRemaining = expiresAt - Date.now();
  if (Number.isFinite(expiresAt) && msRemaining < 60_000) {
    console.warn('Cached Firebase CLI token appears expired/almost expired. Attempting request anyway.');
  }

  return token;
}

function readAccessTokenFromCommand(command) {
  try {
    return execSync(command, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return '';
  }
}

async function getDocument(accessToken, docPath) {
  const response = await firestoreRequest(accessToken, `/${docPath}`, { method: 'GET' }, [404]);
  if (response.status === 404) {
    return null;
  }
  return response.body;
}

async function patchDocument(accessToken, docPath, payload) {
  const updateKeys = Object.keys(payload);
  const params = new URLSearchParams();
  updateKeys.forEach((key) => params.append('updateMask.fieldPaths', key));
  const query = params.toString();
  const suffix = query ? `?${query}` : '';

  await firestoreRequest(accessToken, `/${docPath}${suffix}`, {
    method: 'PATCH',
    body: JSON.stringify({ fields: toFirestoreFields(payload) }),
  });
}

function toFirestoreFields(objectValue) {
  const fields = {};
  Object.entries(objectValue).forEach(([key, value]) => {
    fields[key] = toFirestoreValue(value);
  });
  return fields;
}

function toFirestoreValue(value) {
  if (value && typeof value === 'object' && '__timestampValue' in value) {
    return { timestampValue: value.__timestampValue };
  }

  if (value === null || value === undefined) {
    return { nullValue: null };
  }

  if (typeof value === 'string') {
    return { stringValue: value };
  }

  if (typeof value === 'boolean') {
    return { booleanValue: value };
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      return { nullValue: null };
    }
    if (Number.isInteger(value)) {
      return { integerValue: String(value) };
    }
    return { doubleValue: value };
  }

  if (Array.isArray(value)) {
    return {
      arrayValue: {
        values: value.map((entry) => toFirestoreValue(entry)),
      },
    };
  }

  if (typeof value === 'object') {
    return {
      mapValue: {
        fields: toFirestoreFields(value),
      },
    };
  }

  return { nullValue: null };
}

async function firestoreRequest(accessToken, pathAndQuery, init, acceptedStatusCodes = []) {
  const response = await fetch(`${API_BASE}${pathAndQuery}`, {
    method: init.method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: init.body,
  });

  const bodyText = await response.text();
  let parsedBody = null;
  try {
    parsedBody = bodyText ? JSON.parse(bodyText) : null;
  } catch {
    parsedBody = bodyText;
  }

  if (!response.ok && !acceptedStatusCodes.includes(response.status)) {
    throw new Error(
      `Firestore request failed (${response.status}) ${init.method} ${pathAndQuery}: ${JSON.stringify(parsedBody)}`
    );
  }

  return {
    status: response.status,
    body: parsedBody,
  };
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
