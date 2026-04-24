import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import { HttpsError, onCall } from "firebase-functions/v2/https";

if (admin.apps.length === 0) {
  admin.initializeApp();
}

const db = admin.firestore();
const fallbackProfileImage = "assets/user_icons/profilePhoto.svg";

interface AcceptTrainerClientRequestResponse {
  trainerId: string;
  clientId: string;
  status: "accepted";
}

export const acceptTrainerClientRequest = onCall(
  async (request): Promise<AcceptTrainerClientRequestResponse> => {
    const trainerId = normalizeString(request.auth?.uid);
    if (!trainerId) {
      throw new HttpsError("unauthenticated", "Authentication is required.");
    }

    const payload = toRecord(request.data);
    const clientId = normalizeString(payload["clientId"]);
    if (!clientId) {
      throw new HttpsError("invalid-argument", "clientId is required.");
    }

    const trainerUserRef = db.doc(`users/${trainerId}`);
    const trainerProfileRef = db.doc(`trainers/${trainerId}`);
    const clientUserRef = db.doc(`users/${clientId}`);
    const clientProfileRef = db.doc(`clients/${clientId}`);
    const trainerRequestRef = db.doc(`trainers/${trainerId}/clientRequests/${clientId}`);
    const clientRequestRef = db.doc(`clients/${clientId}/trainerRequests/${trainerId}`);
    const trainerClientRef = db.doc(`trainers/${trainerId}/clients/${clientId}`);

    await db.runTransaction(async (transaction) => {
      const [
        trainerUserSnap,
        trainerProfileSnap,
        clientUserSnap,
        clientProfileSnap,
        trainerRequestSnap,
        clientRequestSnap,
      ] = await Promise.all([
        transaction.get(trainerUserRef),
        transaction.get(trainerProfileRef),
        transaction.get(clientUserRef),
        transaction.get(clientProfileRef),
        transaction.get(trainerRequestRef),
        transaction.get(clientRequestRef),
      ]);

      if (!trainerUserSnap.exists && !trainerProfileSnap.exists) {
        throw new HttpsError("permission-denied", "Trainer account was not found.");
      }

      const trainerUserData = toRecord(trainerUserSnap.data());
      const trainerIsPT = trainerUserData["isPT"] === true;
      if (!trainerIsPT && !trainerProfileSnap.exists) {
        throw new HttpsError("permission-denied", "Only trainer accounts can accept client requests.");
      }

      if (!clientUserSnap.exists || !clientProfileSnap.exists) {
        throw new HttpsError("not-found", "Client profile was not found.");
      }

      if (!trainerRequestSnap.exists || !clientRequestSnap.exists) {
        throw new HttpsError("failed-precondition", "No pending request exists for this trainer and client.");
      }

      const trainerRequestData = toRecord(trainerRequestSnap.data());
      const clientRequestData = toRecord(clientRequestSnap.data());

      const trainerRequestStatus = normalizeString(trainerRequestData["status"]).toLowerCase();
      const clientRequestStatus = normalizeString(clientRequestData["status"]).toLowerCase();
      if (trainerRequestStatus !== "pending" || clientRequestStatus !== "pending") {
        throw new HttpsError("failed-precondition", "The request is not pending.");
      }

      const trainerRequestTrainerId = normalizeString(trainerRequestData["trainerId"]);
      const clientRequestTrainerId = normalizeString(clientRequestData["trainerId"]);
      const trainerRequestClientId = normalizeString(trainerRequestData["clientId"]);
      const clientRequestClientId = normalizeString(clientRequestData["clientId"]);

      if (
        trainerRequestTrainerId !== trainerId ||
        clientRequestTrainerId !== trainerId ||
        trainerRequestClientId !== clientId ||
        clientRequestClientId !== clientId
      ) {
        throw new HttpsError("permission-denied", "Request identity mismatch.");
      }

      const clientUserData = toRecord(clientUserSnap.data());
      const clientProfileData = toRecord(clientProfileSnap.data());

      const firstName =
        normalizeString(clientUserData["firstName"]) ||
        normalizeString(clientProfileData["firstName"]);
      const lastName =
        normalizeString(clientUserData["lastName"]) ||
        normalizeString(clientProfileData["lastName"]);
      const clientEmail =
        normalizeString(clientProfileData["email"]) ||
        normalizeString(clientUserData["email"]);
      const profilepic =
        normalizeString(clientUserData["profilepic"]) ||
        normalizeString(clientUserData["profileImage"]) ||
        normalizeString(clientProfileData["profilepic"]) ||
        normalizeString(clientProfileData["profileImage"]) ||
        fallbackProfileImage;

      const joinedDate = new Date().toISOString();
      const timestamp = admin.firestore.FieldValue.serverTimestamp();

      transaction.set(
        clientUserRef,
        {
          trainerId,
          updatedAt: timestamp,
        },
        { merge: true }
      );

      transaction.set(
        clientProfileRef,
        {
          trainerId,
          updatedAt: timestamp,
        },
        { merge: true }
      );

      transaction.set(
        trainerClientRef,
        {
          clientId,
          firstName,
          lastName,
          clientName: `${firstName} ${lastName}`.trim(),
          clientEmail,
          profilepic,
          joinedDate,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
        { merge: true }
      );

      transaction.set(
        trainerRequestRef,
        {
          status: "accepted",
          acceptedAt: timestamp,
          respondedAt: timestamp,
          respondedBy: trainerId,
          updatedAt: timestamp,
        },
        { merge: true }
      );

      transaction.set(
        clientRequestRef,
        {
          status: "accepted",
          acceptedAt: timestamp,
          respondedAt: timestamp,
          respondedBy: trainerId,
          updatedAt: timestamp,
        },
        { merge: true }
      );
    });

    logger.info("[TrainerClientRequests] Trainer accepted client request.", {
      trainerId,
      clientId,
    });

    return {
      trainerId,
      clientId,
      status: "accepted",
    };
  }
);

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}
