import { Injectable } from '@angular/core';
import {
  Firestore,
  collection,
  getDocs,
  query,
  where,
  doc,
  writeBatch,
  serverTimestamp,
  limit as fsLimit,
} from '@angular/fire/firestore';

@Injectable({ providedIn: 'root' })
export class DevSeedService {
  private readonly DUMMY_PREFIX = 'dev_dummy_';

  constructor(private firestore: Firestore) {}

  /**
   * Seeds dummy docs into: userStats/{uid}
   * - By default: only seeds if no dummy docs exist yet
   * - force=true: will overwrite dummy docs (same IDs), but won't touch real user UIDs
   */
  async seedDummyUserStatsIfEmpty(count: number = 100, force: boolean = false) {
    // If we're not forcing, only seed if no dummy docs already exist
    if (!force) {
      const statsRef = collection(this.firestore, 'userStats');
      const existingDummyQuery = query(
        statsRef,
        where('isDummy', '==', true),
        fsLimit(1)
      );

      const existingDummySnap = await getDocs(existingDummyQuery);
      if (!existingDummySnap.empty) {
        console.log('[DevSeed] Dummy userStats already exist. Skipping seed.');
        return;
      }
    }

    console.log('[DevSeed] Seeding dummy userStats...', { count, force });

    const dummyUsers = this.generateDummyUsers(count);

    const batch = writeBatch(this.firestore);

    for (const user of dummyUsers) {
      const docRef = doc(this.firestore, 'userStats', user.uid);
      batch.set(docRef, user, { merge: true }); // merge=true is safer
    }

    await batch.commit();
    console.log('[DevSeed] Dummy data created/updated:', dummyUsers.length);
  }

  private generateDummyUsers(count: number) {
    const firstNames = ['Alex', 'Jordan', 'Taylor', 'Chris', 'Morgan', 'Blake'];
    const lastNames = ['Smith', 'Johnson', 'Brown', 'Lee', 'Garcia'];

    const regions = [
      {
        countryCode: 'US',
        countryName: 'United States',
        stateCode: 'NV',
        stateName: 'Nevada',
        cityId: 'reno_nv_us',
        cityName: 'Reno',
      },
      {
        countryCode: 'US',
        countryName: 'United States',
        stateCode: 'CA',
        stateName: 'California',
        cityId: 'la_ca_us',
        cityName: 'Los Angeles',
      },
      {
        countryCode: 'US',
        countryName: 'United States',
        stateCode: 'TX',
        stateName: 'Texas',
        cityId: 'austin_tx_us',
        cityName: 'Austin',
      },
    ];

    return Array.from({ length: count }).map((_, i) => {
      const first = firstNames[Math.floor(Math.random() * firstNames.length)];
      const last = lastNames[Math.floor(Math.random() * lastNames.length)];
      const region = regions[Math.floor(Math.random() * regions.length)];

      const cardio = Math.floor(Math.random() * 1000);
      const strength = Math.floor(Math.random() * 1000);

      return {
        uid: `${this.DUMMY_PREFIX}${i}`,
        isDummy: true, // ✅ helps us detect seeded docs safely

        displayName: `${first} ${last}`,
        username: `${first.toLowerCase()}${i}`,
        profilePicUrl: '',
        role: Math.random() > 0.8 ? 'TRAINER' : 'USER',

        region,

        heightCm: 160 + Math.floor(Math.random() * 40),
        weightKg: 60 + Math.floor(Math.random() * 50),
        sex: Math.random() > 0.5 ? 'MALE' : 'FEMALE',

        cardioWorkScore: cardio,
        strengthWorkScore: strength,
        totalWorkScore: cardio + strength,

        level: Math.floor((cardio + strength) / 200),
        xp: cardio + strength,

        lastUpdated: serverTimestamp(),
      };
    });
  }
}
