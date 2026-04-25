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
const DEFAULT_WEB_APP_ORIGIN = resolveDefaultWebAppOrigin();

type AgreementPaymentType = "one_time" | "subscription";
type AgreementPaymentInterval = "week" | "month" | "year";
type AgreementPaymentStatus =
  | "not_required"
  | "not_started"
  | "checkout_started"
  | "paid"
  | "active"
  | "failed"
  | "canceled";
type AgreementStatus = "pending" | "signed" | "completed" | "partially_signed";

interface AgreementPaymentTerms {
  required: boolean;
  type: AgreementPaymentType;
  amountCents: number;
  currency: "usd";
  interval?: AgreementPaymentInterval;
  description: string;
}

interface AgreementCheckoutResponse {
  url: string;
}

export const createAgreementCheckoutSession = onCall(
  {secrets: [stripeSecretKey]},
  async (request): Promise<AgreementCheckoutResponse> => {
    const clientId = normalizeString(request.auth?.uid);
    if (!clientId) {
      throw new HttpsError("unauthenticated", "Authentication is required.");
    }

    const payload = toRecord(request.data);
    const agreementId = normalizeString(payload["agreementId"]);
    if (!agreementId) {
      throw new HttpsError("invalid-argument", "agreementId is required.");
    }

    const stripeApiKey = stripeSecretKey.value()?.trim() ?? "";
    if (!stripeApiKey) {
      throw new HttpsError("internal", "Stripe checkout is not configured.");
    }

    const agreementRef = db.doc(`agreements/${agreementId}`);
    const agreementSnapshot = await agreementRef.get();
    if (!agreementSnapshot.exists) {
      throw new HttpsError("not-found", "Agreement not found.");
    }

    const agreementData = toRecord(agreementSnapshot.data());
    const agreementClientId = normalizeString(agreementData["clientId"]);
    const trainerId = normalizeString(agreementData["trainerId"]);
    const agreementStatus = normalizeAgreementStatus(
      agreementData["agreementStatus"] ?? agreementData["status"]
    );
    const paymentStatus = normalizePaymentStatus(agreementData["paymentStatus"]);
    const paymentTerms = resolveActivePaymentTerms(agreementData, agreementStatus);

    if (!agreementClientId || !trainerId) {
      throw new HttpsError("failed-precondition", "Agreement is missing client or trainer information.");
    }

    if (agreementClientId !== clientId) {
      throw new HttpsError("permission-denied", "Only the assigned client can pay this agreement.");
    }

    if (!isSignedAgreementStatus(agreementStatus)) {
      throw new HttpsError("failed-precondition", "Agreement must be signed before checkout.");
    }

    if (!paymentTerms?.required) {
      throw new HttpsError("failed-precondition", "This agreement does not require payment.");
    }

    if (paymentStatus === "paid" || paymentStatus === "active") {
      throw new HttpsError("failed-precondition", "This agreement has already been paid.");
    }

    const [trainerSnapshot, clientSnapshot] = await Promise.all([
      db.doc(`users/${trainerId}`).get(),
      db.doc(`users/${clientId}`).get(),
    ]);

    if (!trainerSnapshot.exists) {
      throw new HttpsError("not-found", "Trainer profile was not found.");
    }
    if (!clientSnapshot.exists) {
      throw new HttpsError("not-found", "Client profile was not found.");
    }

    const trainerData = toRecord(trainerSnapshot.data());
    const clientData = toRecord(clientSnapshot.data());
    const trainerStripeAccountId = resolveStripeAccountId(trainerData);
    const trainerStripeReady = isTrainerStripeReady(trainerData);

    if (!trainerStripeAccountId || !trainerStripeReady) {
      throw new HttpsError("failed-precondition", "Trainer Stripe onboarding is incomplete.");
    }

    const stripe = new Stripe(stripeApiKey);
    const stripeCustomerId = await resolveOrCreateStripeCustomer({
      stripe,
      agreementData,
      clientId,
      clientData,
    });

    const successUrl = `${DEFAULT_WEB_APP_ORIGIN}/agreement-payment/${agreementId}?checkout=success`;
    const cancelUrl = `${DEFAULT_WEB_APP_ORIGIN}/agreement-payment/${agreementId}?checkout=cancel`;

    const mode: "payment" | "subscription" =
      paymentTerms.type === "subscription" ? "subscription" : "payment";

    const lineItemPriceData: {
      currency: "usd";
      unit_amount: number;
      product_data: {
        name: string;
        description: string;
        metadata: Record<string, string>;
      };
      recurring?: {
        interval: AgreementPaymentInterval;
      };
    } = {
      currency: paymentTerms.currency,
      unit_amount: paymentTerms.amountCents,
      product_data: {
        name: normalizeString(agreementData["name"]) || "Training Agreement",
        description: paymentTerms.description || "Training services",
        metadata: {
          agreementId,
          trainerId,
          clientId,
        },
      },
    };

    if (mode === "subscription") {
      lineItemPriceData.recurring = {
        interval: paymentTerms.interval ?? "month",
      };
    }

    const sessionParams: Record<string, unknown> = {
      mode,
      client_reference_id: clientId,
      customer: stripeCustomerId,
      success_url: successUrl,
      cancel_url: cancelUrl,
      allow_promotion_codes: true,
      metadata: {
        agreementId,
        trainerId,
        clientId,
        paymentType: paymentTerms.type,
      },
      line_items: [
        {
          quantity: 1,
          price_data: lineItemPriceData,
        },
      ],
    };

    if (mode === "payment") {
      sessionParams.payment_intent_data = {
        transfer_data: {
          destination: trainerStripeAccountId,
        },
        metadata: {
          agreementId,
          trainerId,
          clientId,
          paymentType: "one_time",
        },
      };
    } else {
      sessionParams.subscription_data = {
        transfer_data: {
          destination: trainerStripeAccountId,
        },
        metadata: {
          agreementId,
          trainerId,
          clientId,
          paymentType: "subscription",
        },
      };
    }

    const session = await stripe.checkout.sessions.create(sessionParams);
    if (!session.url) {
      throw new HttpsError("internal", "Stripe checkout session did not return a URL.");
    }

    await agreementRef.set({
      paymentStatus: "checkout_started",
      stripeCheckoutSessionId: normalizeString(session.id),
      stripeCustomerId,
      dateUpdated: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, {merge: true});

    await db.doc(`checkoutSessions/${session.id}`).set({
      checkoutSessionId: session.id,
      agreementId,
      clientId,
      trainerId,
      paymentType: paymentTerms.type,
      amountCents: paymentTerms.amountCents,
      currency: paymentTerms.currency,
      stripeCustomerId,
      stripeStatus: session.status ?? "open",
      mode,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, {merge: true});

    logger.info("[AgreementCheckout] Checkout session created.", {
      agreementId,
      checkoutSessionId: session.id,
      clientId,
      trainerId,
      paymentType: paymentTerms.type,
      amountCents: paymentTerms.amountCents,
    });

    return {
      url: session.url,
    };
  }
);

async function resolveOrCreateStripeCustomer(
  input: {
    stripe: InstanceType<typeof Stripe>;
    agreementData: Record<string, unknown>;
    clientId: string;
    clientData: Record<string, unknown>;
  }
): Promise<string> {
  const existingCustomerId = normalizeString(input.agreementData["stripeCustomerId"]);
  if (existingCustomerId) {
    try {
      const existingCustomer = await input.stripe.customers.retrieve(existingCustomerId);
      const customerRecord = toRecord(existingCustomer as unknown);
      if (customerRecord["deleted"] !== true) {
        return existingCustomerId;
      }
    } catch {
      // fall through to create a replacement customer
    }
  }

  const clientEmail = normalizeString(input.clientData["email"]);
  const clientFirstName = normalizeString(input.clientData["firstName"]);
  const clientLastName = normalizeString(input.clientData["lastName"]);
  const clientName = `${clientFirstName} ${clientLastName}`.trim();

  const customer = await input.stripe.customers.create({
    ...(clientEmail ? {email: clientEmail} : {}),
    ...(clientName ? {name: clientName} : {}),
    metadata: {
      firebaseUid: input.clientId,
      role: "client",
    },
  });

  return normalizeString(customer.id);
}

function normalizePaymentStatus(value: unknown): AgreementPaymentStatus {
  const normalized = normalizeString(value).toLowerCase();
  const allowed: AgreementPaymentStatus[] = [
    "not_required",
    "not_started",
    "checkout_started",
    "paid",
    "active",
    "failed",
    "canceled",
  ];
  return allowed.includes(normalized as AgreementPaymentStatus) ?
    normalized as AgreementPaymentStatus :
    "not_required";
}

function normalizeAgreementStatus(value: unknown): AgreementStatus {
  const normalized = normalizeString(value).toLowerCase();
  if (
    normalized === "signed" ||
    normalized === "completed" ||
    normalized === "partially_signed"
  ) {
    return normalized;
  }

  return "pending";
}

function isSignedAgreementStatus(status: AgreementStatus): boolean {
  return status === "signed" || status === "completed" || status === "partially_signed";
}

function resolveActivePaymentTerms(
  agreementData: Record<string, unknown>,
  agreementStatus: AgreementStatus
): AgreementPaymentTerms | null {
  const activePaymentTerms = normalizePaymentTerms(agreementData["activePaymentTerms"]);
  if (activePaymentTerms) {
    return activePaymentTerms;
  }

  // Backward compatibility for previously signed agreements that stored only paymentTerms.
  if (isSignedAgreementStatus(agreementStatus)) {
    return normalizePaymentTerms(agreementData["paymentTerms"] ?? agreementData["payment_terms"]);
  }

  return null;
}

function normalizePaymentTerms(value: unknown): AgreementPaymentTerms | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const paymentTerms = value as Record<string, unknown>;
  const required = paymentTerms["required"] === true;
  const type: AgreementPaymentType =
    normalizeString(paymentTerms["type"]).toLowerCase() === "subscription" ?
      "subscription" :
      "one_time";
  const amountCents = toPositiveInteger(paymentTerms["amountCents"]);
  const description = normalizeString(paymentTerms["description"]);
  const interval = normalizeInterval(paymentTerms["interval"]);

  if (!required) {
    return {
      required: false,
      type,
      amountCents: 0,
      currency: "usd",
      description,
      ...(interval ? {interval} : {}),
    };
  }

  if (amountCents === null || amountCents <= 0) {
    return null;
  }

  if (type === "subscription" && !interval) {
    return null;
  }

  return {
    required: true,
    type,
    amountCents,
    currency: "usd",
    description,
    ...(interval ? {interval} : {}),
  };
}

function isTrainerStripeReady(userData: Record<string, unknown>): boolean {
  const stripeConnect = toRecord(userData["stripeConnect"]);
  return (
    stripeConnect["detailsSubmitted"] === true &&
    stripeConnect["chargesEnabled"] === true &&
    stripeConnect["payoutsEnabled"] === true
  );
}

function resolveStripeAccountId(userData: Record<string, unknown>): string {
  const topLevelAccountId = normalizeString(userData["stripeAccountId"]);
  if (topLevelAccountId) {
    return topLevelAccountId;
  }

  const stripeConnect = toRecord(userData["stripeConnect"]);
  return normalizeString(stripeConnect["accountId"]);
}

function normalizeInterval(value: unknown): AgreementPaymentInterval | undefined {
  const normalized = normalizeString(value).toLowerCase();
  if (normalized === "week" || normalized === "month" || normalized === "year") {
    return normalized;
  }

  return undefined;
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

function resolveDefaultWebAppOrigin(): string {
  const projectId = normalizeString(process.env.GCLOUD_PROJECT);
  if (projectId) {
    return `https://${projectId}.web.app`;
  }

  return "https://ai-fitness-f8ed4.web.app";
}
