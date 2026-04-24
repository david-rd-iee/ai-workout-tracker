import { Injectable, inject } from '@angular/core';
import { Auth } from '@angular/fire/auth';
import {
  Firestore,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
} from '@angular/fire/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { environment } from '../../environments/environment';

export type ClientTrainerPlanBillingType = 'weekly' | 'monthly' | 'quarterly' | 'yearly';

export interface ClientTrainerPlan {
  planId: string;
  trainerId: string;
  title: string;
  description: string;
  priceCents: number;
  billingType: ClientTrainerPlanBillingType;
  isActive: boolean;
}

export interface ClientTrainerPaymentContext {
  clientId: string;
  trainerId: string;
  trainerName: string;
  plans: ClientTrainerPlan[];
}

interface CreateCheckoutSessionRequest {
  planId: string;
  successUrl: string;
  cancelUrl: string;
}

export interface CreateCheckoutSessionResponse {
  sessionId: string;
  checkoutUrl: string;
}

@Injectable({ providedIn: 'root' })
export class ClientPaymentsService {
  private readonly auth = inject(Auth);
  private readonly firestore = inject(Firestore);

  async getPaymentContext(): Promise<ClientTrainerPaymentContext> {
    const clientId = this.resolveClientUid();
    const [clientUserSnap, clientProfileSnap] = await Promise.all([
      getDoc(doc(this.firestore, `users/${clientId}`)),
      getDoc(doc(this.firestore, `clients/${clientId}`)),
    ]);

    if (!clientUserSnap.exists()) {
      throw new Error('Client profile not found.');
    }

    const clientUserData = toRecord(clientUserSnap.data());
    const clientProfileData = clientProfileSnap.exists() ? toRecord(clientProfileSnap.data()) : {};
    const trainerId =
      resolveClientAssignedTrainerId(clientUserData) ||
      resolveClientAssignedTrainerId(clientProfileData);
    if (!trainerId) {
      throw new Error('You need an assigned trainer before making payments.');
    }

    const [trainerSnap, directPlanSnap] = await Promise.all([
      getDoc(doc(this.firestore, `trainers/${trainerId}`)),
      this.readDirectTrainerPlan(trainerId),
    ]);

    const trainerData = trainerSnap.exists() ? toRecord(trainerSnap.data()) : {};
    const trainerFirstName = normalizeString(trainerData['firstName']);
    const trainerLastName = normalizeString(trainerData['lastName']);
    const trainerName = `${trainerFirstName} ${trainerLastName}`.trim() || 'Assigned Trainer';

    const directPlan = directPlanSnap?.exists() ?
      this.mapPlanRecord(directPlanSnap.id, toRecord(directPlanSnap.data()), trainerId) :
      null;
    const queryPlanDocs = directPlan ?
      [] :
      await this.readTrainerPlanFallbackDocs(trainerId);
    const queryPlans = queryPlanDocs
      .filter((docSnap) => docSnap.id !== trainerId)
      .map((docSnap) => this.mapPlanRecord(docSnap.id, toRecord(docSnap.data()), trainerId));
    const plans = (directPlan ? [directPlan] : queryPlans)
      .filter((plan): plan is ClientTrainerPlan => plan !== null && plan.isActive)
      .sort((left, right) => left.priceCents - right.priceCents);

    return {
      clientId,
      trainerId,
      trainerName,
      plans,
    };
  }

  async createCheckoutSession(planId: string): Promise<CreateCheckoutSessionResponse> {
    const normalizedPlanId = normalizeString(planId);
    if (!normalizedPlanId) {
      throw new Error('A valid plan is required.');
    }

    const successUrl = this.resolveRedirectUrl('/client-payments?checkout=success');
    const cancelUrl = this.resolveRedirectUrl('/client-payments?checkout=cancel');
    const callable = httpsCallable<CreateCheckoutSessionRequest, CreateCheckoutSessionResponse>(
      getFunctions(undefined, 'us-central1'),
      'createCheckoutSession'
    );

    const response = await callable({
      planId: normalizedPlanId,
      successUrl,
      cancelUrl,
    });

    return response.data;
  }

  private mapPlanRecord(
    planId: string,
    planData: Record<string, unknown>,
    expectedTrainerId: string
  ): ClientTrainerPlan | null {
    const trainerId = normalizeString(planData['trainerId']) || normalizeString(planData['trainerID']);
    const title = normalizeString(planData['title']);
    const description = normalizeString(planData['description']);
    const billingType = normalizeBillingType(planData['billingType']);
    const priceCents = toPositiveInteger(planData['priceCents']);
    const isActive = planData['isActive'] !== false;

    if (
      !trainerId ||
      trainerId !== expectedTrainerId ||
      !title ||
      !description ||
      !billingType ||
      priceCents === null
    ) {
      return null;
    }

    return {
      planId: normalizeString(planData['planId']) || planId,
      trainerId,
      title,
      description,
      priceCents,
      billingType,
      isActive,
    };
  }

  private resolveRedirectUrl(path: string): string {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    const browserOrigin = normalizeString(typeof window !== 'undefined' ? window.location.origin : '');
    if (isAllowedRedirectOrigin(browserOrigin)) {
      return `${browserOrigin}${normalizedPath}`;
    }

    const authDomain = normalizeString(environment.firebaseConfig?.authDomain);
    if (authDomain) {
      return `https://${authDomain}${normalizedPath}`;
    }

    return `https://ai-fitness-f8ed4.web.app${normalizedPath}`;
  }

  private resolveClientUid(): string {
    const uid = normalizeString(this.auth.currentUser?.uid);
    if (!uid) {
      throw new Error('You must be logged in to make trainer payments.');
    }
    return uid;
  }

  private async readDirectTrainerPlan(trainerId: string) {
    try {
      return await getDoc(doc(this.firestore, `trainerPlans/${trainerId}`));
    } catch (error) {
      if (isPermissionDeniedError(error)) {
        return null;
      }
      throw error;
    }
  }

  private async readTrainerPlanFallbackDocs(trainerId: string) {
    const primaryPlans = await this.readTrainerPlanDocsByField(trainerId, 'trainerId');
    if (primaryPlans.length > 0) {
      return primaryPlans;
    }

    return this.readTrainerPlanDocsByField(trainerId, 'trainerID');
  }

  private async readTrainerPlanDocsByField(
    trainerId: string,
    fieldName: 'trainerId' | 'trainerID'
  ) {
    try {
      const trainerPlansSnap = await getDocs(
        query(
          collection(this.firestore, 'trainerPlans'),
          where(fieldName, '==', trainerId)
        )
      );
      return trainerPlansSnap.docs;
    } catch (error) {
      if (isPermissionDeniedError(error)) {
        return [];
      }
      throw error;
    }
  }
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function toPositiveInteger(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  const rounded = Math.trunc(parsed);
  return rounded > 0 ? rounded : null;
}

function normalizeBillingType(value: unknown): ClientTrainerPlanBillingType | '' {
  const normalized = normalizeString(value).toLowerCase();
  const allowed: ClientTrainerPlanBillingType[] = ['weekly', 'monthly', 'quarterly', 'yearly'];
  return allowed.includes(normalized as ClientTrainerPlanBillingType) ?
    normalized as ClientTrainerPlanBillingType :
    '';
}

function isAllowedRedirectOrigin(origin: string): boolean {
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

function resolveClientAssignedTrainerId(clientData: Record<string, unknown>): string {
  return normalizeString(clientData['trainerID']) || normalizeString(clientData['trainerId']);
}

function isPermissionDeniedError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const code = String((error as { code?: unknown }).code || '').trim().toLowerCase();
  if (code === 'permission-denied' || code === 'firestore/permission-denied') {
    return true;
  }

  const message = String((error as { message?: unknown }).message || '').toLowerCase();
  return message.includes('missing or insufficient permissions');
}
