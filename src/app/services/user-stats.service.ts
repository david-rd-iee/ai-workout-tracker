import { Injectable } from '@angular/core';
import { Firestore, doc, docData, setDoc, serverTimestamp } from '@angular/fire/firestore';
import { Observable } from 'rxjs';
import { UserStats } from '../models/user-stats.model';

@Injectable({
  providedIn: 'root',
})
export class UserStatsService {
  constructor(private firestore: Firestore) {}

  getUserStats(userId: string): Observable<UserStats | undefined> {
  const ref = doc(this.firestore, 'userStats', userId);
  return docData(ref, { idField: 'userId' }) as unknown as Observable<UserStats | undefined>;
}


  // Initialize / overwrite stats for a user (good for fake users)
  async initUserStats(userId: string, region: string, totalWorkScore: number): Promise<void> {
    const ref = doc(this.firestore, 'userStats', userId);

    const data: UserStats = {
      userId,
      total_work_score: totalWorkScore,
      cardio_work_score: Math.floor(totalWorkScore * 0.5),
      strength_work_score: Math.floor(totalWorkScore * 0.5),
      level: 5,
      region,
      last_updated_at: serverTimestamp(),
    };

    await setDoc(ref, data, { merge: true });
  }
}
