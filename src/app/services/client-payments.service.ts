import { Injectable, inject } from '@angular/core';
import { Auth } from '@angular/fire/auth';
import {
  Firestore,
  collectionGroup,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
} from '@angular/fire/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { AgreementPaymentInterval, AgreementPaymentStatus, AgreementPaymentType, AgreementStatus } from '../Interfaces/Agreement';

export interface ClientAgreementPricingSummary {
  agreementId: string;
  agreementName: string;
  trainerId: string;
  trainerName: string;
  status: string;
  paymentStatus: AgreementPaymentStatus;
  amountCents: number;
  currency: 'usd';
  type: AgreementPaymentType;
  interval?: AgreementPaymentInterval;
  description: string;
  dateUpdated: Date;
}

export interface ClientTrainerPaymentContext {
  clientId: string;
  trainerId: string;
  trainerName: string;
  currentAgreementPricing: ClientAgreementPricingSummary | null;
}

interface CreateAgreementCheckoutSessionRequest {
  agreementId: string;
}

interface CreateAgreementCheckoutSessionResponse {
  url: string;
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
    const trainerId = await this.resolveClientAssignedTrainerId(
      clientId,
      clientUserData,
      clientProfileData
    );
    if (!trainerId) {
      throw new Error('You need an assigned trainer before making payments.');
    }

    const [trainerUserSnap, trainerProfileSnap, agreementsSnapshot] = await Promise.all([
      getDoc(doc(this.firestore, `users/${trainerId}`)),
      getDoc(doc(this.firestore, `trainers/${trainerId}`)),
      this.readClientAgreements(clientId),
    ]);

    const trainerUserData = trainerUserSnap.exists() ? toRecord(trainerUserSnap.data()) : {};
    const trainerProfileData = trainerProfileSnap.exists() ? toRecord(trainerProfileSnap.data()) : {};
    const trainerName = this.resolveTrainerName(trainerUserData, trainerProfileData);

    const currentAgreementPricing = agreementsSnapshot
      .map((agreementDoc) => this.mapAgreementPricingRecord(agreementDoc.id, toRecord(agreementDoc.data()), trainerId, trainerName))
      .filter((agreement): agreement is ClientAgreementPricingSummary => agreement !== null)
      .sort((left, right) => right.dateUpdated.getTime() - left.dateUpdated.getTime())[0] ?? null;

    return {
      clientId,
      trainerId,
      trainerName,
      currentAgreementPricing,
    };
  }

  async createAgreementCheckoutSession(agreementId: string): Promise<CreateAgreementCheckoutSessionResponse> {
    const normalizedAgreementId = normalizeString(agreementId);
    if (!normalizedAgreementId) {
      throw new Error('A valid agreement is required.');
    }

    const callable = httpsCallable<CreateAgreementCheckoutSessionRequest, CreateAgreementCheckoutSessionResponse>(
      getFunctions(undefined, 'us-central1'),
      'createAgreementCheckoutSession'
    );

    const response = await callable({
      agreementId: normalizedAgreementId,
    });

    return response.data;
  }

  private async readClientAgreements(clientId: string) {
    try {
      const agreementsSnapshot = await getDocs(
        query(
          collection(this.firestore, 'agreements'),
          where('clientId', '==', clientId)
        )
      );
      return agreementsSnapshot.docs;
    } catch (error) {
      if (isPermissionDeniedError(error)) {
        return [];
      }
      throw error;
    }
  }

  private async resolveClientAssignedTrainerId(
    clientId: string,
    userData: Record<string, unknown>,
    profileData: Record<string, unknown>
  ): Promise<string> {
    const userTrainerId = resolveClientAssignedTrainerId(userData);
    const profileTrainerId = resolveClientAssignedTrainerId(profileData);
    const candidateIds = [profileTrainerId, userTrainerId].filter(Boolean);

    const verifiedTrainerId = await this.resolveTrainerIdFromClientRelationship(clientId, candidateIds);
    if (verifiedTrainerId) {
      return verifiedTrainerId;
    }

    return profileTrainerId || userTrainerId;
  }

  private async resolveTrainerIdFromClientRelationship(
    clientId: string,
    candidateTrainerIds: string[]
  ): Promise<string> {
    try {
      const relationshipSnapshot = await getDocs(
        query(
          collectionGroup(this.firestore, 'clients'),
          where('clientId', '==', clientId)
        )
      );

      if (relationshipSnapshot.empty) {
        return '';
      }

      for (const candidateTrainerId of candidateTrainerIds) {
        const matchedRelationship = relationshipSnapshot.docs.find((relationshipDoc) => {
          const trainerId = relationshipDoc.ref.parent.parent?.id || '';
          return trainerId === candidateTrainerId;
        });

        if (matchedRelationship) {
          return matchedRelationship.ref.parent.parent?.id || '';
        }
      }

      const selectedRelationship = relationshipSnapshot.docs[0];
      return selectedRelationship.ref.parent.parent?.id || '';
    } catch (error) {
      if (isPermissionDeniedError(error)) {
        return '';
      }

      throw error;
    }
  }

  private mapAgreementPricingRecord(
    agreementId: string,
    agreementData: Record<string, unknown>,
    expectedTrainerId: string,
    fallbackTrainerName: string
  ): ClientAgreementPricingSummary | null {
    const trainerId = normalizeString(agreementData['trainerId']);
    if (!trainerId || trainerId !== expectedTrainerId) {
      return null;
    }

    const status = normalizeAgreementStatus(
      agreementData['agreementStatus'] ?? agreementData['status']
    );
    if (!isSignedAgreementStatus(status)) {
      return null;
    }

    const paymentTerms = resolveActivePaymentTermsRecord(agreementData, status);
    const paymentRequired = paymentTerms['required'] === true;
    const amountCents = toPositiveInteger(paymentTerms['amountCents']);
    if (!paymentRequired || amountCents === null) {
      return null;
    }

    const type = normalizePaymentType(paymentTerms['type']);
    if (!type) {
      return null;
    }

    const interval = normalizePaymentInterval(paymentTerms['interval']);
    const paymentStatus = normalizePaymentStatus(agreementData['paymentStatus']);

    return {
      agreementId,
      agreementName: normalizeString(agreementData['name']) || 'Training Agreement',
      trainerId,
      trainerName: normalizeString(agreementData['trainerName']) || fallbackTrainerName,
      status,
      paymentStatus,
      amountCents,
      currency: 'usd',
      type,
      interval: type === 'subscription' ? interval || 'month' : undefined,
      description: normalizeString(paymentTerms['description']) || 'Training services',
      dateUpdated: toDate(agreementData['dateUpdated']),
    };
  }

  private resolveClientUid(): string {
    const uid = normalizeString(this.auth.currentUser?.uid);
    if (!uid) {
      throw new Error('You must be logged in to make trainer payments.');
    }
    return uid;
  }

  private resolveTrainerName(
    trainerUserData: Record<string, unknown>,
    trainerProfileData: Record<string, unknown>
  ): string {
    const displayName =
      normalizeString(trainerUserData['displayName']) ||
      normalizeString(trainerProfileData['displayName']) ||
      normalizeString(trainerUserData['username']) ||
      normalizeString(trainerProfileData['username']);
    if (displayName) {
      return displayName;
    }

    const firstName =
      normalizeString(trainerUserData['firstName']) ||
      normalizeString(trainerProfileData['firstName']);
    const lastName =
      normalizeString(trainerUserData['lastName']) ||
      normalizeString(trainerProfileData['lastName']);

    return `${firstName} ${lastName}`.trim() || 'Assigned Trainer';
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

function toDate(value: unknown): Date {
  if (value instanceof Date) {
    return value;
  }

  if (value && typeof value === 'object' && typeof (value as { toDate?: () => Date }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate();
  }

  const parsed = new Date(String(value || ''));
  return Number.isNaN(parsed.getTime()) ? new Date(0) : parsed;
}

function normalizePaymentType(value: unknown): AgreementPaymentType | '' {
  const normalized = normalizeString(value).toLowerCase();
  if (normalized === 'one_time' || normalized === 'subscription') {
    return normalized;
  }

  return '';
}

function normalizePaymentInterval(value: unknown): AgreementPaymentInterval | '' {
  const normalized = normalizeString(value).toLowerCase();
  if (normalized === 'week' || normalized === 'month' || normalized === 'year') {
    return normalized;
  }

  return '';
}

function normalizePaymentStatus(value: unknown): AgreementPaymentStatus {
  const normalized = normalizeString(value).toLowerCase();
  const allowed: AgreementPaymentStatus[] = [
    'not_required',
    'not_started',
    'checkout_started',
    'paid',
    'active',
    'failed',
    'canceled',
  ];
  return allowed.includes(normalized as AgreementPaymentStatus) ?
    normalized as AgreementPaymentStatus :
    'not_started';
}

function normalizeAgreementStatus(value: unknown): AgreementStatus {
  const normalized = normalizeString(value).toLowerCase();
  if (
    normalized === 'signed' ||
    normalized === 'completed' ||
    normalized === 'partially_signed'
  ) {
    return normalized;
  }
  return 'pending';
}

function isSignedAgreementStatus(status: AgreementStatus): boolean {
  return status === 'signed' || status === 'completed' || status === 'partially_signed';
}

function resolveActivePaymentTermsRecord(
  agreementData: Record<string, unknown>,
  status: AgreementStatus
): Record<string, unknown> {
  const activeTerms = toRecord(agreementData['activePaymentTerms']);
  if (Object.keys(activeTerms).length > 0) {
    return activeTerms;
  }

  // Backward compatibility: older signed docs used paymentTerms as the billable terms.
  if (isSignedAgreementStatus(status)) {
    return toRecord(agreementData['paymentTerms'] ?? agreementData['payment_terms']);
  }

  return {};
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
