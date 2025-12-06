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

@Injectable({
  providedIn: 'root',
})
export class DevSeedService {
  // Dev-only credentials for your fake user
  private readonly devEmail = 'dev-tester@example.com';
  private readonly devPassword = 'devtester123';

  //UID: uAm8BLANNEQG5WJHlimFO9QSxHt2

  constructor(
    private auth: Auth,
    private firestore: Firestore,
  ) {}

  /**
   * Ensures there is a dev user in Firebase Auth and
   * that /users/{uid} and /userStats/{uid} exist with dummy data.
   */
  async ensureDevUserAndSeed(): Promise<void> {
    console.log('[DevSeedService] ensureDevUserAndSeed() starting...');
    let user: User | null = null;

    // 1) Sign in or create the dev account
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

    // 2) Seed /users/{uid}
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
        role: 'USER', // or 'TRAINER' if you want to fake a trainer
        created_at: serverTimestamp(),
      });
    } else {
      console.log(
        '[DevSeedService] /users doc already exists for dev user.',
      );
    }

    // 3) Seed /userStats/{uid}
    const statsRef = doc(this.firestore, 'userStats', uid);
    const statsSnap = await getDoc(statsRef);

    if (!statsSnap.exists()) {
      console.log(
        '[DevSeedService] Creating /userStats doc for dev user...',
      );
      await setDoc(statsRef, {
        userId: uid,
        total_work_score: 1500,
        cardio_work_score: 900,
        strength_work_score: 600,
        level: 7,
        last_updated_at: serverTimestamp(),
      });
    } else {
      console.log(
        '[DevSeedService] /userStats doc already exists for dev user.',
      );
    }

    console.log('[DevSeedService] ensureDevUserAndSeed() finished.');
  }
}
