import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  IonButton,
  IonContent,
  IonInput,
  IonItem,
  IonSelect,
  IonSelectOption,
  IonText,
  IonTextarea,
} from '@ionic/angular/standalone';
import { Router } from '@angular/router';
import { Auth, onAuthStateChanged } from '@angular/fire/auth';
import { Firestore, doc, setDoc, serverTimestamp } from '@angular/fire/firestore';
import { ProfileRepositoryService } from '../../../services/account/profile-repository.service';
import { UserService } from '../../../services/account/user.service';
import { clientProfile } from '../../../Interfaces/Profiles/client';

type UnitSystem = 'metric' | 'imperial';

@Component({
  selector: 'app-complete-profile-client',
  templateUrl: './complete-profile-client.page.html',
  styleUrls: ['./complete-profile-client.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    IonButton,
    IonContent,
    IonInput,
    IonItem,
    IonSelect,
    IonSelectOption,
    IonText,
    IonTextarea,
  ],
})
export class CompleteProfileClientPage implements OnInit {
  private router = inject(Router);
  private auth = inject(Auth);
  private firestore = inject(Firestore);
  private profileRepository = inject(ProfileRepositoryService);
  private userService = inject(UserService);

  firstName = '';
  lastName = '';
  username = '';
  phone = '';
  city = '';
  state = '';
  zip = '';
  goals = '';
  experience = '';
  description = '';
  age: string | number = '';
  heightMeters: string | number = '';
  weightKg: string | number = '';
  heightFeet: string | number = '';
  heightInches: string | number = '';
  weightPounds: string | number = '';
  unitSystem: UnitSystem = 'metric';
  sex: string | number | null = null;
  isSubmitting = false;
  errorMessage = '';

  ngOnInit(): void {
    void this.ensureAuthenticated();
  }

  async onSubmit(): Promise<void> {
    this.errorMessage = '';

    const firstName = this.firstName.trim();
    const lastName = this.lastName.trim();
    const username = this.username.trim();
    const phone = this.phone.trim();
    const city = this.city.trim();
    const state = this.state.trim().toUpperCase();
    const goals = this.goals.trim();
    const experience = this.experience.trim();
    const description = this.description.trim();
    const age = this.parsePositiveInteger(this.age);
    const sex = this.parseSexValue(this.sex);
    const zipNumber = this.parseZipCode(this.zip);

    let heightMeters = this.parsePositiveNumber(this.heightMeters);
    let weightKg = this.parsePositiveNumber(this.weightKg);

    if (this.unitSystem === 'imperial') {
      const metricValues = this.getMetricValuesFromImperial();
      heightMeters = metricValues.heightMeters;
      weightKg = metricValues.weightKg;

      if (heightMeters !== null) {
        this.heightMeters = this.formatDecimal(heightMeters, 4);
      }
      if (weightKg !== null) {
        this.weightKg = this.formatDecimal(weightKg, 3);
      }
    }

    const bmi =
      heightMeters !== null && weightKg !== null
        ? this.calculateBmi(heightMeters, weightKg)
        : null;

    if (
      !firstName ||
      !lastName ||
      !username ||
      !phone ||
      !city ||
      !state ||
      zipNumber === null ||
      age === null ||
      sex === null
    ) {
      this.errorMessage = 'Please fill out all required fields.';
      return;
    }

    if (heightMeters === null || heightMeters <= 0) {
      this.errorMessage =
        this.unitSystem === 'imperial'
          ? 'Enter a valid height in feet and inches.'
          : 'Height (m) must be greater than 0.';
      return;
    }

    if (weightKg === null || weightKg <= 0) {
      this.errorMessage =
        this.unitSystem === 'imperial'
          ? 'Weight (lb) must be greater than 0.'
          : 'Weight (kg) must be greater than 0.';
      return;
    }

    if (bmi === null) {
      this.errorMessage = 'BMI could not be calculated from height and weight.';
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
      const profileData: clientProfile = {
        id: uid,
        firstName,
        lastName,
        email: this.auth.currentUser?.email ?? '',
        phone,
        profilepic: '',
        city,
        state,
        zip: zipNumber,
        accountType: 'client',
        goals,
        experience,
        description,
      };

      await this.userService.createUserProfile(profileData);

      const userRef = doc(this.firestore, 'users', uid);
      await setDoc(
        userRef,
        {
          userId: uid,
          email: this.auth.currentUser?.email ?? '',
          firstName,
          lastName,
          username,
          isPT: false,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      const userSummaryPatch = {
        userId: uid,
        email: this.auth.currentUser?.email ?? '',
        firstName,
        lastName,
        username,
        isPT: false,
      };
      this.profileRepository.applyUserSummaryPatch(uid, userSummaryPatch);
      this.userService.syncCurrentUserSummaryPatch(uid, userSummaryPatch);

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

      await this.userService.linkProfileByPhone(phone);
      await this.userService.loadUserProfile();
      await this.router.navigateByUrl('/tabs/home', { replaceUrl: true });
    } catch (error) {
      console.error('[CompleteProfileClientPage] Failed to save profile:', error);
      this.errorMessage = 'Failed to save profile. Please try again.';
    } finally {
      this.isSubmitting = false;
    }
  }

  onUnitSystemChange(): void {
    if (this.unitSystem === 'imperial') {
      this.syncImperialFromMetric();
      return;
    }

    const metricValues = this.getMetricValuesFromImperial();
    if (metricValues.heightMeters !== null) {
      this.heightMeters = this.formatDecimal(metricValues.heightMeters, 4);
    }
    if (metricValues.weightKg !== null) {
      this.weightKg = this.formatDecimal(metricValues.weightKg, 3);
    }
  }

  private async ensureAuthenticated(): Promise<void> {
    const uid = await this.resolveCurrentUid();
    if (!uid) {
      await this.router.navigateByUrl('/login', { replaceUrl: true });
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

  private syncImperialFromMetric(): void {
    const heightMeters = this.parseNumber(this.heightMeters);
    if (heightMeters === null || heightMeters <= 0) {
      this.heightFeet = '';
      this.heightInches = '';
    } else {
      const totalInches = heightMeters / 0.0254;
      let feet = Math.floor(totalInches / 12);
      let inches = Number((totalInches - feet * 12).toFixed(1));

      if (inches >= 12) {
        feet += 1;
        inches = 0;
      }

      this.heightFeet = String(feet);
      this.heightInches = this.formatDecimal(inches, 1);
    }

    const weightKg = this.parseNumber(this.weightKg);
    if (weightKg === null || weightKg <= 0) {
      this.weightPounds = '';
      return;
    }

    const pounds = weightKg / 0.45359237;
    this.weightPounds = this.formatDecimal(pounds, 1);
  }

  private getMetricValuesFromImperial(): { heightMeters: number | null; weightKg: number | null } {
    return {
      heightMeters: this.convertImperialHeightToMeters(this.heightFeet, this.heightInches),
      weightKg: this.convertPoundsToKilograms(this.weightPounds),
    };
  }

  private convertImperialHeightToMeters(feetValue: unknown, inchesValue: unknown): number | null {
    const feet = this.parseNumber(feetValue);
    const inches = this.parseNumber(inchesValue);

    if (feet === null && inches === null) {
      return null;
    }

    const safeFeet = feet ?? 0;
    const safeInches = inches ?? 0;
    if (!Number.isInteger(safeFeet) || safeFeet < 0 || safeInches < 0 || safeInches >= 12) {
      return null;
    }

    const totalInches = safeFeet * 12 + safeInches;
    if (totalInches <= 0) {
      return null;
    }

    return Number((totalInches * 0.0254).toFixed(4));
  }

  private convertPoundsToKilograms(poundsValue: unknown): number | null {
    const pounds = this.parseNumber(poundsValue);
    if (pounds === null || pounds <= 0) {
      return null;
    }

    return Number((pounds * 0.45359237).toFixed(3));
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

  private parseZipCode(value: unknown): number | null {
    const trimmed = String(value ?? '').trim();
    if (!/^\d{5}$/.test(trimmed)) {
      return null;
    }

    return Number(trimmed);
  }

  private parseNumber(value: unknown): number | null {
    if (value === null || value === undefined) {
      return null;
    }

    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : null;
    }

    const trimmed = String(value).trim();
    if (!trimmed) {
      return null;
    }

    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private formatDecimal(value: number, decimalPlaces: number): string {
    return value.toFixed(decimalPlaces).replace(/\.?0+$/, '');
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
