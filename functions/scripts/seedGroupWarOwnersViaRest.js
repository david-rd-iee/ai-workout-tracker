/**
 * One-time Firestore seed using Firebase CLI cached access token.
 *
 * Creates:
 * - groupID/gw_seed_t2rj0 (owner: t2rj0CMWBmRN1EoIvTN1KICc8RJ2)
 * - groupID/gw_seed_pkepd7 (owner: pKEPd7aBbxVCsSiH8IY4E0sUyYp2)
 *
 * Adds fake members and userStats with similar matchmaking profiles.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const PROJECT_ID = 'ai-fitness-f8ed4';
const DATABASE_ID = '(default)';
const API_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/${DATABASE_ID}/documents`;

const OWNER_A_UID = 't2rj0CMWBmRN1EoIvTN1KICc8RJ2';
const OWNER_B_UID = 'pKEPd7aBbxVCsSiH8IY4E0sUyYp2';
const GROUP_A_ID = 'gw_seed_t2rj0';
const GROUP_B_ID = 'gw_seed_pkepd7';

const nowIso = new Date().toISOString();

async function main() {
  const accessToken = readFirebaseCliAccessToken();

  const groups = [
    {
      groupId: GROUP_A_ID,
      ownerUid: OWNER_A_UID,
      name: 'Aegean Iron Legion',
      dominantExerciseTag: 'hybrid_strength',
      warWeight: 73520,
      fakeMembers: buildFakeMembers('t2rj0', [
        { firstName: 'Niko', lastName: 'Vale', total: 10000, strength: 5200, cardio: 4800 },
        { firstName: 'Dara', lastName: 'Quinn', total: 9000, strength: 4500, cardio: 4500 },
        { firstName: 'Iris', lastName: 'Kellan', total: 11000, strength: 6200, cardio: 4800 },
        { firstName: 'Marek', lastName: 'Stone', total: 8000, strength: 3900, cardio: 4100 },
        { firstName: 'Leona', lastName: 'Pryce', total: 10000, strength: 5600, cardio: 4400 },
      ]),
    },
    {
      groupId: GROUP_B_ID,
      ownerUid: OWNER_B_UID,
      name: 'Olympus Pulse Syndicate',
      dominantExerciseTag: 'hybrid_cardio',
      warWeight: 73490,
      fakeMembers: buildFakeMembers('pkepd7', [
        { firstName: 'Rhea', lastName: 'Morrow', total: 9800, strength: 5000, cardio: 4800 },
        { firstName: 'Soren', lastName: 'Kade', total: 9200, strength: 4700, cardio: 4500 },
        { firstName: 'Juno', lastName: 'Cross', total: 10800, strength: 5700, cardio: 5100 },
        { firstName: 'Theo', lastName: 'Drake', total: 8400, strength: 4300, cardio: 4100 },
        { firstName: 'Mina', lastName: 'Reyes', total: 10000, strength: 5200, cardio: 4800 },
      ]),
    },
  ];

  for (const group of groups) {
    await ensureOwnerExists(accessToken, group.ownerUid);
    await seedOwnerMembership(accessToken, group.ownerUid, group.groupId);

    const memberIds = [group.ownerUid, ...group.fakeMembers.map((member) => member.userId)];

    await patchDocument(accessToken, `groupID/${group.groupId}`, {
      name: group.name,
      isPTGroup: false,
      ownerUserId: group.ownerUid,
      groupImage: '',
      created_at: asTimestamp(nowIso),
      updatedAt: asTimestamp(nowIso),
      userIDs: memberIds,
      warOptIn: true,
      warEnabled: true,
      warRating: 1000,
      warWeight: group.warWeight,
      totalWarLeaderboardPoints: 0,
      wins: 0,
      losses: 0,
      ties: 0,
      dominantExerciseTag: group.dominantExerciseTag,
    });

    for (const member of group.fakeMembers) {
      await patchDocument(accessToken, `users/${member.userId}`, {
        firstName: member.firstName,
        lastName: member.lastName,
        username: member.username,
        isPT: false,
        groupID: [group.groupId],
        created_at: asTimestamp(nowIso),
        updatedAt: asTimestamp(nowIso),
      });

      await patchDocument(accessToken, `userStats/${member.userId}`, {
        totalScore: member.total,
        totalStrengthScore: member.strength,
        totalCardioScore: member.cardio,
        userScore: {
          totalScore: member.total,
          cardioScore: {
            totalCardioScore: member.cardio,
          },
          strengthScore: {
            totalStrengthScore: member.strength,
          },
        },
        updatedAt: asTimestamp(nowIso),
      });
    }

    const totals = group.fakeMembers.reduce((acc, member) => {
      acc.total += member.total;
      acc.strength += member.strength;
      acc.cardio += member.cardio;
      return acc;
    }, { total: 0, strength: 0, cardio: 0 });

    console.log(`Seeded ${group.groupId}`);
    console.log(`  owner: ${group.ownerUid}`);
    console.log(`  members: ${memberIds.length}`);
    console.log(`  warWeight: ${group.warWeight}`);
    console.log(`  fake-member totals: total=${totals.total}, strength=${totals.strength}, cardio=${totals.cardio}`);
  }

  console.log('\nDone seeding groups for matchmaking test.');
}

function asTimestamp(isoString) {
  return { __timestampValue: isoString };
}

function buildFakeMembers(prefix, specs) {
  return specs.map((spec, index) => {
    const i = index + 1;
    return {
      userId: `gwseed_${prefix}_p${String(i).padStart(2, '0')}`,
      firstName: spec.firstName,
      lastName: spec.lastName,
      username: `${spec.firstName.toLowerCase()}_${prefix}_${i}`,
      total: spec.total,
      strength: spec.strength,
      cardio: spec.cardio,
    };
  });
}

function readFirebaseCliAccessToken() {
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
    throw new Error('Cached Firebase CLI token is expired/almost expired. Run `firebase login --reauth`.');
  }

  return token;
}

async function ensureOwnerExists(accessToken, ownerUid) {
  const doc = await getDocument(accessToken, `users/${ownerUid}`);
  if (!doc) {
    throw new Error(`Owner user doc not found: users/${ownerUid}`);
  }
}

async function seedOwnerMembership(accessToken, ownerUid, groupId) {
  const existing = await getDocument(accessToken, `users/${ownerUid}`);
  const existingGroupIds = readStringArray(existing?.fields?.groupID);
  const merged = Array.from(new Set([...existingGroupIds, groupId]));

  await patchDocument(accessToken, `users/${ownerUid}`, {
    groupID: merged,
    updatedAt: asTimestamp(nowIso),
  });
}

function readStringArray(fieldValue) {
  const values = fieldValue?.arrayValue?.values;
  if (!Array.isArray(values)) {
    return [];
  }

  return values
    .map((entry) => entry?.stringValue)
    .filter((value) => typeof value === 'string' && value.trim().length > 0)
    .map((value) => value.trim());
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
