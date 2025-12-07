// src/app/services/dev-seed.service.ts
import { Injectable } from '@angular/core';
import {
  Auth,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  User,
} from '@angular/fire/auth';
import {
  Firestore,
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
} from '@angular/fire/firestore';

// Allowed dev group scenarios
type DevGroupScenario = 'none' | 'pt' | 'friends' | 'both';

@Injectable({
  providedIn: 'root',
})
export class DevSeedService {
  // Dev-only credentials for your fake user
  private readonly devEmail = 'dev-tester@example.com';
  private readonly devPassword = 'devtester123';

  // 'none'    -> no groups
  // 'pt'      -> only PT group
  // 'friends' -> only friends group
  // 'both'    -> PT + friends
  private readonly devGroupScenario: DevGroupScenario = 'pt';

  private readonly ptGroupId = 'DEV_PT_GROUP';
  private readonly friendsGroupId = 'DEV_FRIENDS_GROUP';

  constructor(
    private auth: Auth,
    private firestore: Firestore,
  ) {}

  /**
   * Ensures there is a dev user in Firebase Auth and
   * that /users/{uid}, /userStats/{uid}, and group membership
   * exist with dummy data.
   */
  async ensureDevUserAndSeed(): Promise<void> {
    console.log('[DevSeedService] ensureDevUserAndSeed() starting...');
    let user: User | null = null;

    try {
      const cred = await signInWithEmailAndPassword(
        this.auth,
        this.devEmail,
        this.devPassword,
      );
      user = cred.user;
      console.log(
        '[DevSeedService] Signed in existing dev user:',
        user.uid,
      );
    } catch (err: any) {
      if (err?.code === 'auth/user-not-found') {
        console.log(
          '[DevSeedService] Dev user not found, creating new one...',
        );
        const cred = await createUserWithEmailAndPassword(
          this.auth,
          this.devEmail,
          this.devPassword,
        );
        user = cred.user;
        console.log('[DevSeedService] Created dev user:', user.uid);
      } else {
        console.error('[DevSeedService] Error signing in dev user:', err);
        throw err;
      }
    }

    if (!user) {
      throw new Error(
        '[DevSeedService] Dev user is null after sign-in/sign-up',
      );
    }

    const uid = user.uid;

    const userRef = doc(this.firestore, 'users', uid);
    const userSnap = await getDoc(userRef);

    if (!userSnap.exists()) {
      console.log(
        '[DevSeedService] Creating /users doc for dev user...',
      );
      await setDoc(userRef, {
        userId: uid,
        name: 'Dev Test User',
        email: this.devEmail,
        isPT: false,
        ptUID: '',
        groups: [],
        // optional: keep /users in sync with region too
        region: {
          country: 'USA',
          state: 'Nevada',
          city: 'Reno',
        },
        created_at: serverTimestamp(),
      });
    } else {
      console.log(
        '[DevSeedService] /users doc already exists for dev user.',
      );
      // Make sure region exists on existing dev user as well
      await setDoc(
        userRef,
        {
          region: {
            country: 'USA',
            state: 'Nevada',
            city: 'Reno',
          },
        },
        { merge: true },
      );
    }

    const statsRef = doc(this.firestore, 'userStats', uid);
    const statsSnap = await getDoc(statsRef);

    if (!statsSnap.exists()) {
      console.log(
        '[DevSeedService] Creating /userStats doc for dev user...',
      );
      await setDoc(statsRef, {
        userId: uid,
        displayName: 'Dev Test User',
        total_work_score: 1500,
        cardio_work_score: 900,
        strength_work_score: 600,
        level: 7,
        region: {
          country: 'USA',
          state: 'Nevada',
          city: 'Reno',
        },
        last_updated_at: serverTimestamp(),
      });
    } else {
      console.log(
        '[DevSeedService] /userStats doc already exists for dev user.',
      );
      // Ensure existing stats have the fields we expect for leaderboard
      await setDoc(
        statsRef,
        {
          displayName: 'Dev Test User',
          region: {
            country: 'USA',
            state: 'Nevada',
            city: 'Reno',
          },
        },
        { merge: true },
      );
    }

    await this.ensureDevGroupsAndMembership(uid);
    await this.seedDummyUserStats();

    console.log('[DevSeedService] ensureDevUserAndSeed() finished.');
  }

  /**
   * Ensures dev PT + friends groups exist in /groupID
   * and sets the dev user's `groups` array based on devGroupScenario.
   *
   * Groups themselves are never deleted; only the user's membership array changes.
   */
  private async ensureDevGroupsAndMembership(uid: string): Promise<void> {
    console.log(
      '[DevSeedService] ensureDevGroupsAndMembership() with scenario:',
      this.devGroupScenario,
    );

    const groupsCollectionName = 'groupID';
    const userRef = doc(this.firestore, 'users', uid);

    const ptGroupRef = doc(this.firestore, groupsCollectionName, this.ptGroupId);
    const friendsGroupRef = doc(this.firestore, groupsCollectionName, this.friendsGroupId);

    // For PT scenarios ('pt' or 'both'), ensure PT group doc exists
    if (this.devGroupScenario === 'pt' || this.devGroupScenario === 'both') {
      const ptGroupSnap = await getDoc(ptGroupRef);
      if (!ptGroupSnap.exists()) {
        console.log('[DevSeedService] Creating PT group doc...');
        await setDoc(ptGroupRef, {
          groupId: this.ptGroupId,
          name: 'Dev PT Group',
          isPTGroup: true,
          ownerUserId: uid,
          created_at: serverTimestamp(),
        });
      } else {
        console.log('[DevSeedService] PT group doc already exists.');
      }
    }

    // For friends scenarios ('friends' or 'both'), ensure friends group doc exists
    if (this.devGroupScenario === 'friends' || this.devGroupScenario === 'both') {
      const friendsGroupSnap = await getDoc(friendsGroupRef);
      if (!friendsGroupSnap.exists()) {
        console.log('[DevSeedService] Creating friends group doc...');
        await setDoc(friendsGroupRef, {
          groupId: this.friendsGroupId,
          name: 'Dev Friends Group',
          isPTGroup: false,
          ownerUserId: uid,
          created_at: serverTimestamp(),
        });
      } else {
        console.log('[DevSeedService] Friends group doc already exists.');
      }
    }

    const groups: string[] = [];

    if (this.devGroupScenario === 'pt') {
      groups.push(this.ptGroupId);
    } else if (this.devGroupScenario === 'friends') {
      groups.push(this.friendsGroupId);
    } else if (this.devGroupScenario === 'both') {
      groups.push(this.ptGroupId, this.friendsGroupId);
    } else if (this.devGroupScenario === 'none') {
      // no groups: leave array empty
    }

    console.log('[DevSeedService] Setting groups on /users doc:', groups);

    await setDoc(
      userRef,
      { groups },
      { merge: true }
    );
  }

  /**
   * Seeds a set of dummy userStats docs with different regions and scores
   * for leaderboard testing. These are Firestore-only and do NOT correspond
   * to real Auth users.
   */
  private async seedDummyUserStats(): Promise<void> {
    console.log('[DevSeedService] Seeding dummy userStats for leaderboard...');

    const dummyUsers = [
      {
        userId: 'dummy_user_1',
        displayName: 'Alice Runner',
        region: { country: 'USA', state: 'California', city: 'San Francisco' },
        total_work_score: 3200,
        cardio_work_score: 2500,
        strength_work_score: 700,
        level: 10,
      },
      {
        userId: 'dummy_user_2',
        displayName: 'Bob Lifter',
        region: { country: 'USA', state: 'California', city: 'Los Angeles' },
        total_work_score: 2800,
        cardio_work_score: 1200,
        strength_work_score: 1600,
        level: 9,
      },
      {
        userId: 'dummy_user_3',
        displayName: 'Charlie Sprinter',
        region: { country: 'USA', state: 'Nevada', city: 'Reno' },
        total_work_score: 1900,
        cardio_work_score: 1700,
        strength_work_score: 200,
        level: 6,
      },
      {
        userId: 'dummy_user_4',
        displayName: 'Diana Athlete',
        region: { country: 'USA', state: 'New York', city: 'New York City' },
        total_work_score: 4100,
        cardio_work_score: 2100,
        strength_work_score: 2000,
        level: 12,
      },
      {
        userId: 'dummy_user_5',
        displayName: 'Ethan Strong',
        region: { country: 'Canada', state: 'Ontario', city: 'Toronto' },
        total_work_score: 2300,
        cardio_work_score: 800,
        strength_work_score: 1500,
        level: 8,
      },
      {
        userId: 'dummy_user_6',
        displayName: 'Fiona Cardio',
        region: { country: 'Canada', state: 'British Columbia', city: 'Vancouver' },
        total_work_score: 2600,
        cardio_work_score: 2200,
        strength_work_score: 400,
        level: 9,
      },
      {
        userId: 'dummy_user_7',
        displayName: 'George Power',
        region: { country: 'UK', state: 'England', city: 'London' },
        total_work_score: 3500,
        cardio_work_score: 1500,
        strength_work_score: 2000,
        level: 11,
      },
      {
        userId: 'dummy_user_8',
        displayName: 'Hannah Balance',
        region: { country: 'Germany', state: 'Bavaria', city: 'Munich' },
        total_work_score: 2700,
        cardio_work_score: 1350,
        strength_work_score: 1350,
        level: 9,
      },
    ];

    for (const dummy of dummyUsers) {
      const ref = doc(this.firestore, 'userStats', dummy.userId);
      await setDoc(
        ref,
        {
          userId: dummy.userId,
          displayName: dummy.displayName,
          total_work_score: dummy.total_work_score,
          cardio_work_score: dummy.cardio_work_score,
          strength_work_score: dummy.strength_work_score,
          level: dummy.level,
          region: dummy.region,
          last_updated_at: serverTimestamp(),
        },
        { merge: true },
      );
    }

    console.log('[DevSeedService] Dummy userStats seeding complete.');
  }
}
