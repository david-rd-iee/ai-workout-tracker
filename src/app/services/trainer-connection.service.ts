import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  deleteDoc,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
} from '@angular/fire/firestore';
import { getFunctions, httpsCallable } from '@angular/fire/functions';
import { ChatsService } from './chats.service';
import { UserService } from './account/user.service';

export interface TrainerConnectionRequestRecord {
  clientId: string;
  trainerId: string;
  clientName: string;
  trainerName: string;
  clientEmail: string;
  clientProfilepic: string;
  trainerProfilepic: string;
  message: string;
  status: 'pending' | 'accepted' | 'declined';
  createdAt?: unknown;
  updatedAt?: unknown;
  respondedAt?: unknown;
  respondedBy?: string;
}

export interface TrainerRemovalRecord {
  clientId: string;
  trainerId: string;
  clientName: string;
  trainerName: string;
  clientEmail: string;
  reason: string;
  removedAt?: unknown;
  removedBy: 'client' | 'trainer';
}

@Injectable({
  providedIn: 'root',
})
export class TrainerConnectionService {
  private readonly firestore = inject(Firestore);
  private readonly userService = inject(UserService);
  private readonly chatsService = inject(ChatsService);

  readonly fallbackProfileImage = 'assets/user_icons/profilePhoto.svg';

  async submitConnectionRequest(
    clientUid: string,
    trainerUid: string,
    message: string
  ): Promise<void> {
    const normalizedClientUid = String(clientUid || '').trim();
    const normalizedTrainerUid = String(trainerUid || '').trim();
    if (!normalizedClientUid || !normalizedTrainerUid) {
      throw new Error('Missing client or trainer ID.');
    }

    const payload = await this.buildRequestPayload(normalizedClientUid, normalizedTrainerUid, message);
    const timestamp = serverTimestamp();

    await Promise.all([
      setDoc(
        doc(this.firestore, `trainers/${normalizedTrainerUid}/clientRequests/${normalizedClientUid}`),
        {
          ...payload,
          status: 'pending',
          createdAt: timestamp,
          updatedAt: timestamp,
        },
        { merge: true }
      ),
      setDoc(
        doc(this.firestore, `clients/${normalizedClientUid}/trainerRequests/${normalizedTrainerUid}`),
        {
          ...payload,
          status: 'pending',
          createdAt: timestamp,
          updatedAt: timestamp,
          respondedAt: null,
          respondedBy: '',
        },
        { merge: true }
      ),
    ]);
  }

  async cancelConnectionRequest(clientUid: string, trainerUid: string): Promise<void> {
    const normalizedClientUid = String(clientUid || '').trim();
    const normalizedTrainerUid = String(trainerUid || '').trim();
    if (!normalizedClientUid || !normalizedTrainerUid) {
      return;
    }

    await Promise.all([
      deleteDoc(doc(this.firestore, `trainers/${normalizedTrainerUid}/clientRequests/${normalizedClientUid}`)),
      deleteDoc(doc(this.firestore, `clients/${normalizedClientUid}/trainerRequests/${normalizedTrainerUid}`)),
    ]);
  }

  async declineConnectionRequest(trainerUid: string, clientUid: string): Promise<void> {
    const normalizedClientUid = String(clientUid || '').trim();
    const normalizedTrainerUid = String(trainerUid || '').trim();
    if (!normalizedClientUid || !normalizedTrainerUid) {
      return;
    }

    await Promise.all([
      deleteDoc(doc(this.firestore, `trainers/${normalizedTrainerUid}/clientRequests/${normalizedClientUid}`)),
      setDoc(
        doc(this.firestore, `clients/${normalizedClientUid}/trainerRequests/${normalizedTrainerUid}`),
        {
          status: 'declined',
          respondedAt: serverTimestamp(),
          respondedBy: normalizedTrainerUid,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      ),
    ]);
  }

  async acceptConnectionRequest(trainerUid: string, clientUid: string): Promise<void> {
    const normalizedClientUid = String(clientUid || '').trim();
    const normalizedTrainerUid = String(trainerUid || '').trim();
    if (!normalizedClientUid || !normalizedTrainerUid) {
      throw new Error('Missing client or trainer ID.');
    }

    const functions = getFunctions(undefined, 'us-central1');
    const acceptTrainerClientRequest = httpsCallable<
      { clientId: string },
      { trainerId: string; clientId: string; status: string }
    >(functions, 'acceptTrainerClientRequest');
    const result = await acceptTrainerClientRequest({ clientId: normalizedClientUid });

    const acceptedTrainerId = String(result?.data?.trainerId || '').trim();
    const acceptedClientId = String(result?.data?.clientId || '').trim();
    const acceptedStatus = String(result?.data?.status || '').trim().toLowerCase();
    if (
      acceptedTrainerId !== normalizedTrainerUid ||
      acceptedClientId !== normalizedClientUid ||
      acceptedStatus !== 'accepted'
    ) {
      throw new Error('Invalid accept response from server.');
    }

    await this.chatsService.findOrCreateDirectChat(normalizedClientUid, normalizedTrainerUid);
  }

  async removeConnection(clientUid: string, trainerUid: string, reason: string): Promise<void> {
    return this.removeConnectionWithActor(clientUid, trainerUid, reason, 'client');
  }

  async removeConnectionByTrainer(clientUid: string, trainerUid: string, reason: string): Promise<void> {
    return this.removeConnectionWithActor(clientUid, trainerUid, reason, 'trainer');
  }

  private async removeConnectionWithActor(
    clientUid: string,
    trainerUid: string,
    reason: string,
    removedBy: 'client' | 'trainer'
  ): Promise<void> {
    const normalizedClientUid = String(clientUid || '').trim();
    const normalizedTrainerUid = String(trainerUid || '').trim();
    const normalizedReason = String(reason || '').trim();
    if (!normalizedClientUid || !normalizedTrainerUid || !normalizedReason) {
      throw new Error('Missing client, trainer, or removal reason.');
    }

    const [clientSummary, clientProfile, trainerSummary, trainerProfile] = await Promise.all([
      this.userService.getUserSummaryDirectly(normalizedClientUid),
      this.userService.getUserProfileDirectly(normalizedClientUid, 'client'),
      this.userService.getUserSummaryDirectly(normalizedTrainerUid),
      this.userService.getUserProfileDirectly(normalizedTrainerUid, 'trainer'),
    ]);

    const clientSummaryData = clientSummary
      ? (clientSummary as unknown as Record<string, unknown>)
      : {};
    const clientProfileData = clientProfile
      ? (clientProfile as unknown as Record<string, unknown>)
      : {};
    const trainerSummaryData = trainerSummary
      ? (trainerSummary as unknown as Record<string, unknown>)
      : {};
    const trainerProfileData = trainerProfile
      ? (trainerProfile as unknown as Record<string, unknown>)
      : {};

    const clientFirstName =
      this.pickString(clientSummaryData['firstName']) || this.pickString(clientProfileData['firstName']);
    const clientLastName =
      this.pickString(clientSummaryData['lastName']) || this.pickString(clientProfileData['lastName']);
    const trainerFirstName =
      this.pickString(trainerSummaryData['firstName']) || this.pickString(trainerProfileData['firstName']);
    const trainerLastName =
      this.pickString(trainerSummaryData['lastName']) || this.pickString(trainerProfileData['lastName']);

    const removalRecord: TrainerRemovalRecord = {
      clientId: normalizedClientUid,
      trainerId: normalizedTrainerUid,
      clientName: `${clientFirstName} ${clientLastName}`.trim() || 'Client',
      trainerName: `${trainerFirstName} ${trainerLastName}`.trim() || 'Trainer',
      clientEmail:
        this.pickString(clientProfileData['email']) || this.pickString(clientSummaryData['email']),
      reason: normalizedReason,
      removedBy,
      removedAt: serverTimestamp(),
    };

    const removalId = `${normalizedClientUid}_${Date.now()}`;

    await Promise.all([
      deleteDoc(doc(this.firestore, `trainers/${normalizedTrainerUid}/clients/${normalizedClientUid}`)),
      setDoc(
        doc(this.firestore, `users/${normalizedClientUid}`),
        {
          trainerId: '',
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      ),
      setDoc(
        doc(this.firestore, `clients/${normalizedClientUid}`),
        {
          trainerId: '',
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      ),
      setDoc(
        doc(this.firestore, `clients/${normalizedClientUid}/trainerRemovalHistory/${removalId}`),
        removalRecord
      ),
      setDoc(
        doc(this.firestore, `trainers/${normalizedTrainerUid}/clientRemovalHistory/${removalId}`),
        removalRecord
      ),
    ]);
  }

  private async buildRequestPayload(
    clientUid: string,
    trainerUid: string,
    message: string
  ): Promise<TrainerConnectionRequestRecord> {
    const [clientSummary, clientProfile, trainerSummary, trainerProfile] = await Promise.all([
      this.userService.getUserSummaryDirectly(clientUid),
      this.userService.getUserProfileDirectly(clientUid, 'client'),
      this.userService.getUserSummaryDirectly(trainerUid),
      this.userService.getUserProfileDirectly(trainerUid, 'trainer'),
    ]);

    const clientSummaryData = clientSummary
      ? (clientSummary as unknown as Record<string, unknown>)
      : {};
    const clientProfileData = clientProfile
      ? (clientProfile as unknown as Record<string, unknown>)
      : {};
    const trainerSummaryData = trainerSummary
      ? (trainerSummary as unknown as Record<string, unknown>)
      : {};
    const trainerProfileData = trainerProfile
      ? (trainerProfile as unknown as Record<string, unknown>)
      : {};

    const clientFirstName =
      this.pickString(clientSummaryData['firstName']) || this.pickString(clientProfileData['firstName']);
    const clientLastName =
      this.pickString(clientSummaryData['lastName']) || this.pickString(clientProfileData['lastName']);
    const trainerFirstName =
      this.pickString(trainerSummaryData['firstName']) || this.pickString(trainerProfileData['firstName']);
    const trainerLastName =
      this.pickString(trainerSummaryData['lastName']) || this.pickString(trainerProfileData['lastName']);

    return {
      clientId: clientUid,
      trainerId: trainerUid,
      clientName: `${clientFirstName} ${clientLastName}`.trim() || 'Client',
      trainerName: `${trainerFirstName} ${trainerLastName}`.trim() || 'Trainer',
      clientEmail:
        this.pickString(clientProfileData['email']) || this.pickString(clientSummaryData['email']),
      clientProfilepic:
        this.pickString(clientSummaryData['profilepic']) ||
        this.pickString(clientSummaryData['profileImage']) ||
        this.pickString(clientProfileData['profilepic']) ||
        this.pickString(clientProfileData['profileImage']) ||
        this.fallbackProfileImage,
      trainerProfilepic:
        this.pickString(trainerSummaryData['profilepic']) ||
        this.pickString(trainerSummaryData['profileImage']) ||
        this.pickString(trainerProfileData['profilepic']) ||
        this.pickString(trainerProfileData['profileImage']) ||
        this.fallbackProfileImage,
      message: String(message || '').trim(),
      status: 'pending',
    };
  }

  private pickString(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
  }
}
