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

    // Build query constraints
    const constraints: any[] = [
      where('region.countryCode', '==', regional.countryCode),
    ];

    if (regional.scope === 'state' || regional.scope === 'city') {
      constraints.push(where('region.stateCode', '==', regional.stateCode));
    }

    if (regional.scope === 'city') {
      constraints.push(where('region.cityId', '==', regional.cityId));
    }

    // orderBy must come after where constraints in query() builder
    constraints.push(orderBy(orderField, 'desc'));
    constraints.push(fsLimit(maxResults));

    const q = query(statsRef, ...constraints);
    const snap = await getDocs(q);

    const entries: LeaderboardEntry[] = [];

    snap.forEach((d) => {
      const stats = d.data() as any;
      const scores = this.readScores(stats);

      entries.push({
        userId: d.id, // doc ID = UID
        displayName: stats.displayName ?? stats.username ?? 'Anonymous',
        rank: 0,
        ...scores,
        level: stats.level,
        region: stats.region,
        username: stats.username,
        profilePicUrl: stats.profilePicUrl,
        role: stats.role,
      });
    });

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

  // -----------------------------
  // Group leaderboard (existing)
  // -----------------------------
  async getGroupLeaderboard(
    groupId: string,
    metric: Metric = 'total'
  ): Promise<LeaderboardEntry[]> {
    console.log('[LeaderboardService] getGroupLeaderboard', { groupId, metric });

    // 1) find all users whose `groups` array contains this groupId
    const usersRef = collection(this.firestore, 'users');
    const q = query(usersRef, where('groups', 'array-contains', groupId));
    const userSnap = await getDocs(q);

    console.log(
      '[LeaderboardService] users in group snapshot size:',
      userSnap.size
    );

    if (userSnap.empty) {
      console.log('[LeaderboardService] No users found in group', groupId);
      return [];
    }

    const userIds: string[] = [];
    const usersById: Record<string, AppUser> = {};

    userSnap.forEach((d) => {
      const data = d.data() as AppUser;
      const uid = d.id;
      userIds.push(uid);
      usersById[uid] = { ...data, userId: uid };
    });

    console.log('[LeaderboardService] userIds in group:', userIds);

    // 2) For each user, pull their userStats doc
    const entries: LeaderboardEntry[] = [];

    await Promise.all(
      userIds.map(async (uid) => {
        const statsRef = doc(this.firestore, 'userStats', uid);
        const statsSnap = await getDoc(statsRef);

        if (!statsSnap.exists()) {
          console.warn(
            '[LeaderboardService] No userStats doc for user in group:',
            uid
          );
          return;
        }

        const stats = statsSnap.data() as any;
        const user = usersById[uid];
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
