import { Injectable, Signal, signal } from '@angular/core';
import { Firestore, docData } from '@angular/fire/firestore';
import { doc, getDoc, onSnapshot, setDoc, serverTimestamp } from 'firebase/firestore';
import { AlertController } from '@ionic/angular/standalone';
import { Observable } from 'rxjs';
import {
  Region,
  UserStats,
  calculateUserLevelProgress,
  normalizeEarlyMorningWorkoutsTracker,
  normalizeGroupRankings,
  normalizeStreakData,
  normalizeUserScore,
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
  private currentUserLastObservedTotalScore: number | null = null;
  private scoreUpdateAlertInFlight = false;

  constructor(
    private firestore: Firestore,
    private alertController: AlertController
  ) {}

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
    this.currentUserLastObservedTotalScore = null;
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
      userScore: {
        cardioScore: {
          totalCardioScore: Math.floor(totalWorkScore * 0.5),
        },
        strengthScore: {
          totalStrengthScore: Math.floor(totalWorkScore * 0.5),
        },
        totalScore: totalWorkScore,
        maxAddedScoreWithinDay: 0,
      },
      Expected_Effort: {
        Cardio: {},
        Strength: {},
      },
      ...levelProgress,
      streakData: normalizeStreakData(undefined),
      earlymorningWorkoutsTracker: normalizeEarlyMorningWorkoutsTracker(undefined),
      groupRankings: normalizeGroupRankings(undefined),
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
    this.currentUserLastObservedTotalScore = null;
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
        void this.maybeShowScoreUpdateAlert(userStats);
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
      userScore: userStats.userScore
        ? {
            ...userStats.userScore,
            cardioScore: { ...userStats.userScore.cardioScore },
            strengthScore: { ...userStats.userScore.strengthScore },
          }
        : userStats.userScore,
      Expected_Effort: userStats.Expected_Effort
        ? {
            Cardio: { ...userStats.Expected_Effort.Cardio },
            Strength: { ...userStats.Expected_Effort.Strength },
          }
        : undefined,
      streakData: userStats.streakData ? { ...userStats.streakData } : undefined,
      earlymorningWorkoutsTracker: userStats.earlymorningWorkoutsTracker
        ? { ...userStats.earlymorningWorkoutsTracker }
        : normalizeEarlyMorningWorkoutsTracker(undefined),
      groupRankings: userStats.groupRankings
        ? { ...userStats.groupRankings }
        : undefined,
      region: userStats.region ? { ...userStats.region } : undefined,
    };
  }

  private normalizeUserStats(userStats: UserStats): UserStats {
    const rawUserStats = userStats as UserStats & Record<string, unknown>;

    return {
      ...userStats,
      userScore: normalizeUserScore(
        rawUserStats.userScore,
        rawUserStats['cardioScore'],
        rawUserStats['strengthScore'],
        rawUserStats['totalScore'],
        rawUserStats['workScore']
      ),
      streakData: normalizeStreakData(
        rawUserStats.streakData,
        rawUserStats['currentStreak'],
        rawUserStats['maxStreak']
      ),
      earlymorningWorkoutsTracker: normalizeEarlyMorningWorkoutsTracker(
        rawUserStats.earlymorningWorkoutsTracker
      ),
      groupRankings: normalizeGroupRankings(rawUserStats.groupRankings),
    };
  }

  private async maybeShowScoreUpdateAlert(userStats: UserStats): Promise<void> {
    const currentTotalScore = this.getTotalScore(userStats);
    if (currentTotalScore === null) {
      return;
    }

    if (this.currentUserLastObservedTotalScore === null) {
      this.currentUserLastObservedTotalScore = currentTotalScore;
      return;
    }

    if (currentTotalScore === this.currentUserLastObservedTotalScore) {
      return;
    }

    const previousTotal = this.currentUserLastObservedTotalScore;
    this.currentUserLastObservedTotalScore = currentTotalScore;
    const addedScore = currentTotalScore - previousTotal;
    if (addedScore <= 0 || this.scoreUpdateAlertInFlight) {
      return;
    }

    this.scoreUpdateAlertInFlight = true;
    try {
      const alert = await this.alertController.create({
        mode: 'ios',
        header: 'Score Updated',
        cssClass: 'score-update-alert',
        message: `SCORE Added: +${Math.round(addedScore)}\nTotal SCORE: ${Math.round(currentTotalScore)}`,
        buttons: ['OK'],
        translucent: true,
      });

      await alert.present();
    } finally {
      this.scoreUpdateAlertInFlight = false;
    }
  }

  private getTotalScore(userStats: UserStats | null): number | null {
    const totalScore = Number(userStats?.userScore?.totalScore);
    return Number.isFinite(totalScore) ? totalScore : null;
  }
}
