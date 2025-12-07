// src/app/services/leaderboard.service.ts
import { Injectable } from '@angular/core';
import {
  Firestore,
  collection,
  CollectionReference,
  query,
} from '@angular/fire/firestore';
import { collectionData } from '@angular/fire/firestore';
import { Observable, map } from 'rxjs';
import { UserStats, Region } from '../models/user-stats.model';

export type Metric = 'total' | 'cardio' | 'strength';

export interface LeaderboardEntry {
  userId: string;
  displayName: string;
  rank: number;
  totalWorkScore: number;
  cardioWorkScore: number;
  strengthWorkScore: number;
  level?: number;
  xp?: number;
  region?: Region;
}

@Injectable({
  providedIn: 'root',
})
export class LeaderboardService {
  constructor(private firestore: Firestore) {}

  getAllUserStats(): Observable<LeaderboardEntry[]> {
    const statsRef = collection(
      this.firestore,
      'userStats'
    ) as CollectionReference<UserStats>;

    const q = query(statsRef);

    return collectionData(q, { idField: 'userId' }).pipe(
      map((stats) =>
        (stats as (UserStats & { userId: string })[]).map((s) => ({
          userId: s.userId,
          displayName: s.displayName ?? 'Anonymous',
          rank: 0, // will be filled in after sorting
          totalWorkScore: s.total_work_score ?? 0,
          cardioWorkScore: s.cardio_work_score ?? 0,
          strengthWorkScore: s.strength_work_score ?? 0,
          level: s.level,
          region: s.region,
        }))
      )
    );
  }
}
