// src/app/services/leaderboard.service.ts
import { Injectable } from '@angular/core';
import {
  Firestore,
  collection,
  CollectionReference,
  query,
  where,
  getDocs,
  doc,
  getDoc,
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
}

@Injectable({
  providedIn: 'root',
})
export class LeaderboardService {
  constructor(private firestore: Firestore) {}

  // ✅ main leaderboard (unchanged)
  getAllUserStats(): Observable<LeaderboardEntry[]> {
    const statsRef = collection(this.firestore, 'userStats');

    return collectionData(statsRef, { idField: 'userId' }).pipe(
      map((docs) =>
        (docs as (UserStats & { userId: string })[]).map((s) => ({
          userId: s.userId,
          displayName: s.displayName ?? 'Anonymous',
          rank: 0,
          totalWorkScore: s.total_work_score ?? 0,
          cardioWorkScore: s.cardio_work_score ?? 0,
          strengthWorkScore: s.strength_work_score ?? 0,
          level: s.level,
          region: s.region,
        }))
      )
    );
  }

  // 🔹 group-only leaderboard
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

        const stats = statsSnap.data() as UserStats;
        const user = usersById[uid];

        entries.push({
          userId: uid,
          displayName:
            stats.displayName || user?.name || user?.email || 'Unknown User',
          rank: 0, // we set this after sorting
          totalWorkScore: stats.total_work_score ?? 0,
          cardioWorkScore: stats.cardio_work_score ?? 0,
          strengthWorkScore: stats.strength_work_score ?? 0,
          level: stats.level,
          region: stats.region,
        });
      })
    );

    console.log(
      '[LeaderboardService] built entries before sort:',
      entries.map((e) => ({ uid: e.userId, total: e.totalWorkScore }))
    );

    // 3) sort by the requested metric
    const metricField =
      metric === 'cardio'
        ? 'cardioWorkScore'
        : metric === 'strength'
        ? 'strengthWorkScore'
        : 'totalWorkScore';

    entries.sort((a, b) => {
      const aVal = (a as any)[metricField] as number | undefined;
      const bVal = (b as any)[metricField] as number | undefined;
      return (bVal ?? 0) - (aVal ?? 0);
    });

    // 4) assign ranks
    entries.forEach((e, idx) => {
      e.rank = idx + 1;
    });

    console.log('[LeaderboardService] final sorted entries:', entries);

    return entries;
  }
}
