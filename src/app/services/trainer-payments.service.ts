import { Injectable, inject } from '@angular/core';
import { Auth } from '@angular/fire/auth';
import {
  Firestore,
  Timestamp,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
} from '@angular/fire/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { environment } from '../../environments/environment';

export interface TrainerStripeConnectSummary {
  accountId: string;
  detailsSubmitted: boolean;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  onboardingStatus: 'pending' | 'complete' | 'unknown';
  requirementsCurrentlyDueCount: number;
  onboardingLinkExpiresAt: Date | null;
  updatedAt: Date | null;
}

export interface TrainerRevenueSummary {
  completedSessions: number;
  totalRevenue: number;
  averageSessionValue: number;
}

export interface TrainerPaymentDashboardData {
  stripe: TrainerStripeConnectSummary | null;
  revenue: TrainerRevenueSummary;
}

export type TrainerPlanBillingType = 'weekly' | 'monthly' | 'quarterly' | 'yearly';

export interface TrainerPlanInput {
  title: string;
  description: string;
  priceCents: number;
  billingType: TrainerPlanBillingType;
}

interface CreateTrainerOnboardingLinkRequest {
  returnUrl: string;
  refreshUrl: string;
}

export interface CreateTrainerOnboardingLinkResponse {
  accountId: string;
  onboardingUrl: string;
  expiresAt: number;
}

interface CreateTrainerPlanRequest {
  title: string;
  description: string;
  priceCents: number;
  billingType: TrainerPlanBillingType;
}

export interface CreateTrainerPlanResponse {
  planId: string;
}

@Injectable({ providedIn: 'root' })
export class TrainerPaymentsService {
  private readonly auth = inject(Auth);
  private readonly firestore = inject(Firestore);

  async getDashboardData(): Promise<TrainerPaymentDashboardData> {
    const uid = this.resolveUid();
    const [stripe, revenue] = await Promise.all([
      this.getStripeSummary(uid),
      this.getRevenueSummary(uid),
    ]);

    return { stripe, revenue };
  }

  async getStripeSummary(userId?: string): Promise<TrainerStripeConnectSummary | null> {
    const uid = this.resolveUid(userId);
    const userSnapshot = await getDoc(doc(this.firestore, 'users', uid));
    if (!userSnapshot.exists()) {
      throw new Error('User profile was not found.');
    }

    const userData = toRecord(userSnapshot.data());
    if (userData['isPT'] !== true) {
      throw new Error('Trainer payment setup is only available for trainer accounts.');
    }

    return this.parseStripeSummary(userData);
  }

  async getRevenueSummary(userId?: string): Promise<TrainerRevenueSummary> {
    const uid = this.resolveUid(userId);
    const bookingsSnapshot = await getDocs(
      query(collection(this.firestore, 'bookings'), where('trainerId', '==', uid))
    );

    let completedSessions = 0;
    let totalRevenue = 0;
    bookingsSnapshot.forEach((bookingDoc) => {
      const booking = toRecord(bookingDoc.data());
      const bookingStatus = normalizeString(booking['status']).toLowerCase();
      if (bookingStatus !== 'completed') {
        return;
      }

      completedSessions += 1;
      const sessionPrice = toNumber(booking['price']);
      if (sessionPrice !== null && sessionPrice > 0) {
        totalRevenue += sessionPrice;
      }
    });

    return {
      completedSessions,
      totalRevenue,
      averageSessionValue: completedSessions > 0 ? totalRevenue / completedSessions : 0,
    };
  }

  async createOnboardingLink(): Promise<CreateTrainerOnboardingLinkResponse> {
    const redirectPath = '/tabs/stripe-setup';
    const returnUrl = this.resolveStripeRedirectUrl(redirectPath);
    const refreshUrl = this.resolveStripeRedirectUrl(`${redirectPath}?refresh=1`);

    const callable = httpsCallable<
      CreateTrainerOnboardingLinkRequest,
      CreateTrainerOnboardingLinkResponse
    >(
      getFunctions(undefined, 'us-central1'),
      'createTrainerOnboardingLink'
    );

    const response = await callable({
      returnUrl,
      refreshUrl,
    });

    return response.data;
  }

  async createTrainerPlan(input: TrainerPlanInput): Promise<CreateTrainerPlanResponse> {
    const title = normalizeString(input.title);
    const description = normalizeString(input.description);
    const priceCents = toInteger(input.priceCents);
    const billingType = normalizeString(input.billingType).toLowerCase() as TrainerPlanBillingType;
    const validBillingTypes: TrainerPlanBillingType[] = ['weekly', 'monthly', 'quarterly', 'yearly'];

    if (!title) {
      throw new Error('Title is required.');
    }

    if (!description) {
      throw new Error('Description is required.');
    }

    if (priceCents === null || priceCents <= 0) {
      throw new Error('Price must be a positive amount in cents.');
    }

    if (!validBillingTypes.includes(billingType)) {
      throw new Error('Billing type is invalid.');
    }

    const callable = httpsCallable<
      CreateTrainerPlanRequest,
      CreateTrainerPlanResponse
    >(
      getFunctions(undefined, 'us-central1'),
      'createTrainerPlan'
    );

    const response = await callable({
      title,
      description,
      priceCents,
      billingType,
    });

    return response.data;
  }

  private parseStripeSummary(userData: Record<string, unknown>): TrainerStripeConnectSummary | null {
    const stripeConnect = toRecord(userData['stripeConnect']);
    const accountId =
      normalizeString(userData['stripeAccountId']) ||
      normalizeString(stripeConnect['accountId']);
    if (!accountId) {
      return null;
    }

    const onboardingStatusRaw = normalizeString(stripeConnect['onboardingStatus']).toLowerCase();
    const onboardingStatus: TrainerStripeConnectSummary['onboardingStatus'] =
      onboardingStatusRaw === 'pending' || onboardingStatusRaw === 'complete'
        ? onboardingStatusRaw
        : 'unknown';

    const requirementsCurrentlyDueCount = toInteger(
      stripeConnect['requirementsCurrentlyDueCount']
    );

    return {
      accountId,
      detailsSubmitted: stripeConnect['detailsSubmitted'] === true,
      chargesEnabled: stripeConnect['chargesEnabled'] === true,
      payoutsEnabled: stripeConnect['payoutsEnabled'] === true,
      onboardingStatus,
      requirementsCurrentlyDueCount:
        requirementsCurrentlyDueCount !== null && requirementsCurrentlyDueCount >= 0
          ? requirementsCurrentlyDueCount
          : 0,
      onboardingLinkExpiresAt: toDate(stripeConnect['onboardingLinkExpiresAt']),
      updatedAt: toDate(stripeConnect['updatedAt']),
    };
  }

  private resolveStripeRedirectUrl(path: string): string {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    const browserOrigin = this.getBrowserOrigin();
    if (this.isAllowedRedirectOrigin(browserOrigin)) {
      return `${browserOrigin}${normalizedPath}`;
    }

    const authDomain = normalizeString(environment.firebaseConfig?.authDomain);
    if (authDomain) {
      return `https://${authDomain}${normalizedPath}`;
    }

    return `https://ai-fitness-f8ed4.web.app${normalizedPath}`;
  }

  private getBrowserOrigin(): string {
    if (typeof window === 'undefined') {
      return '';
    }

    return normalizeString(window.location.origin);
  }

  private isAllowedRedirectOrigin(origin: string): boolean {
    if (!origin) {
      return false;
    }

    try {
      const parsed = new URL(origin);
      const isLocalHost = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
      return parsed.protocol === 'https:' || (isLocalHost && parsed.protocol === 'http:');
    } catch {
      return false;
    }
  }

  private resolveUid(userId?: string): string {
    const candidate = normalizeString(userId) || normalizeString(this.auth.currentUser?.uid);
    if (!candidate) {
      throw new Error('You must be logged in to manage trainer payments.');
    }

    return candidate;
  }
}

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function toNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toInteger(value: unknown): number | null {
  const parsed = toNumber(value);
  return parsed === null ? null : Math.trunc(parsed);
}

function toDate(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value : null;
  }

  if (value instanceof Timestamp) {
    return value.toDate();
  }

  const asRecord = toRecord(value);
  const seconds = toNumber(asRecord['seconds']);
  if (seconds !== null) {
    const nanoseconds = toNumber(asRecord['nanoseconds']) ?? 0;
    return new Date(seconds * 1000 + nanoseconds / 1_000_000);
  }

  const millis = toNumber(value);
  if (millis !== null && millis > 0) {
    return new Date(millis);
  }

  return null;
}
