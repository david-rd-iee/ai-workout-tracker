import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import { onDocumentUpdated } from "firebase-functions/v2/firestore";

if (admin.apps.length === 0) {
  admin.initializeApp();
}

function readText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readTrainerAssignment(data: Record<string, unknown> | undefined): string {
  if (!data) {
    return "";
  }

  return readText(data["trainerId"]) || readText(data["trainerID"]);
}

export const onClientTrainerAssignmentChange = onDocumentUpdated(
  "users/{clientId}",
  async (event) => {
    const clientId = String(event.params.clientId ?? "").trim();
    if (!clientId) {
      return;
    }

    const before = event.data?.before?.data() as Record<string, unknown> | undefined;
    const after = event.data?.after?.data() as Record<string, unknown> | undefined;

    if (!after || after["isPT"] === true) {
      return;
    }

    const beforeTrainerAssignment = readTrainerAssignment(before);
    const afterTrainerAssignment = readTrainerAssignment(after);

    if (beforeTrainerAssignment === afterTrainerAssignment) {
      return;
    }

    await admin.firestore().doc(`userStats/${clientId}`).set(
      {
        trainerVerified: false,
      },
      { merge: true }
    );

    logger.info("[UserStatsVerification] trainer assignment changed; verification reset", {
      clientId,
      beforeTrainerAssignment,
      afterTrainerAssignment,
    });
  }
);
