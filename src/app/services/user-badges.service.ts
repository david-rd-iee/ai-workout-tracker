import { Injectable, Signal, signal } from '@angular/core';
import { Firestore } from '@angular/fire/firestore';
import { ToastController } from '@ionic/angular';
import { Observable } from 'rxjs';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import {
  ACHIEVEMENT_BADGES,
  BadgeLevel,
  calculateBadgeLevel,
  calculateProgressToNextTier,
} from '../interfaces/Badge';
import {
  calculateStatueOutput,
  calculateStoredStatueLevel,
  getNextStatueLevel,
  getStatueLevelNumber,
  normalizeStatueLevel,
  StoredStatueLevel,
} from '../models/greek-statue.model';
import {
  UserBadgeLevel,
  UserBadgeStatDoc,
  UserBadgeStatsMap,
} from '../models/user-badges.model';
import { GreekStatuesService } from './greek-statues.service';

interface CacheEntry<T> {
  fetchedAt: number;
  value: T;
}

type WriteResult =
  | { ok: true }
  | { ok: false; error: unknown };

@Injectable({
  providedIn: 'root',
})
export class UserBadgesService {
  private static readonly CACHE_TTL_MS = 5 * 60 * 1000;
  private static readonly USER_STATS_COLLECTION = 'userStats';
  private static readonly USER_BADGES_SUBCOLLECTION = 'Badges';
  private static readonly GREEK_STATUES_COLLECTION = 'GreekStatues';
  private static readonly BADGE_LEVELS: BadgeLevel[] = [
    'bronze',
    'silver',
    'gold',
    'platinum',
    'diamond',
    'master',
  ];

  private readonly userBadgesCache = new Map<string, CacheEntry<UserBadgeStatsMap | null>>();
  private readonly userBadgesPromiseCache = new Map<string, Promise<UserBadgeStatsMap | null>>();
  private readonly activeStatueSyncs = new Map<string, Promise<void>>();
  private readonly pendingStatueSyncs = new Map<string, boolean>();
  private readonly currentUserBadges = signal<UserBadgeStatsMap | null>(null);

  private currentUserId: string | null = null;
  private currentUserUnsubscribe: (() => void) | null = null;
  private currentUserStatueSyncUnsubscribe: (() => void) | null = null;

  constructor(
    private readonly firestore: Firestore,
    private readonly greekStatuesService: GreekStatuesService,
    private readonly toastController: ToastController
  ) {}

  getCurrentUserBadges(): Signal<UserBadgeStatsMap | null> {
    return this.currentUserBadges;
  }

  async syncStatueBadges(userId: string, notifyLevelUps = false): Promise<void> {
    const normalizedUserId = String(userId ?? '').trim();
    if (!normalizedUserId) {
      return;
    }

    await this.scheduleStatueSync(normalizedUserId, notifyLevelUps);
  }

  async initializeCurrentUserBadges(
    userId: string,
    forceRefresh = false
  ): Promise<UserBadgeStatsMap | null> {
    const normalizedUserId = String(userId ?? '').trim();
    if (!normalizedUserId) {
      this.clear();
      return null;
    }

    await this.syncStatueBadges(normalizedUserId, false);

    const userBadges = await this.getUserBadges(normalizedUserId, forceRefresh);
    this.currentUserBadges.set(this.cloneUserBadges(userBadges));
    this.ensureCurrentUserListener(normalizedUserId);
    this.ensureCurrentUserStatueSync(normalizedUserId);
    return this.cloneUserBadges(userBadges);
  }

  async getUserBadges(userId: string, forceRefresh = false): Promise<UserBadgeStatsMap | null> {
    const normalizedUserId = String(userId ?? '').trim();
    if (!normalizedUserId) {
      return null;
    }

    if (!forceRefresh) {
      const cached = this.userBadgesCache.get(normalizedUserId);
      if (this.isFresh(cached)) {
        return this.cloneUserBadges(cached.value);
      }

      const inFlight = this.userBadgesPromiseCache.get(normalizedUserId);
      if (inFlight) {
        return this.cloneUserBadges(await inFlight);
      }
    }

    const loadPromise = this.loadUserBadges(normalizedUserId);
    this.userBadgesPromiseCache.set(normalizedUserId, loadPromise);

    try {
      const userBadges = await loadPromise;
      this.setCachedUserBadges(normalizedUserId, userBadges);
      if (this.currentUserId === normalizedUserId) {
        this.currentUserBadges.set(this.cloneUserBadges(userBadges));
      }
      return this.cloneUserBadges(userBadges);
    } finally {
      this.userBadgesPromiseCache.delete(normalizedUserId);
    }
  }

  clear(): void {
    this.currentUserUnsubscribe?.();
    this.currentUserUnsubscribe = null;
    this.currentUserStatueSyncUnsubscribe?.();
    this.currentUserStatueSyncUnsubscribe = null;
    this.currentUserId = null;
    this.currentUserBadges.set(null);
    this.userBadgesCache.clear();
    this.userBadgesPromiseCache.clear();
    this.activeStatueSyncs.clear();
    this.pendingStatueSyncs.clear();
  }

  observeUserBadges(
    userId: string,
    observer: (userBadges: UserBadgeStatsMap | null) => void
  ): () => void {
    const normalizedUserId = String(userId ?? '').trim();
    if (!normalizedUserId) {
      observer(null);
      return () => undefined;
    }

    const badgesRef = this.getUserBadgesCollectionRef(normalizedUserId);
    return onSnapshot(
      badgesRef,
      (snapshot) => {
        const userBadges = this.normalizeBadgeDocs(
          normalizedUserId,
          snapshot.docs.map((docSnap) => ({ id: docSnap.id, data: docSnap.data() }))
        );

        this.setCachedUserBadges(normalizedUserId, userBadges);
        if (this.currentUserId === normalizedUserId) {
          this.currentUserBadges.set(this.cloneUserBadges(userBadges));
        }
        observer(this.cloneUserBadges(userBadges));
      },
      (error) => {
        console.error('[UserBadgesService] Failed to observe badges collection:', error);
        observer(this.cloneUserBadges(this.userBadgesCache.get(normalizedUserId)?.value ?? null));
      }
    );
  }

  watchUserBadges(userId: string): Observable<UserBadgeStatsMap | null> {
    return new Observable<UserBadgeStatsMap | null>((subscriber) => {
      const unsubscribe = this.observeUserBadges(userId, (userBadges) => {
        subscriber.next(userBadges);
      });

      return () => unsubscribe();
    });
  }

  async saveDisplayStatues(userId: string, displayStatueIds: string[]): Promise<void> {
    const normalizedUserId = String(userId ?? '').trim();
    if (!normalizedUserId) {
      throw new Error('User ID is required to save display statues.');
    }

    await this.syncStatueBadges(normalizedUserId, false);

    const selectedStatueIds = new Set(
      (displayStatueIds ?? [])
        .map((id) => String(id ?? '').trim())
        .filter((id) => id.length > 0)
    );
    const statues = await this.greekStatuesService.getGreekStatues();
    const currentUserBadges = await this.getUserBadges(normalizedUserId, true);
    const nextUserBadges: UserBadgeStatsMap = {
      ...(currentUserBadges ?? {}),
    };

    await Promise.all(
      statues.map(async (statue) => {
        const currentEntry = currentUserBadges?.[statue.id];
        if (!currentEntry) {
          return;
        }

        const nextEntry: UserBadgeStatDoc = {
          ...currentEntry,
          isDisplayed: selectedStatueIds.has(statue.id),
        };
        nextUserBadges[statue.id] = nextEntry;
        await this.saveUserBadgeDoc(normalizedUserId, statue.id, nextEntry);
      })
    );

    this.setCachedUserBadges(normalizedUserId, nextUserBadges);
    if (this.currentUserId === normalizedUserId) {
      this.currentUserBadges.set(this.cloneUserBadges(nextUserBadges));
    }
  }

  private ensureCurrentUserListener(userId: string): void {
    const normalizedUserId = String(userId ?? '').trim();
    if (!normalizedUserId) {
      return;
    }

    if (this.currentUserId === normalizedUserId && this.currentUserUnsubscribe) {
      return;
    }

    this.currentUserUnsubscribe?.();
    this.currentUserId = normalizedUserId;
    this.currentUserUnsubscribe = this.observeUserBadges(normalizedUserId, () => undefined);
  }

  private ensureCurrentUserStatueSync(userId: string): void {
    const normalizedUserId = String(userId ?? '').trim();
    if (!normalizedUserId) {
      return;
    }

    this.currentUserStatueSyncUnsubscribe?.();

    const statsUnsubscribe = onSnapshot(
      doc(this.firestore, UserBadgesService.USER_STATS_COLLECTION, normalizedUserId),
      () => {
        void this.syncStatueBadges(normalizedUserId, true);
      },
      (error) => {
        console.error('[UserBadgesService] Failed to observe userStats for statue sync:', error);
      }
    );

    const statuesUnsubscribe = onSnapshot(
      collection(this.firestore, UserBadgesService.GREEK_STATUES_COLLECTION),
      () => {
        void this.syncStatueBadges(normalizedUserId, true);
      },
      (error) => {
        console.error('[UserBadgesService] Failed to observe GreekStatues for statue sync:', error);
      }
    );

    this.currentUserStatueSyncUnsubscribe = () => {
      statsUnsubscribe();
      statuesUnsubscribe();
    };
  }

  private async scheduleStatueSync(userId: string, notifyLevelUps: boolean): Promise<void> {
    const normalizedUserId = String(userId ?? '').trim();
    if (!normalizedUserId) {
      return;
    }

    const activeSync = this.activeStatueSyncs.get(normalizedUserId);
    if (activeSync) {
      const pendingNotification = this.pendingStatueSyncs.get(normalizedUserId) ?? false;
      this.pendingStatueSyncs.set(normalizedUserId, pendingNotification || notifyLevelUps);
      await activeSync;
      return;
    }

    const syncPromise = this.performStatueSync(normalizedUserId, notifyLevelUps).finally(async () => {
      this.activeStatueSyncs.delete(normalizedUserId);
      const queuedNotifyLevelUps = this.pendingStatueSyncs.get(normalizedUserId);
      if (queuedNotifyLevelUps !== undefined) {
        this.pendingStatueSyncs.delete(normalizedUserId);
        await this.scheduleStatueSync(normalizedUserId, queuedNotifyLevelUps);
      }
    });

    this.activeStatueSyncs.set(normalizedUserId, syncPromise);
    await syncPromise;
  }

  private async performStatueSync(userId: string, notifyLevelUps: boolean): Promise<void> {
    try {
      const [statues, userStatsSnap, badgeSnapshot, allUserStatsSnapshot] = await Promise.all([
        this.greekStatuesService.getGreekStatues(true),
        getDoc(doc(this.firestore, UserBadgesService.USER_STATS_COLLECTION, userId)),
        getDocs(this.getUserBadgesCollectionRef(userId)),
        getDocs(collection(this.firestore, UserBadgesService.USER_STATS_COLLECTION)),
      ]);

      if (statues.length === 0) {
        console.warn(
          '[UserBadgesService] Statue sync skipped because no GreekStatues docs were available.'
        );
        return;
      }

      const greekStatueIds = new Set(statues.map((statue) => statue.id));
      const achievementBadgeIds = new Set(ACHIEVEMENT_BADGES.map((badge) => badge.id));
      const userStatsData = (userStatsSnap.data() ?? {}) as Record<string, unknown>;
      const existingBadgeDocs = badgeSnapshot.docs.reduce<Map<string, Record<string, unknown>>>(
        (accumulator, docSnap) => {
          accumulator.set(docSnap.id, docSnap.data() as Record<string, unknown>);
          return accumulator;
        },
        new Map<string, Record<string, unknown>>()
      );
      const otherUserStatsDocs = allUserStatsSnapshot.docs
        .filter((docSnap) => docSnap.id !== userId)
        .map((docSnap) => docSnap.data() as Record<string, unknown>);

      const userStatsPatch: Record<string, unknown> = {};
      const metricDistributionCache = new Map<string, number[]>();
      const writes: Promise<unknown>[] = [];
      const notifications: Array<{ godName: string; currentLevel: StoredStatueLevel }> = [];
      let deletedDocCount = 0;
      let updatedStatueDocCount = 0;

      for (const docSnap of badgeSnapshot.docs) {
        const docId = docSnap.id;
        if (!greekStatueIds.has(docId) && !achievementBadgeIds.has(docId)) {
          writes.push(deleteDoc(this.getUserBadgeDocRef(userId, docId)));
          deletedDocCount += 1;
        }
      }

      for (const statue of statues) {
        const metricInfo = this.resolveMetricValue(userStatsData, statue.metric);
        if (metricInfo.segments.length > 0 && metricInfo.wasMissing) {
          this.assignNestedValue(userStatsPatch, metricInfo.segments, 0);
        }

        const currentValue = metricInfo.value;
        const currentLevel = calculateStoredStatueLevel(statue, currentValue);
        const nextLevel = getNextStatueLevel(currentLevel);
        const nextTierValue = nextLevel ? statue.tiers[nextLevel] ?? undefined : undefined;
        const output = calculateStatueOutput(statue, currentValue);
        const progressToNext = currentLevel === 'divine'
          ? 100
          : Math.max(0, Math.min(100, Math.round((output - Math.floor(output)) * 100)));
        const percentile = this.calculatePercentile(
          statue.metric,
          currentValue,
          otherUserStatsDocs,
          metricDistributionCache
        );

        const existingDoc = existingBadgeDocs.get(statue.id);
        const previousLevel = normalizeStatueLevel(existingDoc?.['currentLevel']);
        const nextDoc: UserBadgeStatDoc = {
          id: statue.id,
          userId,
          isDisplayed: existingDoc?.['isDisplayed'] === true,
          metricValue: currentValue,
          currentValue,
          currentLevel,
          percentile,
          nextTierValue,
          progressToNext,
        };

        if (this.needsStatueDocUpdate(existingDoc, nextDoc)) {
          writes.push(this.saveUserBadgeDoc(userId, statue.id, nextDoc));
          updatedStatueDocCount += 1;
        }

        if (
          notifyLevelUps &&
          this.currentUserId === userId &&
          existingDoc &&
          this.isLevelUp(previousLevel, currentLevel)
        ) {
          notifications.push({
            godName: statue.godName,
            currentLevel,
          });
        }
      }

      if (Object.keys(userStatsPatch).length > 0) {
        writes.push(
          setDoc(
            doc(this.firestore, UserBadgesService.USER_STATS_COLLECTION, userId),
            userStatsPatch,
            { merge: true }
          )
        );
      }

      const writeResults = await Promise.all(
        writes.map((writePromise) => this.wrapWritePromise(writePromise))
      );
      const failedWrites = writeResults.filter(this.isFailedWriteResult);
      if (failedWrites.length > 0) {
        console.error(
          `[UserBadgesService] Statue sync completed with ${failedWrites.length} failed write(s).`,
          failedWrites.map((result) => result.error)
        );
      }

      this.userBadgesCache.delete(userId);
      console.info(
        `[UserBadgesService] Synced ${statues.length} GreekStatues for ${userId}. Updated ${updatedStatueDocCount} badge doc(s) and deleted ${deletedDocCount} legacy doc(s).`
      );

      for (const notification of notifications) {
        await this.presentLevelUpToast(notification.godName, notification.currentLevel);
      }
    } catch (error) {
      console.error('[UserBadgesService] Failed to sync statue badges:', error);
    }
  }

  private calculatePercentile(
    metric: string,
    currentValue: number,
    otherUserStatsDocs: Array<Record<string, unknown>>,
    metricDistributionCache: Map<string, number[]>
  ): number {
    const metricKey = this.normalizeMetricKey(metric);
    if (!metricKey) {
      return 0;
    }

    const distribution = metricDistributionCache.get(metricKey) ?? otherUserStatsDocs.map((docData) => {
      return this.resolveMetricValue(docData, metricKey).value;
    });

    metricDistributionCache.set(metricKey, distribution);
    if (distribution.length === 0) {
      return 0;
    }

    const higherValuesCount = distribution.filter((value) => value > currentValue).length;
    return Math.round((higherValuesCount / distribution.length) * 1000) / 10;
  }

  private resolveMetricValue(
    source: Record<string, unknown>,
    metric: string
  ): { value: number; segments: string[]; wasMissing: boolean } {
    const segments = this.getMetricSegments(metric);
    if (segments.length === 0) {
      return { value: 0, segments: [], wasMissing: false };
    }

    let current: unknown = source;
    for (const segment of segments) {
      if (!current || typeof current !== 'object' || Array.isArray(current)) {
        return {
          value: 0,
          segments,
          wasMissing: true,
        };
      }

      const record = current as Record<string, unknown>;
      if (!Object.prototype.hasOwnProperty.call(record, segment)) {
        return {
          value: 0,
          segments,
          wasMissing: true,
        };
      }

      current = record[segment];
    }

    const parsed = Number(current);
    if (!Number.isFinite(parsed)) {
      return {
        value: 0,
        segments,
        wasMissing: true,
      };
    }

    return {
      value: parsed,
      segments,
      wasMissing: false,
    };
  }

  private getMetricSegments(metric: string): string[] {
    return String(metric ?? '')
      .split('/')
      .map((segment) => segment.trim())
      .filter((segment) => segment.length > 0);
  }

  private normalizeMetricKey(metric: string): string {
    return this.getMetricSegments(metric).join(' / ');
  }

  private isLevelUp(
    previousLevel: StoredStatueLevel | undefined,
    nextLevel: StoredStatueLevel
  ): boolean {
    return getStatueLevelNumber(nextLevel) > getStatueLevelNumber(previousLevel);
  }

  private needsStatueDocUpdate(
    existingDoc: Record<string, unknown> | undefined,
    nextDoc: UserBadgeStatDoc
  ): boolean {
    if (!existingDoc) {
      return true;
    }

    return (
      (existingDoc['isDisplayed'] === true) !== nextDoc.isDisplayed ||
      this.toFiniteNumber(existingDoc['metricValue']) !== (nextDoc.metricValue ?? null) ||
      this.toFiniteNumber(existingDoc['currentValue']) !== (nextDoc.currentValue ?? null) ||
      normalizeStatueLevel(existingDoc['currentLevel']) !== nextDoc.currentLevel ||
      this.toFiniteNumber(existingDoc['percentile']) !== (nextDoc.percentile ?? null) ||
      this.toFiniteNumber(existingDoc['nextTierValue']) !== (nextDoc.nextTierValue ?? null) ||
      this.toFiniteNumber(existingDoc['progressToNext']) !== (nextDoc.progressToNext ?? null)
    );
  }

  private async loadUserBadges(userId: string): Promise<UserBadgeStatsMap | null> {
    try {
      const badgeSnapshot = await getDocs(this.getUserBadgesCollectionRef(userId));
      return this.normalizeBadgeDocs(
        userId,
        badgeSnapshot.docs.map((docSnap) => ({ id: docSnap.id, data: docSnap.data() }))
      );
    } catch (error) {
      console.error('[UserBadgesService] Failed to load badges collection:', error);
      return null;
    }
  }

  private setCachedUserBadges(userId: string, userBadges: UserBadgeStatsMap | null): void {
    this.userBadgesCache.set(userId, {
      fetchedAt: Date.now(),
      value: this.cloneUserBadges(userBadges),
    });
  }

  private async saveUserBadgeDoc(
    userId: string,
    docId: string,
    userBadge: Partial<Omit<UserBadgeStatDoc, 'id' | 'userId'>> | UserBadgeStatDoc
  ): Promise<void> {
    const { id: _ignoredId, userId: _ignoredUserId, ...payload } =
      userBadge as Partial<UserBadgeStatDoc>;

    await setDoc(
      this.getUserBadgeDocRef(userId, docId),
      this.removeUndefinedValues({
        ...payload,
        updatedAt: serverTimestamp(),
      }),
      { merge: true }
    );
  }

  private getUserBadgesCollectionRef(userId: string) {
    return collection(
      this.firestore,
      UserBadgesService.USER_STATS_COLLECTION,
      userId,
      UserBadgesService.USER_BADGES_SUBCOLLECTION
    );
  }

  private getUserBadgeDocRef(userId: string, docId: string) {
    return doc(
      this.firestore,
      UserBadgesService.USER_STATS_COLLECTION,
      userId,
      UserBadgesService.USER_BADGES_SUBCOLLECTION,
      docId
    );
  }

  private isFresh<T>(entry: CacheEntry<T> | undefined): entry is CacheEntry<T> {
    return !!entry && Date.now() - entry.fetchedAt < UserBadgesService.CACHE_TTL_MS;
  }

  private normalizeBadgeDocs(
    userId: string,
    docs: Array<{ id: string; data: Record<string, unknown> }>
  ): UserBadgeStatsMap | null {
    const normalizedBadges = docs.reduce<UserBadgeStatsMap>((accumulator, docInfo) => {
      const normalizedDoc = this.normalizeUserBadgeDoc(userId, docInfo.id, docInfo.data);
      if (normalizedDoc) {
        accumulator[docInfo.id] = normalizedDoc;
      }
      return accumulator;
    }, {});

    return this.hasAnyUserBadges(normalizedBadges) ? normalizedBadges : null;
  }

  private hasAnyUserBadges(userBadges: UserBadgeStatsMap | null): userBadges is UserBadgeStatsMap {
    return !!userBadges && Object.keys(userBadges).length > 0;
  }

  private normalizeUserBadgeDoc(
    userId: string,
    docId: string,
    data: Record<string, unknown> | null | undefined
  ): UserBadgeStatDoc | null {
    const raw = data ?? {};
    const hasIsDisplayed = Object.prototype.hasOwnProperty.call(raw, 'isDisplayed');
    const isDisplayed = hasIsDisplayed ? raw['isDisplayed'] === true : false;
    const updatedAt = raw['updatedAt'] ?? undefined;
    const badge = ACHIEVEMENT_BADGES.find((candidate) => candidate.id === docId);

    if (badge) {
      const currentValue = this.toFiniteNumber(raw['currentValue']) ?? 0;
      const progress = calculateProgressToNextTier(badge, currentValue);
      const currentLevel = calculateBadgeLevel(badge, currentValue) ?? undefined;
      return {
        id: docId,
        userId,
        isDisplayed,
        currentValue,
        currentLevel,
        percentile: this.toFiniteNumber(raw['percentile']) ?? undefined,
        nextTierValue: progress.nextTierValue ?? undefined,
        progressToNext: progress.progressPercentage,
        ...(updatedAt ? { updatedAt: updatedAt as UserBadgeStatDoc['updatedAt'] } : {}),
      };
    }

    return {
      id: docId,
      userId,
      isDisplayed,
      metricValue:
        this.toFiniteNumber(raw['metricValue']) ??
        this.toFiniteNumber(raw['currentValue']) ??
        undefined,
      currentValue: this.toFiniteNumber(raw['currentValue']) ?? undefined,
      currentLevel: this.normalizeLevel(raw['currentLevel']),
      percentile: this.toFiniteNumber(raw['percentile']) ?? undefined,
      nextTierValue: this.toFiniteNumber(raw['nextTierValue']) ?? undefined,
      progressToNext: this.toFiniteNumber(raw['progressToNext']) ?? undefined,
      ...(updatedAt ? { updatedAt: updatedAt as UserBadgeStatDoc['updatedAt'] } : {}),
    };
  }

  private normalizeLevel(value: unknown): UserBadgeLevel | undefined {
    const statueLevel = normalizeStatueLevel(value);
    if (statueLevel) {
      return statueLevel;
    }

    if (typeof value !== 'string') {
      return undefined;
    }

    const trimmed = value.trim();
    return UserBadgesService.BADGE_LEVELS.includes(trimmed as BadgeLevel)
      ? (trimmed as UserBadgeLevel)
      : undefined;
  }

  private toFiniteNumber(value: unknown): number | null {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private removeUndefinedValues(value: Record<string, unknown>): Record<string, unknown> {
    return Object.entries(value).reduce<Record<string, unknown>>((accumulator, entry) => {
      const [key, candidateValue] = entry;
      if (candidateValue !== undefined) {
        accumulator[key] = candidateValue;
      }
      return accumulator;
    }, {});
  }

  private assignNestedValue(
    target: Record<string, unknown>,
    segments: string[],
    value: unknown
  ): void {
    if (segments.length === 0) {
      return;
    }

    let current: Record<string, unknown> = target;
    for (let index = 0; index < segments.length - 1; index += 1) {
      const segment = segments[index];
      const existing = current[segment];

      if (!existing || typeof existing !== 'object' || Array.isArray(existing)) {
        current[segment] = {};
      }

      current = current[segment] as Record<string, unknown>;
    }

    current[segments[segments.length - 1]] = value;
  }

  private async wrapWritePromise(writePromise: Promise<unknown>): Promise<WriteResult> {
    try {
      await writePromise;
      return { ok: true };
    } catch (error) {
      return { ok: false, error };
    }
  }

  private isFailedWriteResult(result: WriteResult): result is { ok: false; error: unknown } {
    return result.ok === false;
  }

  private cloneUserBadges(userBadges: UserBadgeStatsMap | null): UserBadgeStatsMap | null {
    if (!userBadges) {
      return null;
    }

    return Object.entries(userBadges).reduce<UserBadgeStatsMap>((accumulator, [docId, userBadge]) => {
      accumulator[docId] = { ...userBadge };
      return accumulator;
    }, {});
  }

  private async presentLevelUpToast(
    godName: string,
    currentLevel: StoredStatueLevel
  ): Promise<void> {
    if (currentLevel === 'None') {
      return;
    }

    const toast = await this.toastController.create({
      message: `${godName} has now reached ${currentLevel}.`,
      duration: 2500,
      position: 'top',
      color: 'primary',
    });
    await toast.present();
  }
}
