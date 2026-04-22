import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import { onDocumentUpdated } from "firebase-functions/v2/firestore";

if (admin.apps.length === 0) {
  admin.initializeApp();
}

const db = admin.firestore();

const GROUP_WARS_PATH = "groupWars/{warId}";
const GROUPS_COLLECTION = "groupID";
const WAR_DURATION_MS = 7 * 24 * 60 * 60 * 1000;
const PENDING_WAR_STATUSES = new Set<string>([
  "pending_confirmation",
  "pending_acceptance",
]);

export const onGroupWarProposalUpdated = onDocumentUpdated(
  GROUP_WARS_PATH,
  async (event) => {
    const warId = normalizeString(event.params.warId);
    const afterData = event.data?.after.data() ?? {};
    if (!warId) {
      return;
    }

    const status = normalizeString(afterData["status"]);
    if (!PENDING_WAR_STATUSES.has(status)) {
      return;
    }

    const declinedBy = normalizeString(afterData["declinedBy"]);
    if (declinedBy) {
      await cancelPendingWarProposal(warId, "declined_by_owner");
      return;
    }

    const groupAAccepted = readGroupAAccepted(afterData);
    const groupBAccepted = readGroupBAccepted(afterData);
    if (!groupAAccepted || !groupBAccepted) {
      return;
    }

    await activatePendingWarProposal(warId);
  }
);

async function cancelPendingWarProposal(warId: string, reason: string): Promise<void> {
  const warRef = db.doc(`groupWars/${warId}`);
  await db.runTransaction(async (transaction) => {
    const warSnap = await transaction.get(warRef);
    if (!warSnap.exists) {
      return;
    }

    const warData = warSnap.data() ?? {};
    const status = normalizeString(warData["status"]);
    if (!PENDING_WAR_STATUSES.has(status)) {
      return;
    }

    transaction.set(
      warRef,
      {
        status: "cancelled",
        cancelledAt: admin.firestore.FieldValue.serverTimestamp(),
        cancelledReason: reason,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      {merge: true}
    );
  });
}

async function activatePendingWarProposal(warId: string): Promise<void> {
  const warRef = db.doc(`groupWars/${warId}`);
  await db.runTransaction(async (transaction) => {
    const warSnap = await transaction.get(warRef);
    if (!warSnap.exists) {
      return;
    }

    const warData = warSnap.data() ?? {};
    const status = normalizeString(warData["status"]);
    if (!PENDING_WAR_STATUSES.has(status)) {
      return;
    }

    const declinedBy = normalizeString(warData["declinedBy"]);
    if (declinedBy) {
      transaction.set(
        warRef,
        {
          status: "cancelled",
          cancelledAt: admin.firestore.FieldValue.serverTimestamp(),
          cancelledReason: "declined_by_owner",
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        {merge: true}
      );
      return;
    }

    const groupAAccepted = readGroupAAccepted(warData);
    const groupBAccepted = readGroupBAccepted(warData);
    if (!groupAAccepted || !groupBAccepted) {
      return;
    }

    const groupAId = resolveGroupAId(warData);
    const groupBId = resolveGroupBId(warData);
    if (!groupAId || !groupBId || groupAId === groupBId) {
      transaction.set(
        warRef,
        {
          status: "cancelled",
          cancelledAt: admin.firestore.FieldValue.serverTimestamp(),
          cancelledReason: "invalid_groups",
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        {merge: true}
      );
      return;
    }

    const groupARef = db.doc(`${GROUPS_COLLECTION}/${groupAId}`);
    const groupBRef = db.doc(`${GROUPS_COLLECTION}/${groupBId}`);
    const [groupASnap, groupBSnap] = await Promise.all([
      transaction.get(groupARef),
      transaction.get(groupBRef),
    ]);
    if (!groupASnap.exists || !groupBSnap.exists) {
      transaction.set(
        warRef,
        {
          status: "cancelled",
          cancelledAt: admin.firestore.FieldValue.serverTimestamp(),
          cancelledReason: "missing_group",
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        {merge: true}
      );
      return;
    }

    const groupAData = groupASnap.data() ?? {};
    const groupBData = groupBSnap.data() ?? {};
    const groupAActiveWarId = normalizeString(groupAData["currentActiveWarId"]);
    const groupBActiveWarId = normalizeString(groupBData["currentActiveWarId"]);
    const groupAHasDifferentActiveWar = groupAActiveWarId && groupAActiveWarId !== warId;
    const groupBHasDifferentActiveWar = groupBActiveWarId && groupBActiveWarId !== warId;
    if (groupAHasDifferentActiveWar || groupBHasDifferentActiveWar) {
      transaction.set(
        warRef,
        {
          status: "cancelled",
          cancelledAt: admin.firestore.FieldValue.serverTimestamp(),
          cancelledReason: "group_already_in_active_war",
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        {merge: true}
      );
      return;
    }

    const nowMillis = Date.now();
    const startAt = admin.firestore.Timestamp.fromMillis(nowMillis);
    const endAt = admin.firestore.Timestamp.fromMillis(nowMillis + WAR_DURATION_MS);
    const challengerGroupId = normalizeString(warData["challengerGroupId"]) || groupAId;
    const opponentGroupId = normalizeString(warData["opponentGroupId"]) || groupBId;
    const challengerMemberUserIdsAtStart = normalizeStringArray(groupAData["userIDs"]);
    const opponentMemberUserIdsAtStart = normalizeStringArray(groupBData["userIDs"]);

    transaction.set(
      warRef,
      {
        groupAId,
        groupBId,
        challengerGroupId,
        opponentGroupId,
        groupAAccepted: true,
        groupBAccepted: true,
        acceptedAt: startAt,
        startAt,
        endAt,
        status: "active",
        activatedAt: startAt,
        endsAt: endAt,
        challengerAcceptedAt: startAt,
        opponentAcceptedAt: startAt,
        challengerMemberUserIdsAtStart,
        opponentMemberUserIdsAtStart,
        declinedBy: admin.firestore.FieldValue.delete(),
        declinedAt: admin.firestore.FieldValue.delete(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      {merge: true}
    );
    transaction.set(
      groupARef,
      {
        currentActiveWarId: warId,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      {merge: true}
    );
    transaction.set(
      groupBRef,
      {
        currentActiveWarId: warId,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      {merge: true}
    );
  });

  logger.info("Group war proposal activated.", {
    warId,
  });
}

function resolveGroupAId(warData: Record<string, unknown>): string {
  return normalizeString(warData["groupAId"] ?? warData["challengerGroupId"]);
}

function resolveGroupBId(warData: Record<string, unknown>): string {
  return normalizeString(warData["groupBId"] ?? warData["opponentGroupId"]);
}

function readGroupAAccepted(warData: Record<string, unknown>): boolean {
  return warData["groupAAccepted"] === true || isFirestoreTimestamp(warData["challengerAcceptedAt"]);
}

function readGroupBAccepted(warData: Record<string, unknown>): boolean {
  return warData["groupBAccepted"] === true || isFirestoreTimestamp(warData["opponentAcceptedAt"]);
}

function isFirestoreTimestamp(value: unknown): boolean {
  return value instanceof admin.firestore.Timestamp;
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
