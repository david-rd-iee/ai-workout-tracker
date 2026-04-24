import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import { defineSecret } from "firebase-functions/params";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import Stripe from "stripe";

if (admin.apps.length === 0) {
  admin.initializeApp();
}

const db = admin.firestore();
const stripeSecretKey = defineSecret("STRIPE_SECRET_KEY");

type TrainerPlanBillingType = "weekly" | "monthly" | "quarterly" | "yearly";

interface CreateCheckoutSessionResponse {
  sessionId: string;
  checkoutUrl: string;
}

export const createCheckoutSession = onCall(
  {secrets: [stripeSecretKey]},
  async (request): Promise<CreateCheckoutSessionResponse> => {
    const clientId = normalizeString(request.auth?.uid);
    if (!clientId) {
      throw new HttpsError("unauthenticated", "Authentication is required.");
    }

    const payload = toRecord(request.data);
    const planId = normalizeString(payload["planId"]);
    const successUrl = normalizeRedirectUrl(payload["successUrl"]);
    const cancelUrl = normalizeRedirectUrl(payload["cancelUrl"]);

    if (!planId) {
      throw new HttpsError("invalid-argument", "planId is required.");
    }

    if (!successUrl || !cancelUrl) {
      throw new HttpsError(
        "invalid-argument",
        "Valid successUrl and cancelUrl values are required."
      );
    }

    const stripeApiKey = stripeSecretKey.value()?.trim() ?? "";
    if (!stripeApiKey) {
      throw new HttpsError(
        "internal",
        "Stripe checkout is not configured.",
        "STRIPE_SECRET_KEY is missing."
      );
    }

    const [clientSnap, planSnap] = await Promise.all([
      db.doc(`users/${clientId}`).get(),
      db.doc(`trainerPlans/${planId}`).get(),
    ]);

    if (!clientSnap.exists) {
      throw new HttpsError("not-found", "Client profile was not found.");
    }
    if (!planSnap.exists) {
      throw new HttpsError("not-found", "Trainer plan was not found.");
    }

    const clientData = toRecord(clientSnap.data());
    if (clientData["isPT"] === true) {
      throw new HttpsError("permission-denied", "Only client accounts can checkout trainer plans.");
    }

    const planData = toRecord(planSnap.data());
    const trainerId = normalizeString(planData["trainerId"]);
    const title = normalizeString(planData["title"]);
    const description = normalizeString(planData["description"]);
    const priceCents = toPositiveInteger(planData["priceCents"]);
    const billingType = normalizeBillingType(planData["billingType"]);
    const isActive = planData["isActive"] !== false;

    if (!trainerId || !title || !description || priceCents === null || !billingType || !isActive) {
      throw new HttpsError(
        "failed-precondition",
        "Trainer plan is missing required billing configuration."
      );
    }

    const clientTrainerId = resolveClientAssignedTrainerId(clientData);
    if (!clientTrainerId || clientTrainerId !== trainerId) {
      throw new HttpsError(
        "permission-denied",
        "You can only checkout plans from the trainer assigned in your users document."
      );
    }

    const [trainerSnap] = await Promise.all([
      db.doc(`users/${trainerId}`).get(),
    ]);
    if (!trainerSnap.exists) {
      throw new HttpsError("not-found", "Trainer profile was not found.");
    }

    const trainerData = toRecord(trainerSnap.data());
    const trainerFirstName = normalizeString(trainerData["firstName"]);
    const trainerLastName = normalizeString(trainerData["lastName"]);
    const trainerDisplayName = `${trainerFirstName} ${trainerLastName}`.trim() || "Your Trainer";
    const trainerStripeAccountId = resolveStripeAccountId(trainerData);
    if (!trainerStripeAccountId) {
      throw new HttpsError(
        "failed-precondition",
        "Assigned trainer is not ready to receive Stripe payouts yet."
      );
    }

    const stripe = new Stripe(stripeApiKey);
    const recurring = toRecurringPriceData(billingType);
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      success_url: successUrl,
      cancel_url: cancelUrl,
      client_reference_id: clientId,
      allow_promotion_codes: true,
      metadata: {
        clientId,
        trainerId,
        planId,
        billingType,
        trainerStripeAccountId,
      },
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: priceCents,
            recurring,
            product_data: {
              name: `${title} - ${trainerDisplayName}`,
              description,
              metadata: {
                trainerId,
                planId,
                billingType,
              },
            },
          },
        },
      ],
      subscription_data: {
        transfer_data: {
          destination: trainerStripeAccountId,
        },
        metadata: {
          clientId,
          trainerId,
          planId,
          billingType,
          trainerStripeAccountId,
        },
      },
    });

    if (!session.url) {
      throw new HttpsError("internal", "Stripe checkout session did not return a URL.");
    }

    await db.doc(`checkoutSessions/${session.id}`).set({
      checkoutSessionId: session.id,
      stripeStatus: session.status ?? "open",
      clientId,
      trainerId,
      planId,
      priceCents,
      billingType,
      mode: "subscription",
      trainerStripeAccountId,
      successUrl: successUrl,
      cancelUrl: cancelUrl,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, {merge: true});

    logger.info("[StripeCheckout] Checkout session created.", {
      checkoutSessionId: session.id,
      clientId,
      trainerId,
      planId,
      billingType,
      priceCents,
      trainerStripeAccountId,
    });

    return {
      sessionId: session.id,
      checkoutUrl: session.url,
    };
  }
);

function toRecurringPriceData(
  billingType: TrainerPlanBillingType
): {interval: "week" | "month" | "year"; interval_count?: number} {
  if (billingType === "weekly") {
    return {interval: "week"};
  }
  if (billingType === "monthly") {
    return {interval: "month"};
  }
  if (billingType === "quarterly") {
    return {interval: "month", interval_count: 3};
  }
  return {interval: "year"};
}

function normalizeBillingType(value: unknown): TrainerPlanBillingType | "" {
  const normalized = normalizeString(value).toLowerCase();
  const allowed: TrainerPlanBillingType[] = ["weekly", "monthly", "quarterly", "yearly"];
  return allowed.includes(normalized as TrainerPlanBillingType) ?
    normalized as TrainerPlanBillingType :
    "";
}

function resolveClientAssignedTrainerId(clientData: Record<string, unknown>): string {
  return normalizeString(clientData["trainerID"]) || normalizeString(clientData["trainerId"]);
}

function resolveStripeAccountId(userData: Record<string, unknown>): string {
  const topLevelAccountId = normalizeString(userData["stripeAccountId"]);
  if (topLevelAccountId) {
    return topLevelAccountId;
  }

  const stripeConnect = toRecord(userData["stripeConnect"]);
  return normalizeString(stripeConnect["accountId"]);
}

function toPositiveInteger(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  const rounded = Math.trunc(parsed);
  return rounded > 0 ? rounded : null;
}

function normalizeRedirectUrl(value: unknown): string {
  const raw = normalizeString(value);
  if (!raw) {
    return "";
  }

  try {
    const parsed = new URL(raw);
    const isLocalHost = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
    const hasAllowedProtocol = parsed.protocol === "https:" || (isLocalHost && parsed.protocol === "http:");
    if (!hasAllowedProtocol) {
      return "";
    }
    return parsed.toString();
  } catch {
    return "";
  }
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
