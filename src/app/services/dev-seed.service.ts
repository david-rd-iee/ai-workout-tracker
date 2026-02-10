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

type DevGroupScenario = 'none' | 'pt' | 'friends' | 'both';

@Injectable({ providedIn: 'root' })
export class DevSeedService {
  private readonly devEmail = 'dev-tester@example.com';
  private readonly devPassword = 'devtester123';

  // ✅ Force the dev UID (this is the Firestore document ID)
  private readonly DEV_UID = 'Zas8MzSObSfvv3SRMINzWMiQFg63';

  private readonly devGroupScenario: DevGroupScenario = 'none';

  private readonly ptGroupId = 'DEV_PT_GROUP';
  private readonly friendsGroupId = 'DEV_FRIENDS_GROUP';

  constructor(private auth: Auth, private firestore: Firestore) {}

  async ensureDevUserAndSeed(): Promise<void> {
    console.log('[DevSeedService] ensureDevUserAndSeed() starting...');
    let user: User | null = null;

    // 1) Sign in or create the dev auth user
    try {
      const cred = await signInWithEmailAndPassword(
        this.auth,
        this.devEmail,
        this.devPassword,
      );
      user = cred.user;
      console.log('[DevSeedService] Signed in existing dev user:', user.uid);
    } catch (err: any) {
      if (err?.code === 'auth/user-not-found') {
        console.log('[DevSeedService] Dev user not found, creating new one...');
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
      throw new Error('[DevSeedService] Dev user is null after sign-in/sign-up');
    }

    // ✅ Always use the fixed UID for seeding Firestore
    const uid = this.DEV_UID;

    // ✅ Guard against Auth/Firestore mismatch (recommended)
    if (user.uid !== uid) {
      throw new Error(
        `[DevSeedService] Auth UID mismatch.\n` +
          `Signed-in Auth uid=${user.uid}\n` +
          `But DEV_UID=${uid}\n` +
          `Fix: sign into the Firebase Auth user whose UID is ${uid} (update devEmail/devPassword), ` +
          `or remove this guard if you intentionally want mismatch.`,
      );
    }

    console.log('[DevSeedService] Using dev UID (Firestore doc id):', uid);

    // 2) Ensure /users/{uid} exists
    const userRef = doc(this.firestore, 'users', uid);
    const userSnap = await getDoc(userRef);

    if (!userSnap.exists()) {
      console.log('[DevSeedService] Creating /users doc for dev user...');

      // ✅ No "userId" field inside doc; docId IS the userId
      await setDoc(userRef, {
        email: this.devEmail,
        firstName: 'Dev',
        lastName: 'Tester',
        username: 'devtester',
        role: 'client',
        profilePic: '',
        groupID: [],
        created_at: serverTimestamp(),
        // region: { country:'USA', state:'Nevada', city:'Reno' }, // keep only if your new schema still uses it
      });
    } else {
      console.log('[DevSeedService] /users doc already exists for dev user.');
      // optionally merge any missing fields you want enforced:
      await setDoc(
        userRef,
        {
          // example: ensure groupID exists
          groupID: [],
        },
        { merge: true },
      );
    }

    // 3) Ensure /userStats/{uid} exists (keep or update based on your schema)
    const statsRef = doc(this.firestore, 'userStats', uid);
    const statsSnap = await getDoc(statsRef);

    if (!statsSnap.exists()) {
      console.log('[DevSeedService] Creating /userStats doc for dev user...');
      await setDoc(statsRef, {
        // If your stats schema no longer stores userId, remove it too.
        // userId: uid,
        displayName: 'Dev Tester',
        total_work_score: 1500,
        cardio_work_score: 900,
        strength_work_score: 600,
        level: 7,
        last_updated_at: serverTimestamp(),
      });
    }
  }

  private async ensureDevGroupsAndMembership(uid: string): Promise<void> {
    console.log('[DevSeedService] ensureDevGroupsAndMembership() scenario:', this.devGroupScenario);

    const groupsCollectionName = 'groupID';
    const userRef = doc(this.firestore, 'users', uid);

    const ptGroupRef = doc(this.firestore, groupsCollectionName, this.ptGroupId);
    const friendsGroupRef = doc(this.firestore, groupsCollectionName, this.friendsGroupId);

    if (this.devGroupScenario === 'pt' || this.devGroupScenario === 'both') {
      const ptGroupSnap = await getDoc(ptGroupRef);
      if (!ptGroupSnap.exists()) {
        await setDoc(ptGroupRef, {
          groupId: this.ptGroupId,
          name: 'Dev PT Group',
          isPTGroup: true,
          ownerUserId: uid,
          created_at: serverTimestamp(),
        });
      }
    }

    if (this.devGroupScenario === 'friends' || this.devGroupScenario === 'both') {
      const friendsGroupSnap = await getDoc(friendsGroupRef);
      if (!friendsGroupSnap.exists()) {
        await setDoc(friendsGroupRef, {
          groupId: this.friendsGroupId,
          name: 'Dev Friends Group',
          isPTGroup: false,
          ownerUserId: uid,
          created_at: serverTimestamp(),
        });
      }
    }

    const groupID: string[] = [];
    if (this.devGroupScenario === 'pt') groupID.push(this.ptGroupId);
    else if (this.devGroupScenario === 'friends') groupID.push(this.friendsGroupId);
    else if (this.devGroupScenario === 'both') groupID.push(this.ptGroupId, this.friendsGroupId);

    console.log('[DevSeedService] Setting groupID on /users doc:', groupID);

    // ✅ Use groupID (matches your model) instead of "groups"
    await setDoc(userRef, { groupID }, { merge: true });
  }

  // ... keep seedDummyUserStats() and seedDevBadges() as-is,
  // but remove `userId:` fields inside their documents too if your new schemas don't include it.
}
