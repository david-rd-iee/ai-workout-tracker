import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  IonContent,
  IonItem,
  IonInput,
  IonButton,
  IonText,
} from '@ionic/angular/standalone';
import { Router } from '@angular/router';
import { Auth, onAuthStateChanged } from '@angular/fire/auth';
import { Firestore, doc, getDoc, setDoc, serverTimestamp } from '@angular/fire/firestore';

@Component({
  selector: 'app-complete-profile',
  templateUrl: './complete-profile.page.html',
  styleUrls: ['./complete-profile.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    IonContent,
    IonItem,
    IonInput,
    IonButton,
    IonText,
  ],
})
export class CompleteProfilePage implements OnInit {
  private router = inject(Router);
  private auth = inject(Auth);
  private firestore = inject(Firestore);

  firstName = '';
  lastName = '';
  username = '';
  age: string | number = '';
  heightMeters: string | number = '';
  weightKg: string | number = '';

  isSubmitting = false;
  errorMessage = '';

  ngOnInit(): void {
    this.loadExistingUserProfile();
  }

  async onSubmit(): Promise<void> {
    this.errorMessage = '';

    const firstName = this.firstName.trim();
    const lastName = this.lastName.trim();
    const username = this.username.trim();
    const age = this.parsePositiveInteger(this.age);
    const heightMeters = this.parsePositiveNumber(this.heightMeters);
    const weightKg = this.parsePositiveNumber(this.weightKg);

    if (!firstName || !lastName || !username || age === null || heightMeters === null || weightKg === null) {
      this.errorMessage = 'Please fill out all fields.';
      return;
    }

    const uid = await this.resolveCurrentUid();
    if (!uid) {
      this.errorMessage = 'You must be logged in to continue.';
      await this.router.navigateByUrl('/login', { replaceUrl: true });
      return;
    }

    this.isSubmitting = true;
    try {
      const userRef = doc(this.firestore, 'users', uid);
      await setDoc(
        userRef,
        {
          userId: uid,
          email: this.auth.currentUser?.email ?? '',
          firstName,
          lastName,
          username,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      const userStatsRef = doc(this.firestore, 'userStats', uid);
      await setDoc(
        userStatsRef,
        {
          userId: uid,
          age,
          heightMeters,
          weightKg,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      await this.router.navigateByUrl('/tabs', { replaceUrl: true });
    } catch (error) {
      console.error('[CompleteProfilePage] Failed to save profile:', error);
      this.errorMessage = 'Failed to save profile. Please try again.';
    } finally {
      this.isSubmitting = false;
    }
  }

  private async loadExistingUserProfile(): Promise<void> {
    const uid = await this.resolveCurrentUid();
    if (!uid) {
      await this.router.navigateByUrl('/login', { replaceUrl: true });
      return;
    }

    try {
      const userRef = doc(this.firestore, 'users', uid);
      const userSnap = await getDoc(userRef);
      if (!userSnap.exists()) {
        return;
      }

      const data = userSnap.data();
      this.firstName = typeof data?.['firstName'] === 'string' ? data['firstName'] : '';
      this.lastName = typeof data?.['lastName'] === 'string' ? data['lastName'] : '';
      this.username = typeof data?.['username'] === 'string' ? data['username'] : '';

      const userStatsRef = doc(this.firestore, 'userStats', uid);
      const userStatsSnap = await getDoc(userStatsRef);
      if (userStatsSnap.exists()) {
        const stats = userStatsSnap.data();
        const age = this.parsePositiveInteger(stats?.['age']);
        const heightMeters = this.parsePositiveNumber(stats?.['heightMeters']);
        const weightKg = this.parsePositiveNumber(stats?.['weightKg']);

        this.age = age === null ? '' : String(age);
        this.heightMeters = heightMeters === null ? '' : String(heightMeters);
        this.weightKg = weightKg === null ? '' : String(weightKg);
      }
    } catch (error) {
      console.error('[CompleteProfilePage] Failed to load existing profile fields:', error);
    }
  }

  private async resolveCurrentUid(): Promise<string | null> {
    if (this.auth.currentUser?.uid) {
      return this.auth.currentUser.uid;
    }

    return new Promise((resolve) => {
      const unsubscribe = onAuthStateChanged(this.auth, (user) => {
        unsubscribe();
        resolve(user?.uid ?? null);
      });
    });
  }

  private parsePositiveNumber(value: unknown): number | null {
    if (typeof value === 'number') {
      return Number.isFinite(value) && value > 0 ? value : null;
    }

    const trimmed = String(value ?? '').trim();
    if (!trimmed) {
      return null;
    }

    const parsed = Number(trimmed);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }

  private parsePositiveInteger(value: unknown): number | null {
    const parsed = this.parsePositiveNumber(value);
    if (parsed === null) {
      return null;
    }

    return Number.isInteger(parsed) ? parsed : null;
  }
}
