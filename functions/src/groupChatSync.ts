import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";

if (admin.apps.length === 0) {
  admin.initializeApp();
}

const db = admin.firestore();
const rtdb = admin.database();

const GROUP_COLLECTION = "groupID";
const CHATS_ROOT = "chats";
const USER_CHATS_ROOT = "userChats";

interface GroupChatSyncRecord {
  groupId: string;
  name: string;
  userIds: string[];
  ownerUserId: string;
  isPTGroup: boolean;
  groupImage: string;
}

interface UpsertResult {
  chatId: string;
  created: boolean;
}

export const onGroupDocumentWrittenSyncChat = onDocumentWritten(
  `${GROUP_COLLECTION}/{groupId}`,
  async (event) => {
    const groupId = normalizeString(event.params.groupId);
    if (!groupId) {
      return;
    }

    const afterSnapshot = event.data?.after;
    if (!afterSnapshot?.exists) {
      return;
    }

    const groupRecord = buildGroupChatSyncRecord(groupId, afterSnapshot.data());
    if (!groupRecord || groupRecord.isPTGroup || groupRecord.userIds.length === 0) {
      return;
    }

    const upsertResult = await upsertGroupChatFromRecord(groupRecord);
    if (!upsertResult) {
      return;
    }

    logger.info("[GroupChatSync] Synced group chat from group document write.", {
      groupId,
      chatId: upsertResult.chatId,
      created: upsertResult.created,
      participantCount: groupRecord.userIds.length,
    });
  }
);

export const ensureGroupChatForGroup = onCall(async (request) => {
  const callerUid = normalizeString(request.auth?.uid);
  if (!callerUid) {
    throw new HttpsError("unauthenticated", "Authentication is required.");
  }

  const groupId = normalizeString((request.data as Record<string, unknown> | undefined)?.["groupId"]);
  if (!groupId) {
    throw new HttpsError("invalid-argument", "groupId is required.");
  }

  const groupSnapshot = await db.collection(GROUP_COLLECTION).doc(groupId).get();
  if (!groupSnapshot.exists) {
    throw new HttpsError("not-found", "Group not found.");
  }

  const groupRecord = buildGroupChatSyncRecord(groupSnapshot.id, groupSnapshot.data());
  if (!groupRecord) {
    throw new HttpsError("failed-precondition", "Group chat context could not be resolved.");
  }

  if (groupRecord.isPTGroup) {
    throw new HttpsError("failed-precondition", "PT groups do not support group chats.");
  }

  const isOwner = groupRecord.ownerUserId === callerUid;
  const isMember = groupRecord.userIds.includes(callerUid);
  if (!isOwner && !isMember) {
    throw new HttpsError("permission-denied", "You are not a member of this group.");
  }

  const upsertResult = await upsertGroupChatFromRecord(groupRecord);
  if (!upsertResult) {
    throw new HttpsError("failed-precondition", "Group chat could not be created.");
  }

  await rtdb.ref(`${USER_CHATS_ROOT}/${callerUid}/${upsertResult.chatId}`).set(true);

  return {
    chatId: upsertResult.chatId,
    created: upsertResult.created,
  };
});

function buildGroupChatSyncRecord(
  groupId: string,
  data: FirebaseFirestore.DocumentData | undefined
): GroupChatSyncRecord | null {
  if (!data) {
    return null;
  }

  const normalizedGroupId = normalizeString(groupId);
  if (!normalizedGroupId) {
    return null;
  }

  return {
    groupId: normalizedGroupId,
    name: normalizeString(data["name"]) || "Group Chat",
    userIds: resolveGroupMemberIds(data["userIDs"], data["ownerUserId"]),
    ownerUserId: normalizeString(data["ownerUserId"]),
    isPTGroup: data["isPTGroup"] === true,
    groupImage: normalizeString(data["groupImage"]),
  };
}

async function upsertGroupChatFromRecord(
  groupRecord: GroupChatSyncRecord
): Promise<UpsertResult | null> {
  if (groupRecord.isPTGroup || groupRecord.userIds.length === 0) {
    return null;
  }

  const existingChatId = await findGroupChatIdByGroupId(groupRecord.groupId);
  if (existingChatId) {
    await syncExistingGroupChat(existingChatId, groupRecord);
    return {chatId: existingChatId, created: false};
  }

  const chatRef = rtdb.ref(CHATS_ROOT).push();
  const chatId = normalizeString(chatRef.key);
  if (!chatId) {
    throw new Error(`Failed to create chat key for groupId=${groupRecord.groupId}`);
  }

  const timestamp = new Date().toISOString();
  await chatRef.set({
    chatId,
    participants: groupRecord.userIds,
    lastMessage: "",
    lastMessageTime: timestamp,
    messages: {},
    type: "group",
    groupId: groupRecord.groupId,
    displayName: groupRecord.name,
    groupImage: groupRecord.groupImage,
    isGroupChat: true,
  });

  await Promise.all(
    groupRecord.userIds.map((userId) => rtdb.ref(`${USER_CHATS_ROOT}/${userId}/${chatId}`).set(true))
  );

  return {chatId, created: true};
}

async function syncExistingGroupChat(
  chatId: string,
  groupRecord: GroupChatSyncRecord
): Promise<void> {
  const chatRef = rtdb.ref(`${CHATS_ROOT}/${chatId}`);
  const chatSnapshot = await chatRef.once("value");
  const chatData = chatSnapshot.val() as Record<string, unknown> | null;
  const previousParticipants = normalizeUserIds(chatData?.["participants"]);
  const timestamp = new Date().toISOString();

  const hasLastMessageTime = normalizeString(chatData?.["lastMessageTime"]).length > 0;
  const hasLastMessage = typeof chatData?.["lastMessage"] === "string";

  const updatePayload: Record<string, unknown> = {
    participants: groupRecord.userIds,
    type: "group",
    groupId: groupRecord.groupId,
    displayName: groupRecord.name,
    groupImage: groupRecord.groupImage,
    isGroupChat: true,
    ...(hasLastMessage ? {} : {lastMessage: ""}),
    ...(hasLastMessageTime ? {} : {lastMessageTime: timestamp}),
  };

  await chatRef.update(updatePayload);

  const nextParticipantSet = new Set(groupRecord.userIds);
  const membershipWrites: Promise<unknown>[] = [];

  for (const userId of groupRecord.userIds) {
    membershipWrites.push(rtdb.ref(`${USER_CHATS_ROOT}/${userId}/${chatId}`).set(true));
  }

  for (const userId of previousParticipants) {
    if (!nextParticipantSet.has(userId)) {
      membershipWrites.push(rtdb.ref(`${USER_CHATS_ROOT}/${userId}/${chatId}`).remove());
    }
  }

  await Promise.all(membershipWrites);
}

async function findGroupChatIdByGroupId(groupId: string): Promise<string | null> {
  const normalizedGroupId = normalizeString(groupId);
  if (!normalizedGroupId) {
    return null;
  }

  const snapshot = await rtdb
    .ref(CHATS_ROOT)
    .orderByChild("groupId")
    .equalTo(normalizedGroupId)
    .once("value");

  if (!snapshot.exists()) {
    return null;
  }

  let foundChatId: string | null = null;
  snapshot.forEach((childSnapshot) => {
    if (foundChatId) {
      return true;
    }

    const chatData = childSnapshot.val() as Record<string, unknown> | null;
    if (isGroupChatRecord(chatData)) {
      foundChatId = normalizeString(childSnapshot.key);
      return true;
    }

    return false;
  });

  return foundChatId;
}

function isGroupChatRecord(chatData: Record<string, unknown> | null): boolean {
  if (!chatData) {
    return false;
  }

  const participants = normalizeUserIds(chatData["participants"]);
  return (
    normalizeString(chatData["type"]) === "group" ||
    normalizeString(chatData["groupId"]).length > 0 ||
    participants.length > 2
  );
}

function normalizeUserIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const deduped = new Set<string>();
  for (const entry of value) {
    const normalized = normalizeString(entry);
    if (normalized) {
      deduped.add(normalized);
    }
  }

  return Array.from(deduped);
}

function resolveGroupMemberIds(userIdsValue: unknown, ownerUserIdValue: unknown): string[] {
  const memberIds = new Set(normalizeUserIds(userIdsValue));
  const ownerUserId = normalizeString(ownerUserIdValue);
  if (ownerUserId) {
    memberIds.add(ownerUserId);
  }
  return Array.from(memberIds);
}

function normalizeString(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
}
