import { Injectable } from '@angular/core';
import { Firestore, doc, getDoc } from '@angular/fire/firestore';
import { AppUser } from '../../models/user.model';
import { trainerProfile } from '../../Interfaces/Profiles/Trainer';
import { clientProfile } from '../../Interfaces/Profiles/client';

export type AccountType = 'trainer' | 'client';
type UserProfile = trainerProfile | clientProfile;

interface CacheEntry<T> {
  fetchedAt: number;
  value: T;
}

@Injectable({
  providedIn: 'root',
})
export class ProfileRepositoryService {
  private static readonly CACHE_TTL_MS = 5 * 60 * 1000;
  private readonly TRAINERS_COLLECTION = 'trainers';
  private readonly CLIENTS_COLLECTION = 'clients';

  private userSummaryCache = new Map<string, CacheEntry<AppUser | null>>();
  private userSummaryPromiseCache = new Map<string, Promise<AppUser | null>>();

  private profileCache = new Map<string, CacheEntry<UserProfile | null>>();
  private profilePromiseCache = new Map<string, Promise<UserProfile | null>>();

  private resolvedProfileCache = new Map<string, CacheEntry<UserProfile | null>>();
  private resolvedProfilePromiseCache = new Map<string, Promise<UserProfile | null>>();

  constructor(private firestore: Firestore) {}

  clear(): void {
    this.userSummaryCache.clear();
    this.userSummaryPromiseCache.clear();
    this.profileCache.clear();
    this.profilePromiseCache.clear();
    this.resolvedProfileCache.clear();
    this.resolvedProfilePromiseCache.clear();
  }

  invalidateUser(userId: string): void {
    const normalizedUserId = this.normalizeUserId(userId);
    if (!normalizedUserId) {
      return;
    }

    this.userSummaryCache.delete(normalizedUserId);
    this.userSummaryPromiseCache.delete(normalizedUserId);

    for (const accountType of ['trainer', 'client'] as const) {
      const key = this.profileKey(normalizedUserId, accountType);
      this.profileCache.delete(key);
      this.profilePromiseCache.delete(key);
    }

    for (const key of [
      this.resolvedProfileKey(normalizedUserId, undefined),
      this.resolvedProfileKey(normalizedUserId, 'trainer'),
      this.resolvedProfileKey(normalizedUserId, 'client'),
    ]) {
      this.resolvedProfileCache.delete(key);
      this.resolvedProfilePromiseCache.delete(key);
    }
  }

  async getUserSummary(userId: string, forceRefresh = false): Promise<AppUser | null> {
    const normalizedUserId = this.normalizeUserId(userId);
    if (!normalizedUserId) {
      return null;
    }

    if (!forceRefresh) {
      const cached = this.userSummaryCache.get(normalizedUserId);
      if (this.isFresh(cached)) {
        return this.cloneAppUser(cached.value);
      }

      const inFlight = this.userSummaryPromiseCache.get(normalizedUserId);
      if (inFlight) {
        return this.cloneAppUser(await inFlight);
      }
    }

    const loadPromise = this.loadUserSummary(normalizedUserId);
    this.userSummaryPromiseCache.set(normalizedUserId, loadPromise);

    try {
      const summary = await loadPromise;
      this.userSummaryCache.set(normalizedUserId, {
        fetchedAt: Date.now(),
        value: summary,
      });
      return this.cloneAppUser(summary);
    } finally {
      this.userSummaryPromiseCache.delete(normalizedUserId);
    }
  }

  async getProfile(
    userId: string,
    accountType: AccountType,
    forceRefresh = false
  ): Promise<UserProfile | null> {
    const normalizedUserId = this.normalizeUserId(userId);
    if (!normalizedUserId) {
      return null;
    }

    const key = this.profileKey(normalizedUserId, accountType);

    if (!forceRefresh) {
      const cached = this.profileCache.get(key);
      if (this.isFresh(cached)) {
        return this.cloneProfile(cached.value);
      }

      const inFlight = this.profilePromiseCache.get(key);
      if (inFlight) {
        return this.cloneProfile(await inFlight);
      }
    }

    const loadPromise = this.loadProfile(normalizedUserId, accountType);
    this.profilePromiseCache.set(key, loadPromise);

    try {
      const profile = await loadPromise;
      this.profileCache.set(key, {
        fetchedAt: Date.now(),
        value: profile,
      });
      return this.cloneProfile(profile);
    } finally {
      this.profilePromiseCache.delete(key);
    }
  }

  async getResolvedProfile(
    userId: string,
    preferredType?: AccountType,
    forceRefresh = false
  ): Promise<UserProfile | null> {
    const normalizedUserId = this.normalizeUserId(userId);
    if (!normalizedUserId) {
      return null;
    }

    const key = this.resolvedProfileKey(normalizedUserId, preferredType);

    if (!forceRefresh) {
      const cached = this.resolvedProfileCache.get(key);
      if (this.isFresh(cached)) {
        return this.cloneProfile(cached.value);
      }

      const inFlight = this.resolvedProfilePromiseCache.get(key);
      if (inFlight) {
        return this.cloneProfile(await inFlight);
      }
    }

    const loadPromise = this.loadResolvedProfile(normalizedUserId, preferredType, forceRefresh);
    this.resolvedProfilePromiseCache.set(key, loadPromise);

    try {
      const profile = await loadPromise;
      this.resolvedProfileCache.set(key, {
        fetchedAt: Date.now(),
        value: profile,
      });
      return this.cloneProfile(profile);
    } finally {
      this.resolvedProfilePromiseCache.delete(key);
    }
  }

  async getResolvedAccountType(
    userId: string,
    preferredType?: AccountType,
    forceRefresh = false
  ): Promise<AccountType | null> {
    const profile = await this.getResolvedProfile(userId, preferredType, forceRefresh);
    if (!profile) {
      return null;
    }

    return profile.accountType;
  }

  private async loadUserSummary(userId: string): Promise<AppUser | null> {
    try {
      const userSnap = await getDoc(doc(this.firestore, 'users', userId));
      if (!userSnap.exists()) {
        return null;
      }

      return {
        userId,
        ...(userSnap.data() as AppUser),
      };
    } catch (error) {
      console.error('[ProfileRepositoryService] Failed to load user summary:', error);
      return null;
    }
  }

  private async loadProfile(userId: string, accountType: AccountType): Promise<UserProfile | null> {
    try {
      const collection = accountType === 'trainer'
        ? this.TRAINERS_COLLECTION
        : this.CLIENTS_COLLECTION;
      const profileSnap = await getDoc(doc(this.firestore, collection, userId));
      if (!profileSnap.exists()) {
        return null;
      }

      const rawProfile = {
        ...(profileSnap.data() as UserProfile),
      };

      return this.mergeWithUserSummary(userId, rawProfile, accountType);
    } catch (error) {
      console.error(`[ProfileRepositoryService] Failed to load ${accountType} profile:`, error);
      return null;
    }
  }

  private async loadResolvedProfile(
    userId: string,
    preferredType?: AccountType,
    forceRefresh = false
  ): Promise<UserProfile | null> {
    const accountTypes: AccountType[] = preferredType
      ? [preferredType, this.otherAccountType(preferredType)]
      : ['trainer', 'client'];

    for (const accountType of accountTypes) {
      const profile = await this.getProfile(userId, accountType, forceRefresh);
      if (profile) {
        return profile;
      }
    }

    return null;
  }

  private async mergeWithUserSummary(
    userId: string,
    profile: UserProfile,
    accountType: AccountType
  ): Promise<UserProfile> {
    const merged = { ...profile } as UserProfile & Record<string, unknown>;
    const needsUserSummary =
      !this.hasValue(merged['firstName']) ||
      !this.hasValue(merged['lastName']) ||
      !this.hasValue(merged['email']) ||
      !this.hasValue(merged['profilepic']);
    const userSummary = needsUserSummary
      ? await this.getUserSummary(userId)
      : null;

    if (!this.hasValue(merged['id'])) {
      merged['id'] = userId;
    }

    if (!this.hasValue(merged['firstName']) && userSummary?.firstName) {
      merged['firstName'] = userSummary.firstName;
    }

    if (!this.hasValue(merged['lastName']) && userSummary?.lastName) {
      merged['lastName'] = userSummary.lastName;
    }

    if (!this.hasValue(merged['email']) && userSummary?.email) {
      merged['email'] = userSummary.email;
    }

    if (!this.hasValue(merged['profilepic']) && userSummary?.profilepic) {
      merged['profilepic'] = userSummary.profilepic;
    }

    merged['accountType'] = accountType;
    return merged as UserProfile;
  }

  private isFresh<T>(entry: CacheEntry<T> | undefined): entry is CacheEntry<T> {
    return !!entry && Date.now() - entry.fetchedAt < ProfileRepositoryService.CACHE_TTL_MS;
  }

  private normalizeUserId(userId: string): string {
    return String(userId || '').trim();
  }

  private profileKey(userId: string, accountType: AccountType): string {
    return `${accountType}:${userId}`;
  }

  private resolvedProfileKey(userId: string, preferredType?: AccountType): string {
    return `${preferredType ?? 'resolved'}:${userId}`;
  }

  private otherAccountType(accountType: AccountType): AccountType {
    return accountType === 'trainer' ? 'client' : 'trainer';
  }

  private hasValue(value: unknown): boolean {
    return typeof value === 'string' ? value.trim().length > 0 : value !== null && value !== undefined;
  }

  private cloneAppUser(user: AppUser | null): AppUser | null {
    return user ? { ...user } : null;
  }

  private cloneProfile<T extends UserProfile | null>(profile: T): T {
    if (!profile) {
      return profile;
    }

    const cloned = { ...profile } as UserProfile;
    if ('trainingLocation' in cloned && cloned.trainingLocation) {
      cloned.trainingLocation = { ...cloned.trainingLocation };
    }
    if ('availability' in cloned && cloned.availability) {
      const nextAvailability: Record<string, { start: string; end: string; }[]> = {};
      Object.entries(cloned.availability).forEach(([day, slots]) => {
        nextAvailability[day] = Array.isArray(slots)
          ? slots.map((slot) => ({ ...slot }))
          : [];
      });
      cloned.availability = nextAvailability;
    }
    if ('additionalPhotos' in cloned && Array.isArray(cloned.additionalPhotos)) {
      cloned.additionalPhotos = [...cloned.additionalPhotos];
    }

    return cloned as T;
  }
}
