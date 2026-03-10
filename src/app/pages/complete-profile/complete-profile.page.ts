import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  IonContent,
  IonItem,
  IonInput,
  IonButton,
  IonText,
  IonSelect,
  IonSelectOption,
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
    IonSelect,
    IonSelectOption,
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
  sex: string | number | null = null;
  isTrainerNameOnly = false;

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
    const requiresExtendedProfile = !this.isTrainerNameOnly;
    const age = requiresExtendedProfile ? this.parsePositiveInteger(this.age) : null;
    const heightMeters = requiresExtendedProfile ? this.parsePositiveNumber(this.heightMeters) : null;
    const weightKg = requiresExtendedProfile ? this.parsePositiveNumber(this.weightKg) : null;
    const sex = requiresExtendedProfile ? this.parseSexValue(this.sex) : null;
    const bmi =
      requiresExtendedProfile && heightMeters !== null && weightKg !== null
        ? this.calculateBmi(heightMeters, weightKg)
        : null;

    const missingRequiredFields =
      !firstName ||
      !lastName ||
      (requiresExtendedProfile &&
        (!username ||
          age === null ||
          heightMeters === null ||
          weightKg === null ||
          bmi === null ||
          sex === null));

    if (missingRequiredFields) {
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
          ...(username ? { username } : {}),
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      if (requiresExtendedProfile) {
        const userStatsRef = doc(this.firestore, 'userStats', uid);
        await setDoc(
          userStatsRef,
          {
            userId: uid,
            age,
            heightMeters,
            weightKg,
            bmi,
            sex,
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
      }

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
      this.isTrainerNameOnly = data?.['isPT'] === true;

      if (this.isTrainerNameOnly) {
        return;
      }

      const userStatsRef = doc(this.firestore, 'userStats', uid);
      const userStatsSnap = await getDoc(userStatsRef);
      if (userStatsSnap.exists()) {
        const stats = userStatsSnap.data();
        const age = this.parsePositiveInteger(stats?.['age']);
        const heightMeters = this.parsePositiveNumber(stats?.['heightMeters']);
        const weightKg = this.parsePositiveNumber(stats?.['weightKg']);
        const sex = this.parseSexValue(stats?.['sex']);

        this.age = age === null ? '' : String(age);
        this.heightMeters = heightMeters === null ? '' : String(heightMeters);
        this.weightKg = weightKg === null ? '' : String(weightKg);
        this.sex = sex;
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

  private calculateBmi(heightMeters: number, weightKg: number): number | null {
    if (!Number.isFinite(heightMeters) || !Number.isFinite(weightKg) || heightMeters <= 0 || weightKg <= 0) {
      return null;
    }

    const bmi = weightKg / (heightMeters * heightMeters);
    return Number.isFinite(bmi) ? Number(bmi.toFixed(2)) : null;
  }

  private parseSexValue(value: unknown): number | null {
    const parsed = Number(String(value ?? '').trim());
    if (parsed === 1 || parsed === 1.5 || parsed === 2) {
      return parsed;
    }
    return null;
  }
}
