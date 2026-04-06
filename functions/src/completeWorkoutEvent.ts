import * as admin from "firebase-admin";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import {
  normalizeWorkoutEventCandidate,
  workoutEventToRecord,
} from "../../shared/adapters/workout-event.adapters";
import {
  COMPLETE_WORKOUT_EVENT_STATUS_PERSISTED,
  type CompleteWorkoutEventResponse,
} from "../../shared/models/complete-workout-event.model";
import type { WorkoutEventRecordSubmissionMetadata } from "../../shared/models/workout-event-record.model";

if (admin.apps.length === 0) {
  admin.initializeApp();
}

const db = admin.firestore();

export const completeWorkoutEvent = onCall(async (request): Promise<CompleteWorkoutEventResponse> => {
  const userId = String(request.auth?.uid ?? "").trim();
  if (!userId) {
    throw new HttpsError(
      "unauthenticated",
      "User must be authenticated to complete a workout event."
    );
  }

  const requestData = request.data && typeof request.data === "object" ?
    request.data as Record<string, unknown> :
    {};
  const submissionMetadata = normalizeSubmissionMetadata(requestData["submissionMetadata"]);
  const workoutEvent = normalizeWorkoutEventCandidate(requestData["event"], {
    defaultDate: submissionMetadata?.localSubmittedDate,
    isComplete: true,
  });

  if (workoutEvent.entries.length === 0) {
    throw new HttpsError("invalid-argument", "Workout must include at least one entry.");
  }

  const workoutEventRef = db.collection(`users/${userId}/workoutEvents`).doc();
  const payload = stripUndefinedDeep({
    ...workoutEventToRecord(workoutEvent),
    ...(submissionMetadata ? {submissionMetadata} : {}),
  }) as Record<string, unknown>;

  await workoutEventRef.set({
    ...payload,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return {
    eventId: workoutEventRef.id,
    status: COMPLETE_WORKOUT_EVENT_STATUS_PERSISTED,
  };
});

function normalizeSubmissionMetadata(
  candidate: unknown
): WorkoutEventRecordSubmissionMetadata | undefined {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return undefined;
  }

  const record = candidate as Record<string, unknown>;
  const localSubmittedDate = typeof record["localSubmittedDate"] === "string" ?
    record["localSubmittedDate"].trim() :
    "";
  const localSubmittedHour = toLocalSubmittedHour(record["localSubmittedHour"]);

  if (!localSubmittedDate && localSubmittedHour === undefined) {
    return undefined;
  }

  return {
    ...(localSubmittedDate ? {localSubmittedDate} : {}),
    ...(localSubmittedHour !== undefined ? {localSubmittedHour} : {}),
  };
}

function toLocalSubmittedHour(value: unknown): number | undefined {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }

  const roundedHour = Math.floor(parsed);
  return roundedHour >= 0 && roundedHour <= 23 ? roundedHour : undefined;
}

function stripUndefinedDeep(value: unknown): unknown {
  if (value === undefined) {
    return undefined;
  }

  if (Array.isArray(value)) {
    return value
      .map((entry) => stripUndefinedDeep(entry))
      .filter((entry) => entry !== undefined);
  }

  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).reduce<Record<string, unknown>>(
      (sanitized, [key, entry]) => {
        const cleanedEntry = stripUndefinedDeep(entry);
        if (cleanedEntry !== undefined) {
          sanitized[key] = cleanedEntry;
        }
        return sanitized;
      },
      {}
    );
  }

  return value;
}
