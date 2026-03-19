import { Injectable, Signal, signal } from '@angular/core';
import { Firestore } from '@angular/fire/firestore';
import { Observable } from 'rxjs';
import { doc, getDoc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';
import { UserBadgesDoc } from '../models/user-badges.model';

interface CacheEntry<T> {
  fetchedAt: number;
  value: T;
}

@Injectable({
  providedIn: 'root',
})
export class UserBadgesService {
  private static readonly CACHE_TTL_MS = 5 * 60 * 1000;

  private userBadgesCache = new Map<string, CacheEntry<UserBadgesDoc | null>>();
  private userBadgesPromiseCache = new Map<string, Promise<UserBadgesDoc | null>>();
  private currentUserBadges = signal<UserBadgesDoc | null>(null);
  private currentUserId: string | null = null;
  private currentUserUnsubscribe: (() => void) | null = null;

  constructor(private firestore: Firestore) {}

  getCurrentUserBadges(): Signal<UserBadgesDoc | null> {
    return this.currentUserBadges;
  }

  async initializeCurrentUserBadges(
    userId: string,
    forceRefresh = false
  ): Promise<UserBadgesDoc | null> {
    const normalizedUserId = String(userId ?? '').trim();
    if (!normalizedUserId) {
      this.clear();
      return null;
    }

    const userBadges = await this.getUserBadges(normalizedUserId, forceRefresh);
    this.currentUserBadges.set(this.cloneUserBadges(userBadges));
    this.ensureCurrentUserListener(normalizedUserId);
    return this.cloneUserBadges(userBadges);
  }

  async getUserBadges(userId: string, forceRefresh = false): Promise<UserBadgesDoc | null> {
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
    this.currentUserId = null;
    this.currentUserBadges.set(null);
    this.userBadgesCache.clear();
    this.userBadgesPromiseCache.clear();
  }

  observeUserBadges(
    userId: string,
    observer: (userBadges: UserBadgesDoc | null) => void
  ): () => void {
    const normalizedUserId = String(userId ?? '').trim();
    if (!normalizedUserId) {
      observer(null);
      return () => undefined;
    }

    const badgeRef = doc(this.firestore, 'userBadges', normalizedUserId);
    return onSnapshot(
      badgeRef,
      (snapshot) => {
        if (!snapshot.exists()) {
          this.setCachedUserBadges(normalizedUserId, null);
          if (this.currentUserId === normalizedUserId) {
            this.currentUserBadges.set(null);
          }
          observer(null);
          return;
        }

        const userBadges = {
          userId: normalizedUserId,
          ...(snapshot.data() as Omit<UserBadgesDoc, 'userId'>),
        };

        this.setCachedUserBadges(normalizedUserId, userBadges);
        if (this.currentUserId === normalizedUserId) {
          this.currentUserBadges.set(this.cloneUserBadges(userBadges));
        }
        observer(this.cloneUserBadges(userBadges));
      },
      (error) => {
        console.error('[UserBadgesService] Failed to observe userBadges:', error);
        observer(this.cloneUserBadges(this.userBadgesCache.get(normalizedUserId)?.value ?? null));
      }
    );
  }

  watchUserBadges(userId: string): Observable<UserBadgesDoc | null> {
    return new Observable<UserBadgesDoc | null>((subscriber) => {
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

    const sanitizedDisplayIds = Array.from(
      new Set(
        (displayStatueIds ?? [])
          .map((id) => String(id ?? '').trim())
          .filter((id) => id.length > 0)
      )
    );

    const badgeRef = doc(this.firestore, 'userBadges', normalizedUserId);
    await setDoc(
      badgeRef,
      {
        displayStatueIds: sanitizedDisplayIds,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );

    const cachedUserBadges =
      this.userBadgesCache.get(normalizedUserId)?.value ??
      (this.currentUserId === normalizedUserId ? this.currentUserBadges() : null);
    const nextUserBadges: UserBadgesDoc = cachedUserBadges
      ? {
          ...cachedUserBadges,
          displayStatueIds: [...sanitizedDisplayIds],
        }
      : {
          userId: normalizedUserId,
          values: {},
          displayStatueIds: [...sanitizedDisplayIds],
        };

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

  private async loadUserBadges(userId: string): Promise<UserBadgesDoc | null> {
    try {
      const badgeSnap = await getDoc(doc(this.firestore, 'userBadges', userId));
      if (!badgeSnap.exists()) {
        return null;
      }

      return {
        userId,
        ...(badgeSnap.data() as Omit<UserBadgesDoc, 'userId'>),
      };
    } catch (error) {
      console.error('[UserBadgesService] Failed to load userBadges:', error);
      return null;
    }
  }

  private setCachedUserBadges(userId: string, userBadges: UserBadgesDoc | null): void {
    this.userBadgesCache.set(userId, {
      fetchedAt: Date.now(),
      value: this.cloneUserBadges(userBadges),
    });
  }

  private isFresh<T>(entry: CacheEntry<T> | undefined): entry is CacheEntry<T> {
    return !!entry && Date.now() - entry.fetchedAt < UserBadgesService.CACHE_TTL_MS;
  }

  private cloneUserBadges(userBadges: UserBadgesDoc | null): UserBadgesDoc | null {
    if (!userBadges) {
      return null;
    }

    return {
      ...userBadges,
      values: { ...(userBadges.values ?? {}) },
      percentiles: userBadges.percentiles ? { ...userBadges.percentiles } : undefined,
      displayBadgeIds: userBadges.displayBadgeIds ? [...userBadges.displayBadgeIds] : undefined,
      displayStatueIds: userBadges.displayStatueIds ? [...userBadges.displayStatueIds] : undefined,
    };
  }
}
