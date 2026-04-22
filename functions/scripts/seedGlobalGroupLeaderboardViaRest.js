/**
 * Seeds fake global group leaderboard rows for the Wars tab.
 *
 * Usage:
 *   node scripts/seedGlobalGroupLeaderboardViaRest.js
 *
 * Optional environment overrides:
 *   FIREBASE_PROJECT_ID=<project-id>
 *   FIREBASE_DATABASE_ID=<database-id>
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'ai-fitness-f8ed4';
const DATABASE_ID = process.env.FIREBASE_DATABASE_ID || '(default)';
const API_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/${DATABASE_ID}/documents`;
const nowIso = new Date().toISOString();

const FAKE_GROUPS = [
  {
    groupId: 'gw_lb_atlas_legion',
    groupName: 'Atlas Legion',
    dominantExerciseTag: 'strength',
    totalWarLeaderboardPoints: 1740,
    warRating: 1282,
    warWeight: 81620,
    wins: 24,
    losses: 5,
    ties: 2,
    lastWarEndedAtIso: isoDaysAgo(2),
  },
  {
    groupId: 'gw_lb_cardio_collective',
    groupName: 'Cardio Collective',
    dominantExerciseTag: 'cardio',
    totalWarLeaderboardPoints: 1625,
    warRating: 1248,
    warWeight: 80310,
    wins: 22,
    losses: 6,
    ties: 1,
    lastWarEndedAtIso: isoDaysAgo(1),
  },
  {
    groupId: 'gw_lb_hoplite_union',
    groupName: 'Hoplite Union',
    dominantExerciseTag: 'hybrid_strength',
    totalWarLeaderboardPoints: 1510,
    warRating: 1214,
    warWeight: 78920,
    wins: 20,
    losses: 7,
    ties: 2,
    lastWarEndedAtIso: isoDaysAgo(3),
  },
  {
    groupId: 'gw_lb_olympus_pulse',
    groupName: 'Olympus Pulse',
    dominantExerciseTag: 'hybrid_cardio',
    totalWarLeaderboardPoints: 1440,
    warRating: 1190,
    warWeight: 78100,
    wins: 19,
    losses: 8,
    ties: 1,
    lastWarEndedAtIso: isoDaysAgo(4),
  },
  {
    groupId: 'gw_lb_spartan_engine',
    groupName: 'Spartan Engine',
    dominantExerciseTag: 'strength',
    totalWarLeaderboardPoints: 1365,
    warRating: 1168,
    warWeight: 76840,
    wins: 17,
    losses: 8,
    ties: 3,
    lastWarEndedAtIso: isoDaysAgo(2),
  },
  {
    groupId: 'gw_lb_marathon_zero',
    groupName: 'Marathon Zero',
    dominantExerciseTag: 'cardio',
    totalWarLeaderboardPoints: 1298,
    warRating: 1152,
    warWeight: 75630,
    wins: 16,
    losses: 9,
    ties: 2,
    lastWarEndedAtIso: isoDaysAgo(5),
  },
  {
    groupId: 'gw_lb_athena_protocol',
    groupName: 'Athena Protocol',
    dominantExerciseTag: 'hybrid_strength',
    totalWarLeaderboardPoints: 1212,
    warRating: 1125,
    warWeight: 74210,
    wins: 15,
    losses: 10,
    ties: 2,
    lastWarEndedAtIso: isoDaysAgo(7),
  },
  {
    groupId: 'gw_lb_titan_circuit',
    groupName: 'Titan Circuit',
    dominantExerciseTag: 'hybrid_cardio',
    totalWarLeaderboardPoints: 1136,
    warRating: 1098,
    warWeight: 73140,
    wins: 14,
    losses: 11,
    ties: 2,
    lastWarEndedAtIso: isoDaysAgo(6),
  },
  {
    groupId: 'gw_lb_iron_voyagers',
    groupName: 'Iron Voyagers',
    dominantExerciseTag: 'strength',
    totalWarLeaderboardPoints: 1064,
    warRating: 1076,
    warWeight: 71950,
    wins: 13,
    losses: 11,
    ties: 3,
    lastWarEndedAtIso: isoDaysAgo(8),
  },
  {
    groupId: 'gw_lb_peloton_prime',
    groupName: 'Peloton Prime',
    dominantExerciseTag: 'cardio',
    totalWarLeaderboardPoints: 990,
    warRating: 1042,
    warWeight: 70120,
    wins: 12,
    losses: 12,
    ties: 2,
    lastWarEndedAtIso: isoDaysAgo(9),
  },
  {
    groupId: 'gw_lb_aegean_reps',
    groupName: 'Aegean Reps',
    dominantExerciseTag: 'hybrid_strength',
    totalWarLeaderboardPoints: 915,
    warRating: 1018,
    warWeight: 68470,
    wins: 11,
    losses: 12,
    ties: 3,
    lastWarEndedAtIso: isoDaysAgo(10),
  },
  {
    groupId: 'gw_lb_neon_stride',
    groupName: 'Neon Stride',
    dominantExerciseTag: 'hybrid_cardio',
    totalWarLeaderboardPoints: 842,
    warRating: 998,
    warWeight: 67110,
    wins: 10,
    losses: 13,
    ties: 2,
    lastWarEndedAtIso: isoDaysAgo(11),
  },
];

async function main() {
  const accessToken = readFirebaseCliAccessToken();
  const rankedGroups = assignRanks(FAKE_GROUPS);

  for (const group of rankedGroups) {
    await patchDocument(accessToken, `groupID/${group.groupId}`, {
      name: group.groupName,
      isPTGroup: false,
      ownerUserId: `seed_owner_${group.groupId}`,
      groupImage: '',
      warOptIn: true,
      warEnabled: true,
      warRating: group.warRating,
      warWeight: group.warWeight,
      totalWarLeaderboardPoints: group.totalWarLeaderboardPoints,
      wins: group.wins,
      losses: group.losses,
      ties: group.ties,
      dominantExerciseTag: group.dominantExerciseTag,
      globalLeaderboardRank: group.rank,
      lastWarEndedAt: asTimestamp(group.lastWarEndedAtIso),
      updatedAt: asTimestamp(nowIso),
      created_at: asTimestamp(nowIso),
    });

    await patchDocument(accessToken, `groupLeaderboards/global/rankings/${group.groupId}`, {
      groupId: group.groupId,
      groupName: group.groupName,
      groupImage: '',
      rank: group.rank,
      globalLeaderboardRank: group.rank,
      totalWarLeaderboardPoints: group.totalWarLeaderboardPoints,
      warRating: group.warRating,
      warWeight: group.warWeight,
      wins: group.wins,
      losses: group.losses,
      ties: group.ties,
      dominantExerciseTag: group.dominantExerciseTag,
      lastWarEndedAt: asTimestamp(group.lastWarEndedAtIso),
      updatedAt: asTimestamp(nowIso),
      createdAt: asTimestamp(nowIso),
    });

    console.log(
      `#${group.rank} ${group.groupName} (${group.groupId}) -> ${group.totalWarLeaderboardPoints} pts`
    );
  }

  console.log(`\nSeeded ${rankedGroups.length} fake leaderboard rows for project ${PROJECT_ID}.`);
}

function isoDaysAgo(daysAgo) {
  return new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString();
}

function assignRanks(groups) {
  const sorted = [...groups].sort((left, right) => {
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

  return sorted.map((group, index) => ({ ...group, rank: index + 1 }));
}

function asTimestamp(isoString) {
  return { __timestampValue: isoString };
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
    const token = execSync(command, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
      .trim();
    return token;
  } catch {
    return '';
  }
}

async function patchDocument(accessToken, docPath, payload) {
  const updateKeys = Object.keys(payload);
  const params = new URLSearchParams();
  updateKeys.forEach((key) => params.append('updateMask.fieldPaths', key));

  const body = {
    fields: toFirestoreFields(payload),
  };

  const query = params.toString();
  const suffix = query ? `?${query}` : '';
  await firestoreRequest(accessToken, `/${docPath}${suffix}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
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
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });

  const text = await response.text();
  const body = text ? safeJsonParse(text) : null;

  if (!response.ok && !acceptedStatusCodes.includes(response.status)) {
    throw new Error(
      `Firestore request failed (${response.status}) ${init.method || 'GET'} ${pathAndQuery}\n${text}`
    );
  }

  return { status: response.status, body };
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
