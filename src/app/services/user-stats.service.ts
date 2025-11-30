import { Injectable } from '@angular/core';
import { Firestore, doc, setDoc, getDoc, updateDoc } from '@angular/fire/firestore';

@Injectable({ providedIn: 'root' })
export class UserStatsService {
  constructor(private firestore: Firestore) {}

  async createUserStats(userId: string) {
    const ref = doc(this.firestore, `userStats/${userId}`);
    await setDoc(ref, {
      totalWorkScore: 0,
      cardioWorkScore: 0,
      strengthWorkScore: 0,
      level: 1,
      lastUpdatedAt: new Date(),
    });
  }

  async updateStats(userId: string, newStats: any) {
    const ref = doc(this.firestore, `userStats/${userId}`);
    await updateDoc(ref, {
      ...newStats,
      lastUpdatedAt: new Date()
    });
  }

  getStats(userId: string) {
    const ref = doc(this.firestore, `userStats/${userId}`);
    return getDoc(ref);
  }
}
