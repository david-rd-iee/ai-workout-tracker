// src/app/services/leaderboard.service.ts
import { Injectable } from '@angular/core';
import {
  Firestore,
  collection,
  query,
  where,
  getDocs,
  doc,
  getDoc,
  orderBy,
  limit as fsLimit,
} from '@angular/fire/firestore';
import { collectionData } from '@angular/fire/firestore';
import { Observable, map } from 'rxjs';
import { UserStats, Region } from '../models/user-stats.model';
import { AppUser } from '../models/user.model';

// 🔹 Shared metric type used by BOTH leaderboard page and groups page
export type Metric = 'total' | 'cardio' | 'strength';

// 🔹 Shared entry model
export interface LeaderboardEntry {
  userId: string;
  displayName: string;
  rank: number;

  totalWorkScore: number;
  cardioWorkScore: number;
  strengthWorkScore: number;

  level?: number;
  region?: Region;

  // optional (useful for UI row)
  username?: string;
  profilePicUrl?: string;
  role?: 'USER' | 'TRAINER';
}

type RegionScope = 'country' | 'state' | 'city';

export interface RegionalQuery {
  scope: RegionScope;

  // required for any scope
  countryCode: string;

  // required if scope === 'state' or 'city'
  stateCode?: string;

  // required if scope === 'city'
  cityId?: string;
}

@Injectable({
  providedIn: 'root',
})
export class LeaderboardService {
  constructor(private firestore: Firestore) {}

  // -----------------------------
  // Helpers
  // -----------------------------
  private metricToField(metric: Metric): keyof LeaderboardEntry {
    return metric === 'cardio'
      ? 'cardioWorkScore'
      : metric === 'strength'
      ? 'strengthWorkScore'
      : 'totalWorkScore';
  }

  /**
   * Backwards-compatible score reads:
   * - New fields: totalWorkScore / cardioWorkScore / strengthWorkScore
   * - Old fields: total_work_score / cardio_work_score / strength_work_score
   */
  private readScores(stats: any): Pick<
    LeaderboardEntry,
    'totalWorkScore' | 'cardioWorkScore' | 'strengthWorkScore'
  > {
    const total =
      stats.totalWorkScore ??
      stats.total_work_score ??
      stats.total_workScore ?? // just in case
      0;

    const cardio =
      stats.cardioWorkScore ??
      stats.cardio_work_score ??
      stats.cardio_workScore ??
      0;

    const strength =
      stats.strengthWorkScore ??
      stats.strength_work_score ??
      stats.strength_workScore ??
      0;

    return {
      totalWorkScore: Number(total) || 0,
      cardioWorkScore: Number(cardio) || 0,
      strengthWorkScore: Number(strength) || 0,
    };
  }

  // -----------------------------
  // Main leaderboard (all users)
  // -----------------------------
  getAllUserStats(): Observable<LeaderboardEntry[]> {
    const statsRef = collection(this.firestore, 'userStats');

    return collectionData(statsRef, { idField: 'userId' }).pipe(
      map((docs) =>
        (docs as (UserStats & { userId: string })[]).map((s: any) => {
          const scores = this.readScores(s);

          return {
            userId: s.userId,
            displayName: s.displayName ?? 'Anonymous',
            rank: 0,
            ...scores,
            level: s.level,
            region: s.region,
            username: s.username,
            profilePicUrl: s.profilePicUrl ?? s.profilePicUrl?.toString?.(),
            role: s.role,
          };
        })
      )
    );
  }

  // -----------------------------
  // Regional leaderboard (NEW)
  // -----------------------------
  async getRegionalLeaderboard(
    regional: RegionalQuery,
    metric: Metric = 'total',
    maxResults: number = 100
  ): Promise<LeaderboardEntry[]> {
    console.log('[LeaderboardService] getRegionalLeaderboard', {
      regional,
      metric,
      maxResults,
    });

    const statsRef = collection(this.firestore, 'userStats');

    // Validate minimal requirements for scope
    if (!regional.countryCode) {
      throw new Error('countryCode is required for regional leaderboards.');
    }
    if ((regional.scope === 'state' || regional.scope === 'city') && !regional.stateCode) {
      throw new Error('stateCode is required when scope is state or city.');
    }
    if (regional.scope === 'city' && !regional.cityId) {
      throw new Error('cityId is required when scope is city.');
    }

    // Firestore field to orderBy
    // IMPORTANT: This assumes your Firestore docs have camelCase fields.
    // If you haven’t migrated yet, migrate scores to camelCase first.
    const orderField =
      metric === 'cardio'
        ? 'cardioWorkScore'
        : metric === 'strength'
        ? 'strengthWorkScore'
        : 'totalWorkScore';

    // Build filter constraints
    const filterConstraints: any[] = [
      where('region.countryCode', '==', regional.countryCode),
    ];

    if (regional.scope === 'state' || regional.scope === 'city') {
      filterConstraints.push(where('region.stateCode', '==', regional.stateCode));
    }

    if (regional.scope === 'city') {
      filterConstraints.push(where('region.cityId', '==', regional.cityId));
    }

    let entries: LeaderboardEntry[] = [];

    try {
      // Primary path: server-side sort + limit (requires composite indexes)
      const q = query(
        statsRef,
        ...filterConstraints,
        orderBy(orderField, 'desc'),
        fsLimit(maxResults)
      );
      const snap = await getDocs(q);
      entries = snap.docs.map((d) => this.mapStatsDocToEntry(d.id, d.data()));
    } catch (err: any) {
      if (!this.isMissingIndexError(err)) {
        throw err;
      }

      // Fallback path for dev/test projects without composite indexes:
      // fetch filtered rows, then sort/limit in-memory.
      console.warn(
        '[LeaderboardService] Missing composite index for regional query; using client-side sort fallback.'
      );
      const q = query(statsRef, ...filterConstraints);
      const snap = await getDocs(q);
      entries = snap.docs.map((d) => this.mapStatsDocToEntry(d.id, d.data()));
      const metricField = this.metricToField(metric);
      entries.sort((a, b) => ((b as any)[metricField] ?? 0) - ((a as any)[metricField] ?? 0));
      entries = entries.slice(0, maxResults);
    }

    // Assign ranks (already ordered by Firestore, but rank is local)
    entries.forEach((e, idx) => (e.rank = idx + 1));

    console.log(
      '[LeaderboardService] regional entries:',
      entries.map((e) => ({
        uid: e.userId,
        total: e.totalWorkScore,
        cardio: e.cardioWorkScore,
        strength: e.strengthWorkScore,
      }))
    );

    return entries;
  }

  private mapStatsDocToEntry(userId: string, stats: any): LeaderboardEntry {
    const scores = this.readScores(stats);
    return {
      userId,
      displayName: stats.displayName ?? stats.username ?? 'Anonymous',
      rank: 0,
      ...scores,
      level: stats.level,
      region: stats.region,
      username: stats.username,
      profilePicUrl: stats.profilePicUrl,
      role: stats.role,
    };
  }

  private isMissingIndexError(err: any): boolean {
    const message = String(err?.message ?? '').toLowerCase();
    return err?.code === 'failed-precondition' && message.includes('index');
  }

  // -----------------------------
  // Group leaderboard (existing)
  // -----------------------------
  async getGroupLeaderboard(
    groupId: string,
    metric: Metric = 'total'
  ): Promise<LeaderboardEntry[]> {
    console.log('[LeaderboardService] getGroupLeaderboard', { groupId, metric });

    // 1) Read group doc and use group.userIDs as the source of membership.
    const groupRef = doc(this.firestore, 'groupID', groupId);
    const groupSnap = await getDoc(groupRef);
    if (!groupSnap.exists()) {
      console.log('[LeaderboardService] Group not found:', groupId);
      return [];
    }

    const groupData = groupSnap.data() as { userIDs?: string[] };
    const userIds = Array.isArray(groupData.userIDs) ? groupData.userIDs : [];

    if (userIds.length === 0) {
      console.log('[LeaderboardService] Group has no userIDs:', groupId);
      return [];
    }

    // 2) For each userId, pull /users + /userStats docs
    const entries: LeaderboardEntry[] = [];

    await Promise.all(
      userIds.map(async (uid) => {
        const userRef = doc(this.firestore, 'users', uid);
        const statsRef = doc(this.firestore, 'userStats', uid);
        const [userSnap, statsSnap] = await Promise.all([
          getDoc(userRef),
          getDoc(statsRef),
        ]);

        if (!statsSnap.exists()) {
          console.warn(
            '[LeaderboardService] No userStats doc for user in group:',
            uid
          );
          return;
        }

        const stats = statsSnap.data() as any;
        const user = userSnap.exists()
          ? ({ ...userSnap.data(), userId: uid } as AppUser)
          : undefined;
        const scores = this.readScores(stats);

        entries.push({
          userId: uid,
          displayName:
            stats.displayName || user?.username || user?.email || 'Unknown User',
          rank: 0,
          ...scores,
          level: stats.level,
          region: stats.region,
          username: stats.username ?? user?.username,
          profilePicUrl: stats.profilePicUrl,
          role: stats.role,
        });
      })
    );

    // 3) sort by the requested metric
    const metricField = this.metricToField(metric);

    entries.sort((a, b) => {
      const aVal = (a as any)[metricField] as number | undefined;
      const bVal = (b as any)[metricField] as number | undefined;
      return (bVal ?? 0) - (aVal ?? 0);
    });

    // 4) assign ranks
    entries.forEach((e, idx) => (e.rank = idx + 1));

    console.log('[LeaderboardService] final sorted entries:', entries);
    return entries;
  }
}
