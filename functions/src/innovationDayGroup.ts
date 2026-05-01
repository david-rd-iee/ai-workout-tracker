import * as admin from "firebase-admin";
import { HttpsError, onCall } from "firebase-functions/v2/https";

if (admin.apps.length === 0) {
  admin.initializeApp();
}

const db = admin.firestore();
const GROUP_ID = "innovation-day";
const GROUP_NAME = "Innovation day";

export const ensureInnovationDayGroupMembership = onCall(async (request) => {
  const userId = String(request.auth?.uid ?? "").trim();
  if (!userId) {
    throw new HttpsError("unauthenticated", "User must be signed in to join the demo group.");
  }

  const requestData = request.data && typeof request.data === "object"
    ? request.data as Record<string, unknown>
    : {};
  const requestedDisplayName = normalizeString(requestData["displayName"]);

  const [userSnap, clientSnap, groupSnap] = await Promise.all([
    db.doc(`users/${userId}`).get(),
    db.doc(`clients/${userId}`).get(),
    db.doc(`groupID/${GROUP_ID}`).get(),
  ]);

  const isDemoUser =
    userSnap.get("demoMode") === true ||
    clientSnap.get("demoMode") === true;
  if (!isDemoUser) {
    throw new HttpsError("permission-denied", "Only demo users can join the event group.");
  }

  const displayName =
    requestedDisplayName ||
    normalizeString(userSnap.get("displayName")) ||
    normalizeString(userSnap.get("firstName")) ||
    normalizeString(clientSnap.get("displayName")) ||
    normalizeString(clientSnap.get("firstName")) ||
    "Demo Athlete";

  if (!groupSnap.exists) {
    await db.doc(`groupID/${GROUP_ID}`).set(
      {
        groupId: GROUP_ID,
        name: GROUP_NAME,
        groupType: "FRIENDS",
        demoMode: true,
        eventGroup: true,
        isPTGroup: false,
        ownerUserId: userId,
        groupImage: "",
        created_at: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        userIDs: [userId],
        warOptIn: false,
        warEnabled: false,
        warRating: 1000,
        warWeight: 1,
        totalWarLeaderboardPoints: 0,
        wins: 0,
        losses: 0,
        ties: 0,
      },
      { merge: true }
    );
  } else {
    await db.doc(`groupID/${GROUP_ID}`).set(
      {
        userIDs: admin.firestore.FieldValue.arrayUnion(userId),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  }

  await Promise.all([
    db.doc(`users/${userId}`).set(
      {
        groupID: admin.firestore.FieldValue.arrayUnion(GROUP_ID),
        groupId: GROUP_ID,
        groupName: GROUP_NAME,
        groups: admin.firestore.FieldValue.arrayUnion(GROUP_ID),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    ),
    db.doc(`clients/${userId}`).set(
      {
        groupID: admin.firestore.FieldValue.arrayUnion(GROUP_ID),
        groupId: GROUP_ID,
        groupName: GROUP_NAME,
        groups: admin.firestore.FieldValue.arrayUnion(GROUP_ID),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    ),
    db.doc(`groupID/${GROUP_ID}/members/${userId}`).set(
      {
        userId,
        uid: userId,
        displayName,
        role: "member",
        demoMode: true,
        joinedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    ),
  ]);

  return {
    groupId: GROUP_ID,
    groupName: GROUP_NAME,
  };
});

function normalizeString(value: unknown): string {
  return String(value ?? "").trim();
}
