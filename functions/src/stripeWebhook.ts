import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import { defineSecret } from "firebase-functions/params";
import { onRequest } from "firebase-functions/v2/https";
import Stripe from "stripe";

if (admin.apps.length === 0) {
  admin.initializeApp();
}

const db = admin.firestore();
const stripeSecretKey = defineSecret("STRIPE_SECRET_KEY");
const stripeWebhookSecret = defineSecret("STRIPE_WEBHOOK_SECRET");

interface SubscriptionIdentity {
  clientId: string;
  trainerId: string;
  planId: string;
}

export const stripeWebhook = onRequest(
  {secrets: [stripeSecretKey, stripeWebhookSecret]},
  async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).send("Method Not Allowed");
      return;
    }

    const signature = normalizeString(req.header("stripe-signature"));
    if (!signature) {
      res.status(400).send("Missing stripe-signature header.");
      return;
    }

    const stripeApiKey = stripeSecretKey.value()?.trim() ?? "";
    const webhookSecret = stripeWebhookSecret.value()?.trim() ?? "";
    if (!stripeApiKey || !webhookSecret) {
      logger.error("[StripeWebhook] Missing Stripe secret configuration.");
      res.status(500).send("Stripe webhook is not configured.");
      return;
    }

    const stripe = new Stripe(stripeApiKey);
    let event: any;

    try {
      event = stripe.webhooks.constructEvent(req.rawBody, signature, webhookSecret);
    } catch (error) {
      logger.warn("[StripeWebhook] Signature verification failed.", {
        error: stringifyError(error),
      });
      res.status(400).send("Webhook signature verification failed.");
      return;
    }

    try {
      await routeStripeEvent(event, stripe);
      res.status(200).json({received: true});
    } catch (error) {
      logger.error("[StripeWebhook] Failed to process webhook event.", {
        eventId: event.id,
        eventType: event.type,
        error: stringifyError(error),
      });
      res.status(500).send("Failed to process webhook event.");
    }
  }
);

async function routeStripeEvent(event: any, stripe: any): Promise<void> {
  switch (event.type) {
  case "checkout.session.completed":
    await handleCheckoutCompleted(
      event.data.object,
      stripe,
      event
    );
    return;
  case "customer.subscription.updated":
    await handleSubscriptionUpdated(
      event.data.object,
      event
    );
    return;
  case "customer.subscription.deleted":
    await handleSubscriptionDeleted(
      event.data.object,
      event
    );
    return;
  case "invoice.payment_failed":
    await handleInvoicePaymentFailed(
      event.data.object,
      event
    );
    return;
  case "invoice.paid":
    await handleInvoicePaid(
      event.data.object,
      event
    );
    return;
  default:
    logger.info("[StripeWebhook] Ignoring event.", {
      eventId: event.id,
      eventType: event.type,
    });
  }
}

async function handleCheckoutCompleted(
  session: any,
  stripe: any,
  event: any
): Promise<void> {
  const sessionId = normalizeString(session.id);
  const subscriptionId = resolveSubscriptionId(session.subscription);
  if (!subscriptionId) {
    logger.warn("[StripeWebhook] checkout.session.completed missing subscription id.", {
      eventId: event.id,
      sessionId,
    });
    return;
  }

  const identity = await resolveIdentityForCheckoutSession(session, subscriptionId, stripe);
  if (!identity) {
    logger.warn("[StripeWebhook] Missing client/trainer/plan metadata for checkout completion.", {
      eventId: event.id,
      sessionId,
      subscriptionId,
    });
    return;
  }

  await upsertTrainerSubscription(subscriptionId, {
    status: "active",
    clientId: identity.clientId,
    trainerId: identity.trainerId,
    planId: identity.planId,
    stripeSubscriptionId: subscriptionId,
    stripeCheckoutSessionId: sessionId,
    stripeCustomerId: resolveStripeObjectId(session.customer),
    lastEventId: event.id,
    lastEventType: event.type,
  });

  if (sessionId) {
    await db.doc(`checkoutSessions/${sessionId}`).set({
      stripeStatus: "complete",
      stripeSubscriptionId: subscriptionId,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, {merge: true});
  }

  logger.info("[StripeWebhook] Activated trainer subscription.", {
    eventId: event.id,
    sessionId,
    subscriptionId,
    clientId: identity.clientId,
    trainerId: identity.trainerId,
    planId: identity.planId,
  });
}

async function handleSubscriptionUpdated(
  subscription: any,
  event: any
): Promise<void> {
  const subscriptionId = normalizeString(subscription.id);
  if (!subscriptionId) {
    return;
  }

  const identity = await resolveIdentityForSubscription(subscriptionId, toRecord(subscription.metadata));
  if (!identity) {
    logger.warn("[StripeWebhook] customer.subscription.updated missing identity fields.", {
      eventId: event.id,
      subscriptionId,
    });
    return;
  }

  await upsertTrainerSubscription(subscriptionId, {
    status: normalizeStripeSubscriptionStatus(subscription.status) || "active",
    clientId: identity.clientId,
    trainerId: identity.trainerId,
    planId: identity.planId,
    stripeSubscriptionId: subscriptionId,
    stripeCustomerId: resolveStripeObjectId(subscription.customer),
    cancelAtPeriodEnd: subscription.cancel_at_period_end === true,
    currentPeriodEnd: toTimestampOrNull(subscription.current_period_end),
    lastEventId: event.id,
    lastEventType: event.type,
  });
}

async function handleSubscriptionDeleted(
  subscription: any,
  event: any
): Promise<void> {
  const subscriptionId = normalizeString(subscription.id);
  if (!subscriptionId) {
    return;
  }

  const identity = await resolveIdentityForSubscription(subscriptionId, toRecord(subscription.metadata));
  if (!identity) {
    logger.warn("[StripeWebhook] customer.subscription.deleted missing identity fields.", {
      eventId: event.id,
      subscriptionId,
    });
    return;
  }

  await upsertTrainerSubscription(subscriptionId, {
    status: "canceled",
    clientId: identity.clientId,
    trainerId: identity.trainerId,
    planId: identity.planId,
    stripeSubscriptionId: subscriptionId,
    stripeCustomerId: resolveStripeObjectId(subscription.customer),
    canceledAt: toTimestampOrNull(subscription.canceled_at),
    lastEventId: event.id,
    lastEventType: event.type,
  });
}

async function handleInvoicePaymentFailed(
  invoice: any,
  event: any
): Promise<void> {
  const subscriptionId = resolveSubscriptionId(invoice.subscription);
  if (!subscriptionId) {
    logger.warn("[StripeWebhook] invoice.payment_failed missing subscription id.", {
      eventId: event.id,
      invoiceId: normalizeString(invoice.id),
    });
    return;
  }

  const invoiceMetadata = toRecord(invoice.metadata);
  const identity = await resolveIdentityForSubscription(subscriptionId, invoiceMetadata);
  if (!identity) {
    logger.warn("[StripeWebhook] invoice.payment_failed missing identity fields.", {
      eventId: event.id,
      subscriptionId,
    });
    return;
  }

  await upsertTrainerSubscription(subscriptionId, {
    status: "past_due",
    clientId: identity.clientId,
    trainerId: identity.trainerId,
    planId: identity.planId,
    stripeSubscriptionId: subscriptionId,
    stripeCustomerId: resolveStripeObjectId(invoice.customer),
    latestInvoiceId: normalizeString(invoice.id),
    lastEventId: event.id,
    lastEventType: event.type,
  });
}

async function handleInvoicePaid(
  invoice: any,
  event: any
): Promise<void> {
  const invoiceId = normalizeString(invoice.id);
  const subscriptionId = resolveSubscriptionId(invoice.subscription);
  if (!subscriptionId) {
    logger.warn("[StripeWebhook] invoice.paid missing subscription id.", {
      eventId: event.id,
      invoiceId,
    });
    return;
  }

  const invoiceMetadata = toRecord(invoice.metadata);
  const identity = await resolveIdentityForSubscription(subscriptionId, invoiceMetadata);
  if (!identity) {
    logger.warn("[StripeWebhook] invoice.paid missing identity fields.", {
      eventId: event.id,
      invoiceId,
      subscriptionId,
    });
    return;
  }

  const amountPaidCents = toPositiveInteger(
    invoice.amount_paid ?? invoice.amount_due ?? invoice.amount_total
  );
  if (amountPaidCents === null || amountPaidCents <= 0) {
    return;
  }

  const paidAtSeconds = toPositiveInteger(toRecord(invoice.status_transitions)["paid_at"]);
  const paidAt = toTimestampOrNull(paidAtSeconds ?? undefined);
  const currency = normalizeString(invoice.currency).toLowerCase() || "usd";

  await db.doc(`transactions/${invoiceId || subscriptionId}_${event.id}`).set({
    transactionId: invoiceId || `${subscriptionId}_${event.id}`,
    stripeInvoiceId: invoiceId,
    stripeSubscriptionId: subscriptionId,
    clientId: identity.clientId,
    trainerId: identity.trainerId,
    planId: identity.planId,
    amountCents: amountPaidCents,
    amount: amountPaidCents / 100,
    currency,
    status: "paid",
    source: "stripe",
    paymentMethod: "stripe",
    paidAt: paidAt ?? admin.firestore.FieldValue.serverTimestamp(),
    createdAt: paidAt ?? admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    lastEventId: event.id,
    lastEventType: event.type,
  }, {merge: true});

  await upsertTrainerSubscription(subscriptionId, {
    status: "active",
    clientId: identity.clientId,
    trainerId: identity.trainerId,
    planId: identity.planId,
    stripeSubscriptionId: subscriptionId,
    stripeCustomerId: resolveStripeObjectId(invoice.customer),
    latestInvoiceId: invoiceId,
    lastEventId: event.id,
    lastEventType: event.type,
  });
}

async function resolveIdentityForCheckoutSession(
  session: any,
  subscriptionId: string,
  stripe: any
): Promise<SubscriptionIdentity | null> {
  const sessionMetadata = toRecord(session.metadata);
  let identity = readIdentityFromRecord(sessionMetadata);
  if (identity) {
    return identity;
  }

  const sessionId = normalizeString(session.id);
  if (sessionId) {
    const checkoutSessionSnapshot = await db.doc(`checkoutSessions/${sessionId}`).get();
    if (checkoutSessionSnapshot.exists) {
      identity = readIdentityFromRecord(toRecord(checkoutSessionSnapshot.data()));
      if (identity) {
        return identity;
      }
    }
  }

  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  identity = readIdentityFromRecord(toRecord(subscription.metadata));
  if (identity) {
    return identity;
  }

  return await readIdentityFromExistingSubscriptionDoc(subscriptionId);
}

async function resolveIdentityForSubscription(
  subscriptionId: string,
  metadataRecord: Record<string, unknown>
): Promise<SubscriptionIdentity | null> {
  const fromMetadata = readIdentityFromRecord(metadataRecord);
  if (fromMetadata) {
    return fromMetadata;
  }

  return await readIdentityFromExistingSubscriptionDoc(subscriptionId);
}

async function readIdentityFromExistingSubscriptionDoc(
  subscriptionId: string
): Promise<SubscriptionIdentity | null> {
  const subscriptionSnapshot = await db.doc(`trainerSubscriptions/${subscriptionId}`).get();
  if (!subscriptionSnapshot.exists) {
    return null;
  }

  return readIdentityFromRecord(toRecord(subscriptionSnapshot.data()));
}

function readIdentityFromRecord(record: Record<string, unknown>): SubscriptionIdentity | null {
  const clientId = normalizeString(record["clientId"]);
  const trainerId = normalizeString(record["trainerId"]);
  const planId = normalizeString(record["planId"]);
  if (!clientId || !trainerId || !planId) {
    return null;
  }

  return {
    clientId,
    trainerId,
    planId,
  };
}

async function upsertTrainerSubscription(
  subscriptionId: string,
  payload: Record<string, unknown>
): Promise<void> {
  const docRef = db.doc(`trainerSubscriptions/${subscriptionId}`);
  await db.runTransaction(async (transaction) => {
    const existing = await transaction.get(docRef);
    const nextPayload: Record<string, unknown> = {
      ...payload,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    if (!existing.exists) {
      nextPayload["createdAt"] = admin.firestore.FieldValue.serverTimestamp();
    }

    transaction.set(docRef, nextPayload, {merge: true});
  });
}

function resolveSubscriptionId(
  value: unknown
): string {
  if (typeof value === "string") {
    return value.trim();
  }

  if (value && typeof value === "object") {
    return normalizeString(toRecord(value)["id"]);
  }

  return "";
}

function resolveStripeObjectId(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }

  if (value && typeof value === "object") {
    return normalizeString(toRecord(value)["id"]);
  }

  return "";
}

function normalizeStripeSubscriptionStatus(value: unknown): string {
  const normalized = normalizeString(value);
  return normalized || "";
}

function toTimestampOrNull(value: number | null | undefined): admin.firestore.Timestamp | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }

  return admin.firestore.Timestamp.fromMillis(value * 1000);
}

function toPositiveInteger(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  const rounded = Math.trunc(parsed);
  return rounded > 0 ? rounded : null;
}

function stringifyError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
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
