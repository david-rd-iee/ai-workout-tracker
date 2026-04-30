import { Injectable } from '@angular/core';
import { Firestore } from '@angular/fire/firestore';
import { collection, doc, getDoc, getDocs, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';
import { Observable } from 'rxjs';
import { AppUser } from '../../models/user.model';

export type AccountType = 'trainer' | 'client';
type ProfileTimeSlot = { start: string; end: string };
type ProfileAvailability = Record<string, ProfileTimeSlot[]>;
type ProfileTrainingLocation = {
  remote: boolean;
  inPerson: boolean;
};

export type TrainerProfileCardPatch = {
  firstName?: string;
  lastName?: string;
  profileImage?: string;
  profilePic?: string;
  profilepic?: string;
  specialization?: string;
  experience?: string;
  education?: string;
  description?: string;
  certifications?: string[];
  hourlyRate?: number | null;
  trainingLocation?: ProfileTrainingLocation;
  city?: string;
  state?: string;
  visible?: boolean;
};

export interface UserProfile extends Record<string, unknown> {
  id?: string;
  userId?: string;
  accountType?: AccountType;
  isPT?: boolean;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  profilepic?: string;
  city?: string;
  state?: string;
  zip?: number;
  gclid?: string;
  unreadMessageCount?: number;
  username?: string;
  trainerId?: string;
  trainerGroupID?: string;
  trainingLocation?: ProfileTrainingLocation;
  availability?: ProfileAvailability;
  additionalPhotos?: string[];
  displayBadges?: string[];
}

export type ResolvedAppUser = AppUser &
  Partial<UserProfile> & {
    userId: string;
    accountType?: AccountType;
  };

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
  private userSummaryPatchCache = new Map<string, Partial<AppUser>>();
  private userSummaryListCache: CacheEntry<AppUser[]> | null = null;
  private userSummaryListPromiseCache: Promise<AppUser[]> | null = null;

  private profileCache = new Map<string, CacheEntry<UserProfile | null>>();
  private profilePromiseCache = new Map<string, Promise<UserProfile | null>>();
  private profilePatchCache = new Map<string, Partial<Record<string, unknown>>>();

  private resolvedProfileCache = new Map<string, CacheEntry<UserProfile | null>>();
  private resolvedProfilePromiseCache = new Map<string, Promise<UserProfile | null>>();
  private profileListCache = new Map<AccountType, CacheEntry<UserProfile[]>>();
  private profileListPromiseCache = new Map<AccountType, Promise<UserProfile[]>>();

  constructor(private firestore: Firestore) {}

  clear(): void {
    this.userSummaryCache.clear();
    this.userSummaryPromiseCache.clear();
    this.userSummaryPatchCache.clear();
    this.userSummaryListCache = null;
    this.userSummaryListPromiseCache = null;
    this.profileCache.clear();
    this.profilePromiseCache.clear();
    this.profilePatchCache.clear();
    this.resolvedProfileCache.clear();
    this.resolvedProfilePromiseCache.clear();
    this.profileListCache.clear();
    this.profileListPromiseCache.clear();
  }

  invalidateUser(userId: string): void {
    const normalizedUserId = this.normalizeUserId(userId);
    if (!normalizedUserId) {
      return;
    }

    this.userSummaryCache.delete(normalizedUserId);
    this.userSummaryPromiseCache.delete(normalizedUserId);
    this.userSummaryPatchCache.delete(normalizedUserId);

    for (const accountType of ['trainer', 'client'] as const) {
      const key = this.profileKey(normalizedUserId, accountType);
      this.profileCache.delete(key);
      this.profilePromiseCache.delete(key);
      this.profilePatchCache.delete(key);
    }

    this.clearResolvedProfileCachesForUser(normalizedUserId);
    this.clearUserSummaryList();
    this.clearProfileLists();
  }

  primeUserSummary(userId: string, summary: Partial<AppUser>): void {
    const normalizedUserId = this.normalizeUserId(userId);
    if (!normalizedUserId) {
      return;
    }

    const mergedSummary = this.mergeAppUserData(
      normalizedUserId,
      this.userSummaryCache.get(normalizedUserId)?.value ?? null,
      summary
    );

    this.userSummaryCache.set(normalizedUserId, {
      fetchedAt: Date.now(),
      value: mergedSummary,
    });
    this.userSummaryPatchCache.delete(normalizedUserId);
    this.syncCachedProfilesWithUserSummary(normalizedUserId, mergedSummary);
    this.clearResolvedProfileCachesForUser(normalizedUserId);
    this.clearUserSummaryList();
    this.clearProfileLists();
  }

  applyUserSummaryPatch(userId: string, patch: Partial<AppUser>): void {
    const normalizedUserId = this.normalizeUserId(userId);
    if (!normalizedUserId) {
      return;
    }

    const nextPatch = {
      ...(this.userSummaryPatchCache.get(normalizedUserId) ?? {}),
      ...patch,
      userId: normalizedUserId,
    };
    this.userSummaryPatchCache.set(normalizedUserId, nextPatch);

    const cached = this.userSummaryCache.get(normalizedUserId);
    if (cached) {
      const mergedSummary = this.mergeAppUserData(normalizedUserId, cached.value, nextPatch);
      this.userSummaryCache.set(normalizedUserId, {
        fetchedAt: Date.now(),
        value: mergedSummary,
      });
      this.syncCachedProfilesWithUserSummary(normalizedUserId, mergedSummary);
    }

    this.clearResolvedProfileCachesForUser(normalizedUserId);
    this.clearUserSummaryList();
    this.clearProfileLists();
  }

  primeProfile(
    userId: string,
    accountType: AccountType,
    profile: Partial<Record<string, unknown>>
  ): void {
    const normalizedUserId = this.normalizeUserId(userId);
    if (!normalizedUserId) {
      return;
    }

    const key = this.profileKey(normalizedUserId, accountType);
    const mergedProfile = this.mergeProfileData(
      normalizedUserId,
      accountType,
      this.profileCache.get(key)?.value ?? null,
      profile
    );

    this.profileCache.set(key, {
      fetchedAt: Date.now(),
      value: mergedProfile,
    });
    this.profilePatchCache.delete(key);
    this.clearResolvedProfileCachesForUser(normalizedUserId);
    this.clearProfileLists();
  }

  applyProfilePatch(
    userId: string,
    accountType: AccountType,
    patch: Partial<Record<string, unknown>>
  ): void {
    const normalizedUserId = this.normalizeUserId(userId);
    if (!normalizedUserId) {
      return;
    }

    const key = this.profileKey(normalizedUserId, accountType);
    const nextPatch = {
      ...(this.profilePatchCache.get(key) ?? {}),
      ...patch,
    };
    this.profilePatchCache.set(key, nextPatch);

    const cached = this.profileCache.get(key);
    if (cached) {
      this.profileCache.set(key, {
        fetchedAt: Date.now(),
        value: this.mergeProfileData(normalizedUserId, accountType, cached.value, nextPatch),
      });
    }

    this.clearResolvedProfileCachesForUser(normalizedUserId);
    this.clearProfileLists();
  }

  async updateTrainerProfile(userId: string, patch: TrainerProfileCardPatch): Promise<void> {
    const normalizedUserId = this.normalizeUserId(userId);
    if (!normalizedUserId) {
      throw new Error('Trainer user ID is required.');
    }

    const safePatch: Record<string, unknown> = {};
    const copyString = (field: keyof TrainerProfileCardPatch, target: string) => {
      if (!Object.prototype.hasOwnProperty.call(patch, field)) {
        return;
      }

      const value = patch[field];
      if (typeof value === 'string') {
        safePatch[target] = value.trim();
      }
    };

    copyString('firstName', 'firstName');
    copyString('lastName', 'lastName');
    copyString('specialization', 'specialization');
    copyString('experience', 'experience');
    copyString('education', 'education');
    copyString('description', 'description');
    copyString('city', 'city');
    copyString('state', 'state');

    const profileImage = this.normalizeString(
      patch['profileImage'] ?? patch['profilePic'] ?? patch['profilepic']
    );
    if (profileImage !== null) {
      safePatch['profileImage'] = profileImage;
      safePatch['profilePic'] = profileImage;
      safePatch['profilepic'] = profileImage;
    }

    if (Object.prototype.hasOwnProperty.call(patch, 'certifications')) {
      const certifications = patch['certifications'];
      safePatch['certifications'] = Array.isArray(certifications)
        ? certifications
            .map((value) => this.normalizeString(value))
            .filter((value): value is string => value !== null)
        : [];
    }

    if (Object.prototype.hasOwnProperty.call(patch, 'hourlyRate')) {
      safePatch['hourlyRate'] = this.normalizeOptionalNumber(patch['hourlyRate']);
    }

    if (patch['trainingLocation']) {
      const trainingLocation = patch['trainingLocation'] as ProfileTrainingLocation;
      safePatch['trainingLocation'] = {
        remote: trainingLocation.remote === true,
        inPerson: trainingLocation.inPerson === true,
      };
    }

    if (Object.prototype.hasOwnProperty.call(patch, 'visible') && typeof patch['visible'] === 'boolean') {
      safePatch['visible'] = patch['visible'];
    }

    if (!Object.keys(safePatch).length) {
      return;
    }

    await setDoc(doc(this.firestore, this.TRAINERS_COLLECTION, normalizedUserId), safePatch, {
      merge: true,
    });
    const userMirrorPatch: Record<string, unknown> = {};
    for (const field of ['firstName', 'lastName', 'city', 'state'] as const) {
      if (Object.prototype.hasOwnProperty.call(safePatch, field)) {
        userMirrorPatch[field] = safePatch[field];
      }
    }

    if (Object.prototype.hasOwnProperty.call(safePatch, 'profilepic')) {
      userMirrorPatch['profilepic'] = safePatch['profilepic'];
    }

    if (Object.prototype.hasOwnProperty.call(safePatch, 'profileImage')) {
      userMirrorPatch['profilepic'] = safePatch['profileImage'];
    }

    if (Object.keys(userMirrorPatch).length > 0) {
      userMirrorPatch['updatedAt'] = serverTimestamp();
      await setDoc(doc(this.firestore, 'users', normalizedUserId), userMirrorPatch, {
        merge: true,
      });
    }
    this.applyProfilePatch(normalizedUserId, 'trainer', safePatch);
  }

  observeUserSummary(
    userId: string,
    observer: (userSummary: AppUser | null) => void
  ): () => void {
    const normalizedUserId = this.normalizeUserId(userId);
    if (!normalizedUserId) {
      observer(null);
      return () => undefined;
    }

    const userRef = doc(this.firestore, 'users', normalizedUserId);
    return onSnapshot(
      userRef,
      (snapshot) => {
        if (!snapshot.exists()) {
          this.userSummaryCache.delete(normalizedUserId);
          this.userSummaryPromiseCache.delete(normalizedUserId);
          this.clearResolvedProfileCachesForUser(normalizedUserId);
          this.clearUserSummaryList();
          this.clearProfileLists();
          observer(null);
          return;
        }

        const mergedSummary = this.mergeAppUserData(
          normalizedUserId,
          {
            userId: normalizedUserId,
            ...(snapshot.data() as AppUser),
          },
          this.userSummaryPatchCache.get(normalizedUserId) ?? {}
        );

        this.userSummaryCache.set(normalizedUserId, {
          fetchedAt: Date.now(),
          value: mergedSummary,
        });
        this.userSummaryPatchCache.delete(normalizedUserId);
        this.syncCachedProfilesWithUserSummary(normalizedUserId, mergedSummary);
        this.clearResolvedProfileCachesForUser(normalizedUserId);
        this.clearUserSummaryList();
        this.clearProfileLists();
        observer(this.cloneAppUser(mergedSummary));
      },
      (error) => {
        console.error('[ProfileRepositoryService] Failed to observe user summary:', error);
        observer(this.cloneAppUser(this.userSummaryCache.get(normalizedUserId)?.value ?? null));
      }
    );
  }

  watchUserSummary(userId: string): Observable<AppUser | undefined> {
    return new Observable<AppUser | undefined>((subscriber) => {
      const unsubscribe = this.observeUserSummary(userId, (userSummary) => {
        subscriber.next(userSummary ?? undefined);
      });

      return () => unsubscribe();
    });
  }

  async getResolvedAppUser(
    userId: string,
    preferredType?: AccountType,
    forceRefresh = false
  ): Promise<ResolvedAppUser | null> {
    const normalizedUserId = this.normalizeUserId(userId);
    if (!normalizedUserId) {
      return null;
    }

    const userSummary = await this.getUserSummary(normalizedUserId, forceRefresh);
    const inferredPreferredType =
      preferredType ??
      (userSummary?.isPT === true ? 'trainer' : userSummary?.isPT === false ? 'client' : undefined);
    const profile = await this.getResolvedProfile(normalizedUserId, inferredPreferredType, forceRefresh);

    return this.mergeAppUserAndProfile(normalizedUserId, userSummary, profile);
  }

  async listUserSummaries(forceRefresh = false): Promise<AppUser[]> {
    if (!forceRefresh && this.isFresh(this.userSummaryListCache ?? undefined)) {
      return this.cloneAppUserList(this.userSummaryListCache!.value);
    }

    if (!forceRefresh && this.userSummaryListPromiseCache) {
      return this.cloneAppUserList(await this.userSummaryListPromiseCache);
    }

    const loadPromise = this.loadUserSummaries();
    this.userSummaryListPromiseCache = loadPromise;

    try {
      const userSummaries = await loadPromise;
      this.userSummaryListCache = {
        fetchedAt: Date.now(),
        value: userSummaries,
      };
      return this.cloneAppUserList(userSummaries);
    } finally {
      this.userSummaryListPromiseCache = null;
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
        return this.cloneAppUser(
          this.mergeAppUserData(
            normalizedUserId,
            cached.value,
            this.userSummaryPatchCache.get(normalizedUserId) ?? {}
          )
        );
      }

      const inFlight = this.userSummaryPromiseCache.get(normalizedUserId);
      if (inFlight) {
        return this.cloneAppUser(await inFlight);
      }
    }

    const loadPromise = this.loadUserSummary(normalizedUserId);
    this.userSummaryPromiseCache.set(normalizedUserId, loadPromise);

    try {
      const loadedSummary = await loadPromise;
      const summary = this.mergeAppUserData(
        normalizedUserId,
        loadedSummary,
        this.userSummaryPatchCache.get(normalizedUserId) ?? {}
      );
      this.userSummaryCache.set(normalizedUserId, {
        fetchedAt: Date.now(),
        value: summary,
      });
      this.userSummaryPatchCache.delete(normalizedUserId);
      this.syncCachedProfilesWithUserSummary(normalizedUserId, summary);
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
        return this.cloneProfile(
          this.mergeProfileData(
            normalizedUserId,
            accountType,
            cached.value,
            this.profilePatchCache.get(key) ?? {}
          )
        );
      }

      const inFlight = this.profilePromiseCache.get(key);
      if (inFlight) {
        return this.cloneProfile(await inFlight);
      }
    }

    const loadPromise = this.loadProfile(normalizedUserId, accountType);
    this.profilePromiseCache.set(key, loadPromise);

    try {
      const loadedProfile = await loadPromise;
      const profile = this.mergeProfileData(
        normalizedUserId,
        accountType,
        loadedProfile,
        this.profilePatchCache.get(key) ?? {}
      );
      this.profileCache.set(key, {
        fetchedAt: Date.now(),
        value: profile,
      });
      if (profile) {
        this.profilePatchCache.delete(key);
      }
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

    return profile.accountType ?? null;
  }

  async listProfiles(accountType: AccountType, forceRefresh = false): Promise<UserProfile[]> {
    if (!forceRefresh) {
      const cached = this.profileListCache.get(accountType);
      if (this.isFresh(cached)) {
        return this.cloneProfileList(cached.value);
      }

      const inFlight = this.profileListPromiseCache.get(accountType);
      if (inFlight) {
        return this.cloneProfileList(await inFlight);
      }
    }

    const loadPromise = this.loadProfiles(accountType);
    this.profileListPromiseCache.set(accountType, loadPromise);

    try {
      const profiles = await loadPromise;
      this.profileListCache.set(accountType, {
        fetchedAt: Date.now(),
        value: profiles,
      });
      return this.cloneProfileList(profiles);
    } finally {
      this.profileListPromiseCache.delete(accountType);
    }
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
      if (!this.isPermissionDeniedError(error)) {
        console.error('[ProfileRepositoryService] Failed to load user summary:', error);
      }
      return null;
    }
  }

  private async loadUserSummaries(): Promise<AppUser[]> {
    try {
      const userSnapshot = await getDocs(collection(this.firestore, 'users'));
      const fetchedAt = Date.now();

      return userSnapshot.docs.map((userDoc) => {
        const userSummary = this.mergeAppUserData(
          userDoc.id,
          {
            userId: userDoc.id,
            ...(userDoc.data() as AppUser),
          },
          this.userSummaryPatchCache.get(userDoc.id) ?? {}
        );

        this.userSummaryCache.set(userDoc.id, {
          fetchedAt,
          value: userSummary,
        });
        this.userSummaryPatchCache.delete(userDoc.id);
        this.syncCachedProfilesWithUserSummary(userDoc.id, userSummary);

        return userSummary!;
      });
    } catch (error) {
      console.error('[ProfileRepositoryService] Failed to load user summaries:', error);
      return [];
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
      } as UserProfile & Record<string, unknown>;

      const needsUserSummary =
        !this.hasValue(rawProfile['firstName']) ||
        !this.hasValue(rawProfile['lastName']) ||
        !this.hasValue(rawProfile['email']) ||
        !this.hasValue(rawProfile['profilepic']) ||
        !this.hasValue(rawProfile['username']);
      const userSummary = needsUserSummary ? await this.getUserSummary(userId) : null;
      const preferUserSummary = accountType !== 'trainer';
      return this.applyUserSummaryToProfile(rawProfile, userId, accountType, userSummary, preferUserSummary);
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
    const userSummary = await this.getUserSummary(userId, forceRefresh);
    const inferredPreferredType =
      preferredType ??
      (userSummary?.isPT === true ? 'trainer' : userSummary?.isPT === false ? 'client' : undefined);
    const accountTypes: AccountType[] = inferredPreferredType
      ? [inferredPreferredType, this.otherAccountType(inferredPreferredType)]
      : ['trainer', 'client'];

    for (const accountType of accountTypes) {
      const profile = await this.getProfile(userId, accountType, forceRefresh);
      if (profile) {
        return profile;
      }
    }

    return null;
  }

  private async loadProfiles(accountType: AccountType): Promise<UserProfile[]> {
    try {
      const collectionName = accountType === 'trainer'
        ? this.TRAINERS_COLLECTION
        : this.CLIENTS_COLLECTION;
      const snapshot = await getDocs(collection(this.firestore, collectionName));

      return Promise.all(
        snapshot.docs.map(async (profileDoc) => {
          const rawProfile = {
            ...(profileDoc.data() as UserProfile),
          } as UserProfile & Record<string, unknown>;
          const cachedUserSummary = this.userSummaryCache.get(profileDoc.id)?.value ?? null;
          const needsUserSummary =
            !this.hasValue(rawProfile['firstName']) ||
            !this.hasValue(rawProfile['lastName']) ||
            !this.hasValue(rawProfile['email']) ||
            !this.hasValue(rawProfile['profilepic']) ||
            !this.hasValue(rawProfile['username']);
          const userSummary = cachedUserSummary ?? (needsUserSummary
            ? await this.getUserSummary(profileDoc.id)
            : null);
          const preferUserSummary = accountType !== 'trainer' && !!cachedUserSummary;

          return this.applyUserSummaryToProfile(
            rawProfile,
            profileDoc.id,
            accountType,
            userSummary,
            preferUserSummary
          );
        })
      );
    } catch (error) {
      console.error(`[ProfileRepositoryService] Failed to load ${accountType} profiles:`, error);
      return [];
    }
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

  private normalizeString(value: unknown): string | null {
    if (value === null || value === undefined) {
      return null;
    }

    return String(value).trim();
  }

  private normalizeOptionalNumber(value: unknown): number | null {
    if (value === null || value === undefined) {
      return null;
    }

    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : null;
    }

    const trimmed = String(value).trim();
    if (!trimmed) {
      return null;
    }

    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private firstAvailableString(...values: unknown[]): string {
    for (const value of values) {
      if (typeof value === 'string' && value.trim()) {
        return value.trim();
      }
    }

    return '';
  }

  private isPermissionDeniedError(error: unknown): boolean {
    const code = String((error as { code?: unknown } | null)?.code || '').trim().toLowerCase();
    const message = String((error as { message?: unknown } | null)?.message || '').toLowerCase();
    return code === 'permission-denied' || message.includes('insufficient permissions');
  }

  private clearResolvedProfileCachesForUser(userId: string): void {
    for (const key of [
      this.resolvedProfileKey(userId, undefined),
      this.resolvedProfileKey(userId, 'trainer'),
      this.resolvedProfileKey(userId, 'client'),
    ]) {
      this.resolvedProfileCache.delete(key);
      this.resolvedProfilePromiseCache.delete(key);
    }
  }

  private clearProfileLists(): void {
    this.profileListCache.clear();
    this.profileListPromiseCache.clear();
  }

  private clearUserSummaryList(): void {
    this.userSummaryListCache = null;
    this.userSummaryListPromiseCache = null;
  }

  private mergeAppUserData(
    userId: string,
    base: AppUser | null,
    patch: Partial<AppUser>
  ): AppUser | null {
    if (!base && !Object.keys(patch).length) {
      return null;
    }

    return {
      ...(base ?? { isPT: false }),
      ...patch,
      userId,
    };
  }

  private mergeProfileData(
    userId: string,
    accountType: AccountType,
    base: UserProfile | null,
    patch: Partial<Record<string, unknown>>
  ): UserProfile | null {
    if (!base && !Object.keys(patch).length) {
      return null;
    }

    const merged = {
      ...((base ?? {}) as Record<string, unknown>),
      ...patch,
    } as UserProfile & Record<string, unknown>;
    const userSummary = this.userSummaryCache.get(userId)?.value ?? null;
    return this.applyUserSummaryToProfile(merged, userId, accountType, userSummary, true);
  }

  private applyUserSummaryToProfile(
    profile: UserProfile | (UserProfile & Record<string, unknown>),
    userId: string,
    accountType: AccountType,
    userSummary: AppUser | null,
    preferUserSummary: boolean
  ): UserProfile {
    const merged = { ...(profile as Record<string, unknown>) };

    if (!this.hasValue(merged['id'])) {
      merged['id'] = userId;
    }

    if (preferUserSummary && userSummary?.firstName) {
      merged['firstName'] = userSummary.firstName;
    } else if (!this.hasValue(merged['firstName']) && userSummary?.firstName) {
      merged['firstName'] = userSummary.firstName;
    }

    if (preferUserSummary && userSummary?.lastName) {
      merged['lastName'] = userSummary.lastName;
    } else if (!this.hasValue(merged['lastName']) && userSummary?.lastName) {
      merged['lastName'] = userSummary.lastName;
    }

    if (preferUserSummary && userSummary?.email) {
      merged['email'] = userSummary.email;
    } else if (!this.hasValue(merged['email']) && userSummary?.email) {
      merged['email'] = userSummary.email;
    }

    if (preferUserSummary && userSummary?.phone) {
      merged['phone'] = userSummary.phone;
    } else if (!this.hasValue(merged['phone']) && userSummary?.phone) {
      merged['phone'] = userSummary.phone;
    }

    if (preferUserSummary && userSummary?.displayName) {
      merged['displayName'] = userSummary.displayName;
    } else if (!this.hasValue(merged['displayName']) && userSummary?.displayName) {
      merged['displayName'] = userSummary.displayName;
    }

    if (preferUserSummary && userSummary?.profilepic) {
      merged['profilepic'] = userSummary.profilepic;
    } else if (!this.hasValue(merged['profilepic']) && userSummary?.profilepic) {
      merged['profilepic'] = userSummary.profilepic;
    }

    const preferredImage = this.firstAvailableString(
      merged['profileImage'],
      merged['profilePic'],
      merged['profilepic']
    );
    if (preferredImage) {
      if (!this.hasValue(merged['profileImage'])) {
        merged['profileImage'] = preferredImage;
      }
      if (!this.hasValue(merged['profilePic'])) {
        merged['profilePic'] = preferredImage;
      }
      if (!this.hasValue(merged['profilepic'])) {
        merged['profilepic'] = preferredImage;
      }
    }

    if (preferUserSummary && userSummary?.username) {
      merged['username'] = userSummary.username;
    } else if (!this.hasValue(merged['username']) && userSummary?.username) {
      merged['username'] = userSummary.username;
    }

    if (preferUserSummary && this.hasValue(userSummary?.trainerId)) {
      merged['trainerId'] = userSummary?.trainerId;
    } else if (!this.hasValue(merged['trainerId']) && this.hasValue(userSummary?.trainerId)) {
      merged['trainerId'] = userSummary?.trainerId;
    }

    if (preferUserSummary && this.hasValue(userSummary?.demoMode)) {
      merged['demoMode'] = userSummary?.demoMode === true;
    } else if (!this.hasValue(merged['demoMode']) && this.hasValue(userSummary?.demoMode)) {
      merged['demoMode'] = userSummary?.demoMode === true;
    }

    if (preferUserSummary && this.hasValue(userSummary?.role)) {
      merged['role'] = userSummary?.role;
    } else if (!this.hasValue(merged['role']) && this.hasValue(userSummary?.role)) {
      merged['role'] = userSummary?.role;
    }

    if (preferUserSummary && this.hasValue(userSummary?.fitnessLevel)) {
      merged['fitnessLevel'] = userSummary?.fitnessLevel;
    } else if (!this.hasValue(merged['fitnessLevel']) && this.hasValue(userSummary?.fitnessLevel)) {
      merged['fitnessLevel'] = userSummary?.fitnessLevel;
    }

    if (preferUserSummary && this.hasValue(userSummary?.goal)) {
      merged['goal'] = userSummary?.goal;
    } else if (!this.hasValue(merged['goal']) && this.hasValue(userSummary?.goal)) {
      merged['goal'] = userSummary?.goal;
    }

    merged['accountType'] = accountType;
    return merged as unknown as UserProfile;
  }

  private mergeAppUserAndProfile(
    userId: string,
    userSummary: AppUser | null,
    profile: UserProfile | null
  ): ResolvedAppUser | null {
    if (!userSummary && !profile) {
      return null;
    }

    const merged = {
      ...(userSummary ?? {}),
      ...((profile as unknown as Record<string, unknown>) ?? {}),
      userId,
    } as Record<string, unknown>;

    if (profile) {
      merged['accountType'] = profile.accountType;
      merged['isPT'] = profile.accountType === 'trainer';
    } else if (typeof userSummary?.isPT === 'boolean') {
      merged['accountType'] = userSummary.isPT ? 'trainer' : 'client';
      merged['isPT'] = userSummary.isPT;
    }

    if (userSummary?.firstName) {
      merged['firstName'] = userSummary.firstName;
    }

    if (userSummary?.lastName) {
      merged['lastName'] = userSummary.lastName;
    }

    if (userSummary?.email) {
      merged['email'] = userSummary.email;
    }

    if (userSummary?.profilepic) {
      merged['profilepic'] = userSummary.profilepic;
    }

    if (userSummary?.username) {
      merged['username'] = userSummary.username;
    }

    if (userSummary?.displayName) {
      merged['displayName'] = userSummary.displayName;
    }

    if (this.hasValue(userSummary?.trainerId)) {
      merged['trainerId'] = userSummary?.trainerId;
    }

    if (typeof userSummary?.demoMode === 'boolean') {
      merged['demoMode'] = userSummary.demoMode;
    }

    if (userSummary?.role) {
      merged['role'] = userSummary.role;
    }

    if (userSummary?.fitnessLevel) {
      merged['fitnessLevel'] = userSummary.fitnessLevel;
    }

    if (userSummary?.goal) {
      merged['goal'] = userSummary.goal;
    }

    if (typeof merged['isPT'] !== 'boolean') {
      merged['isPT'] = false;
    }

    return merged as unknown as ResolvedAppUser;
  }

  private syncCachedProfilesWithUserSummary(userId: string, userSummary: AppUser | null): void {
    for (const accountType of ['trainer', 'client'] as const) {
      const key = this.profileKey(userId, accountType);
      const cached = this.profileCache.get(key);
      if (!cached?.value) {
        continue;
      }

      this.profileCache.set(key, {
        fetchedAt: Date.now(),
        value: this.applyUserSummaryToProfile(
          cached.value,
          userId,
          accountType,
          userSummary,
          true
        ),
      });
    }
  }

  private cloneAppUser(user: AppUser | null): AppUser | null {
    return user ? { ...user } : null;
  }

  private cloneAppUserList(users: AppUser[]): AppUser[] {
    return users.map((user) => this.cloneAppUser(user)!).filter((user): user is AppUser => !!user);
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

  private cloneProfileList(profiles: UserProfile[]): UserProfile[] {
    return profiles.map((profile) => this.cloneProfile(profile)!);
  }
}
