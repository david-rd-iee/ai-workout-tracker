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
const DEFAULT_CONNECT_COUNTRY = "US";

interface ConnectAccountRecord {
  id: string;
  details_submitted?: boolean;
  charges_enabled?: boolean;
  payouts_enabled?: boolean;
  requirements?: {
    currently_due?: unknown;
  };
}

interface CreateTrainerOnboardingLinkResponse {
  accountId: string;
  onboardingUrl: string;
  expiresAt: number;
}

export const createTrainerOnboardingLink = onCall(
  {secrets: [stripeSecretKey]},
  async (request): Promise<CreateTrainerOnboardingLinkResponse> => {
    const uid = normalizeString(request.auth?.uid);
    if (!uid) {
      throw new HttpsError("unauthenticated", "Authentication is required.");
    }

    const payload = toRecord(request.data);
    const returnUrl = normalizeRedirectUrl(payload["returnUrl"]);
    if (!returnUrl) {
      throw new HttpsError("invalid-argument", "A valid HTTPS returnUrl is required.");
    }
    const refreshUrl = normalizeRedirectUrl(payload["refreshUrl"]) ?? returnUrl;

    const stripeApiKey = stripeSecretKey.value()?.trim() ?? "";
    if (!stripeApiKey) {
      throw new HttpsError(
        "internal",
        "Stripe onboarding is not configured.",
        "STRIPE_SECRET_KEY is missing."
      );
    }

    const stripe = new Stripe(stripeApiKey);
    const userRef = db.doc(`users/${uid}`);
    const userSnapshot = await userRef.get();
    if (!userSnapshot.exists) {
      throw new HttpsError("not-found", "User profile was not found.");
    }

    const userData = toRecord(userSnapshot.data());
    if (userData["isPT"] !== true) {
      throw new HttpsError(
        "failed-precondition",
        "Stripe onboarding is only available for trainer accounts."
      );
    }

    const authToken = toRecord(request.auth?.token);
    const email = normalizeString(authToken["email"]) || normalizeString(userData["email"]);
    const existingAccountId = resolveStripeAccountId(userData);

    logger.info("[StripeConnect] Creating trainer onboarding link.", {
      uid,
      hasExistingAccountId: Boolean(existingAccountId),
    });

    try {
      const account = await resolveOrCreateConnectAccount(stripe, {
        uid,
        existingAccountId,
        email,
        country: resolveCountry(userData),
      });
      const accountLink = await stripe.accountLinks.create({
        account: account.id,
        refresh_url: refreshUrl,
        return_url: returnUrl,
        type: "account_onboarding",
      });

      const requirementsCurrentlyDueCount = Array.isArray(account.requirements?.currently_due) ?
        account.requirements.currently_due.length :
        0;

      await userRef.set(
        {
          stripeAccountId: account.id,
          stripeConnect: {
            accountId: account.id,
            detailsSubmitted: account.details_submitted === true,
            chargesEnabled: account.charges_enabled === true,
            payoutsEnabled: account.payouts_enabled === true,
            onboardingStatus: account.details_submitted === true ? "complete" : "pending",
            requirementsCurrentlyDueCount,
            onboardingLinkCreatedAt: admin.firestore.FieldValue.serverTimestamp(),
            onboardingLinkExpiresAt: admin.firestore.Timestamp.fromMillis(
              accountLink.expires_at * 1000
            ),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          updated_at: admin.firestore.FieldValue.serverTimestamp(),
        },
        {merge: true}
      );

      logger.info("[StripeConnect] Trainer onboarding link created.", {
        uid,
        accountId: account.id,
        expiresAt: accountLink.expires_at,
      });

      return {
        accountId: account.id,
        onboardingUrl: accountLink.url,
        expiresAt: accountLink.expires_at,
      };
    } catch (error) {
      logger.error("[StripeConnect] Failed to create trainer onboarding link.", {
        uid,
        error,
      });

      if (error instanceof HttpsError) {
        throw error;
      }

      throw new HttpsError(
        "internal",
        "Unable to start Stripe onboarding.",
        error instanceof Error ? error.message : String(error)
      );
    }
  }
);

async function resolveOrCreateConnectAccount(
  stripe: import("stripe").Stripe,
  context: {
    uid: string;
    existingAccountId: string;
    email: string;
    country: string;
  }
): Promise<ConnectAccountRecord> {
  if (context.existingAccountId) {
    try {
      const existingAccount = toRecord(await stripe.accounts.retrieve(context.existingAccountId));
      if (existingAccount["deleted"] !== true) {
        return {
          id: normalizeString(existingAccount["id"]),
          details_submitted: existingAccount["details_submitted"] === true,
          charges_enabled: existingAccount["charges_enabled"] === true,
          payouts_enabled: existingAccount["payouts_enabled"] === true,
          requirements: {
            currently_due: toRecord(existingAccount["requirements"])["currently_due"],
          },
        };
      }
    } catch (error) {
      if (!isStripeResourceMissingError(error)) {
        throw error;
      }
    }
  }

  const createdAccount = await stripe.accounts.create({
    type: "express",
    country: context.country,
    ...(context.email ? {email: context.email} : {}),
    metadata: {
      firebaseUid: context.uid,
      role: "trainer",
    },
  });

  return {
    id: normalizeString(createdAccount.id),
    details_submitted: createdAccount.details_submitted === true,
    charges_enabled: createdAccount.charges_enabled === true,
    payouts_enabled: createdAccount.payouts_enabled === true,
    requirements: {
      currently_due: createdAccount.requirements?.currently_due,
    },
  };
}

function resolveStripeAccountId(userData: Record<string, unknown>): string {
  const legacyTopLevelAccountId = normalizeString(userData["stripeAccountId"]);
  if (legacyTopLevelAccountId) {
    return legacyTopLevelAccountId;
  }

  const stripeConnect = toRecord(userData["stripeConnect"]);
  return normalizeString(stripeConnect["accountId"]);
}

function resolveCountry(userData: Record<string, unknown>): string {
  const candidates = [
    userData["countryCode"],
    userData["country"],
    toRecord(userData["address"])["countryCode"],
    toRecord(userData["address"])["country"],
  ];

  for (const candidate of candidates) {
    const normalized = normalizeCountryCode(candidate);
    if (normalized) {
      return normalized;
    }
  }

  return DEFAULT_CONNECT_COUNTRY;
}

function normalizeCountryCode(value: unknown): string {
  const normalized = normalizeString(value).toUpperCase();
  return /^[A-Z]{2}$/.test(normalized) ? normalized : "";
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

function isStripeResourceMissingError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  return (error as {code?: unknown}).code === "resource_missing";
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
