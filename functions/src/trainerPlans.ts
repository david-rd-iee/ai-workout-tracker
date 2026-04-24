import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import { HttpsError, onCall } from "firebase-functions/v2/https";

if (admin.apps.length === 0) {
  admin.initializeApp();
}

const db = admin.firestore();

type TrainerPlanBillingType = "weekly" | "monthly" | "quarterly" | "yearly";

interface CreateTrainerPlanResponse {
  planId: string;
}

export const createTrainerPlan = onCall(async (request): Promise<CreateTrainerPlanResponse> => {
  const uid = normalizeString(request.auth?.uid);
  if (!uid) {
    throw new HttpsError("unauthenticated", "Authentication is required.");
  }

  const userSnapshot = await db.doc(`users/${uid}`).get();
  if (!userSnapshot.exists) {
    throw new HttpsError("not-found", "User profile was not found.");
  }

  const userData = toRecord(userSnapshot.data());
  if (userData["isPT"] !== true) {
    throw new HttpsError(
      "permission-denied",
      "Only trainer accounts can create plans."
    );
  }

  const payload = toRecord(request.data);
  const title = normalizeString(payload["title"]);
  const description = normalizeString(payload["description"]);
  const priceCents = toPositiveInteger(payload["priceCents"]);
  const billingType = normalizeBillingType(payload["billingType"]);

  if (!title) {
    throw new HttpsError("invalid-argument", "title is required.");
  }

  if (!description) {
    throw new HttpsError("invalid-argument", "description is required.");
  }

  if (priceCents === null) {
    throw new HttpsError("invalid-argument", "priceCents must be a positive integer.");
  }

  if (!billingType) {
    throw new HttpsError(
      "invalid-argument",
      "billingType must be one of: weekly, monthly, quarterly, yearly."
    );
  }

  const planRef = db.collection("trainerPlans").doc();
  await planRef.set({
    planId: planRef.id,
    trainerId: uid,
    title,
    description,
    priceCents,
    billingType,
    isActive: true,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  logger.info("[TrainerPlans] Trainer plan created.", {
    trainerId: uid,
    planId: planRef.id,
    billingType,
    priceCents,
  });

  return {
    planId: planRef.id,
  };
});

function normalizeBillingType(value: unknown): TrainerPlanBillingType | "" {
  const normalized = normalizeString(value).toLowerCase();
  const allowed: TrainerPlanBillingType[] = ["weekly", "monthly", "quarterly", "yearly"];
  return allowed.includes(normalized as TrainerPlanBillingType) ?
    normalized as TrainerPlanBillingType :
    "";
}

function toPositiveInteger(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  const rounded = Math.trunc(parsed);
  return rounded > 0 ? rounded : null;
}

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}
