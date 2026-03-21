import { Injectable, Signal, signal } from '@angular/core';
import { Firestore, docData } from '@angular/fire/firestore';
import { doc, getDoc, onSnapshot, setDoc, serverTimestamp } from 'firebase/firestore';
import { Observable } from 'rxjs';
import {
  Region,
  UserStats,
  calculateUserLevelProgress,
  normalizeStreakData,
} from '../models/user-stats.model';

interface CacheEntry<T> {
  fetchedAt: number;
  value: T;
}

@Injectable({
  providedIn: 'root',
})
export class UserStatsService {
  private static readonly CACHE_TTL_MS = 5 * 60 * 1000;

  private userStatsCache = new Map<string, CacheEntry<UserStats | null>>();
  private userStatsPromiseCache = new Map<string, Promise<UserStats | null>>();
  private currentUserStats = signal<UserStats | null>(null);
  private currentUserId: string | null = null;
  private currentUserUnsubscribe: (() => void) | null = null;

  constructor(private firestore: Firestore) {}

  getCurrentUserStats(): Signal<UserStats | null> {
    return this.currentUserStats;
  }

  async initializeCurrentUserStats(
    userId: string,
    forceRefresh = false
  ): Promise<UserStats | null> {
    const normalizedUserId = String(userId ?? '').trim();
    if (!normalizedUserId) {
      this.clear();
      return null;
    }

    const userStats = await this.getUserStatsDoc(normalizedUserId, forceRefresh);
    this.currentUserStats.set(this.cloneUserStats(userStats));
    this.ensureCurrentUserListener(normalizedUserId);
    return this.cloneUserStats(userStats);
  }

  async getUserStatsDoc(userId: string, forceRefresh = false): Promise<UserStats | null> {
    const normalizedUserId = String(userId ?? '').trim();
    if (!normalizedUserId) {
      return null;
    }

    if (!forceRefresh) {
      const cached = this.userStatsCache.get(normalizedUserId);
      if (this.isFresh(cached)) {
        return this.cloneUserStats(cached.value);
      }

      const inFlight = this.userStatsPromiseCache.get(normalizedUserId);
      if (inFlight) {
        return this.cloneUserStats(await inFlight);
      }
    }

    const loadPromise = this.loadUserStats(normalizedUserId);
    this.userStatsPromiseCache.set(normalizedUserId, loadPromise);

    try {
      const userStats = await loadPromise;
      this.setCachedUserStats(normalizedUserId, userStats);
      if (this.currentUserId === normalizedUserId) {
        this.currentUserStats.set(this.cloneUserStats(userStats));
      }
      return this.cloneUserStats(userStats);
    } finally {
      this.userStatsPromiseCache.delete(normalizedUserId);
    }
  }

  clear(): void {
    this.currentUserUnsubscribe?.();
    this.currentUserUnsubscribe = null;
    this.currentUserId = null;
    this.currentUserStats.set(null);
    this.userStatsCache.clear();
    this.userStatsPromiseCache.clear();
  }

  getUserStats(userId: string): Observable<UserStats | undefined> {
    const ref = doc(this.firestore, 'userStats', userId);
    return docData(ref, { idField: 'userId' }) as unknown as Observable<UserStats | undefined>;
  }


  // Initialize / overwrite stats for a user (good for fake users)
  async initUserStats(userId: string, region: Region, totalWorkScore: number): Promise<void> {
    const ref = doc(this.firestore, 'userStats', userId);
    const levelProgress = calculateUserLevelProgress(totalWorkScore);

    const data: UserStats = {
      userId,
      age: 0,
      sex: 0,
      heightMeters: 0,
      weightKg: 0,
      bmi: 0,
      cardioScore: {
        totalCardioScore: Math.floor(totalWorkScore * 0.5),
      },
      strengthScore: {
        totalStrengthScore: Math.floor(totalWorkScore * 0.5),
      },
      Expected_Effort: {
        Cardio: {},
        Strength: {},
      },
      totalScore: totalWorkScore,
      ...levelProgress,
      streakData: normalizeStreakData(undefined),
      region,
    };

    await setDoc(
      ref,
      {
        ...data,
        last_updated_at: serverTimestamp(),
      } as Record<string, unknown>,
      { merge: true }
    );
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
    const ref = doc(this.firestore, 'userStats', normalizedUserId);
    this.currentUserUnsubscribe = onSnapshot(
      ref,
      (snapshot) => {
        if (!snapshot.exists()) {
          this.setCachedUserStats(normalizedUserId, null);
          if (this.currentUserId === normalizedUserId) {
            this.currentUserStats.set(null);
          }
          return;
        }

        const userStats = this.normalizeUserStats({
          userId: normalizedUserId,
          ...(snapshot.data() as Omit<UserStats, 'userId'>),
        });

        this.setCachedUserStats(normalizedUserId, userStats);
        if (this.currentUserId === normalizedUserId) {
          this.currentUserStats.set(this.cloneUserStats(userStats));
        }
      },
      (error) => {
        console.error('[UserStatsService] Failed to observe userStats:', error);
      }
    );
  }

  private async loadUserStats(userId: string): Promise<UserStats | null> {
    try {
      const statsSnap = await getDoc(doc(this.firestore, 'userStats', userId));
      if (!statsSnap.exists()) {
        return null;
      }

      return this.normalizeUserStats({
        userId,
        ...(statsSnap.data() as Omit<UserStats, 'userId'>),
      });
    } catch (error) {
      console.error('[UserStatsService] Failed to load userStats:', error);
      return null;
    }
  }

  private setCachedUserStats(userId: string, userStats: UserStats | null): void {
    this.userStatsCache.set(userId, {
      fetchedAt: Date.now(),
      value: this.cloneUserStats(userStats),
    });
  }

  private isFresh<T>(entry: CacheEntry<T> | undefined): entry is CacheEntry<T> {
    return !!entry && Date.now() - entry.fetchedAt < UserStatsService.CACHE_TTL_MS;
  }

  private cloneUserStats(userStats: UserStats | null): UserStats | null {
    if (!userStats) {
      return null;
    }

    return {
      ...userStats,
      cardioScore: userStats.cardioScore ? { ...userStats.cardioScore } : userStats.cardioScore,
      strengthScore: userStats.strengthScore ? { ...userStats.strengthScore } : userStats.strengthScore,
      Expected_Effort: userStats.Expected_Effort
        ? {
            Cardio: { ...userStats.Expected_Effort.Cardio },
            Strength: { ...userStats.Expected_Effort.Strength },
          }
        : undefined,
      streakData: userStats.streakData ? { ...userStats.streakData } : undefined,
      region: userStats.region ? { ...userStats.region } : undefined,
    };
  }

  private normalizeUserStats(userStats: UserStats): UserStats {
    const rawUserStats = userStats as UserStats & Record<string, unknown>;

    return {
      ...userStats,
      streakData: normalizeStreakData(
        rawUserStats.streakData,
        rawUserStats['currentStreak'],
        rawUserStats['maxStreak']
      ),
    };
  }
}
