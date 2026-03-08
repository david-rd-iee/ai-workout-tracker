import { Injectable } from '@angular/core';
import { Firestore, doc, docData, setDoc, serverTimestamp } from '@angular/fire/firestore';
import { Observable } from 'rxjs';
import { Region, UserStats } from '../models/user-stats.model';

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
  async initUserStats(userId: string, region: Region, totalWorkScore: number): Promise<void> {
    const ref = doc(this.firestore, 'userStats', userId);

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
      totalScore: totalWorkScore,
      level: 5,
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
}
