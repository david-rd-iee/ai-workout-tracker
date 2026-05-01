import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  IonButton,
  IonCheckbox,
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
import { trainerProfile } from '../../../Interfaces/Profiles/Trainer';
import { UserService } from '../../../services/account/user.service';

@Component({
  selector: 'app-complete-profile-trainer',
  templateUrl: './complete-profile-trainer.page.html',
  styleUrls: ['./complete-profile-trainer.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    IonButton,
    IonCheckbox,
    IonContent,
    IonInput,
    IonItem,
    IonSelect,
    IonSelectOption,
    IonText,
    IonTextarea,
  ],
})
export class CompleteProfileTrainerPage implements OnInit {
  private router = inject(Router);
  private auth = inject(Auth);
  private userService = inject(UserService);

  firstName = '';
  lastName = '';
  phone = '';
  age: string | number = '';
  sex: string | number | null = null;
  heightMeters: string | number = '';
  weightKg: string | number = '';
  specialization = '';
  experience = '';
  education = '';
  description = '';
  city = '';
  state = '';
  zip = '';
  certificationsInput = '';
  hourlyRate: string | number = '';
  remote = true;
  inPerson = false;
  visible = true;
  isSubmitting = false;
  errorMessage = '';
  readonly sexOptions = [
    { value: 1, label: 'Male' },
    { value: 2, label: 'Female' },
    { value: 1.5, label: 'Other' },
  ];

  ngOnInit(): void {
    void this.ensureAuthenticated();
  }

  async onSubmit(): Promise<void> {
    this.errorMessage = '';

    const firstName = this.firstName.trim();
    const lastName = this.lastName.trim();
    const phone = this.phone.trim();
    const age = this.parsePositiveInteger(this.age);
    const sex = this.parseSexValue(this.sex);
    const heightMeters = this.parsePositiveNumber(this.heightMeters);
    const weightKg = this.parsePositiveNumber(this.weightKg);
    const specialization = this.specialization.trim();
    const experience = this.experience.trim();
    const education = this.education.trim();
    const description = this.description.trim();
    const city = this.city.trim();
    const state = this.state.trim().toUpperCase();
    const zipNumber = this.parseZipCode(this.zip);
    const hourlyRate = this.parsePositiveNumber(this.hourlyRate);
    const certifications = this.certificationsInput
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);

    const missingFields: string[] = [];
    if (!firstName) missingFields.push('first name');
    if (!lastName) missingFields.push('last name');
    if (!phone) missingFields.push('phone');
    if (age === null) missingFields.push('age');
    if (sex === null) missingFields.push('sex');
    if (heightMeters === null) missingFields.push('height');
    if (weightKg === null) missingFields.push('weight');
    if (!specialization) missingFields.push('specialization');
    if (!experience) missingFields.push('experience');
    if (!education) missingFields.push('education / certifications');
    if (!city) missingFields.push('city');
    if (!state) missingFields.push('state');
    if (zipNumber === null) missingFields.push('a valid 5-digit zip code');

    if (missingFields.length > 0) {
      this.errorMessage = `Please complete: ${missingFields.join(', ')}.`;
      return;
    }

    if (description.length < 20) {
      this.errorMessage = 'Background and experience must be at least 20 characters.';
      return;
    }

    if (!this.remote && !this.inPerson) {
      this.errorMessage = 'Select at least one training format.';
      return;
    }

    const resolvedZip = zipNumber as number;

    const uid = await this.resolveCurrentUid();
    if (!uid) {
      this.errorMessage = 'You must be logged in to continue.';
      await this.router.navigateByUrl('/login', { replaceUrl: true });
      return;
    }

    this.isSubmitting = true;
    try {
      const profileData: trainerProfile = {
        id: uid,
        firstName,
        lastName,
        email: this.auth.currentUser?.email ?? '',
        phone,
        profilepic: '',
        city,
        state,
        zip: resolvedZip,
        age,
        heightMeters,
        weightKg,
        sex,
        accountType: 'trainer',
        specialization,
        experience,
        education,
        description,
        certifications,
        trainingLocation: {
          remote: this.remote,
          inPerson: this.inPerson,
        },
        visible: false,
        approvalStatus: 'pending',
        ...(hourlyRate !== null ? { hourlyRate } : {}),
      };

      await this.userService.createUserProfile(profileData);
      await this.router.navigateByUrl('/trainer-approval-pending', { replaceUrl: true });
    } catch (error) {
      console.error('[CompleteProfileTrainerPage] Failed to save trainer profile:', error);
      this.errorMessage = 'Failed to save trainer profile. Please try again.';
    } finally {
      this.isSubmitting = false;
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

  private parseZipCode(value: unknown): number | null {
    const trimmed = String(value ?? '').trim();
    if (!/^\d{5}$/.test(trimmed)) {
      return null;
    }

    return Number(trimmed);
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
    const parsed = Number(String(value ?? '').trim());
    if (!Number.isFinite(parsed) || parsed <= 0 || !Number.isInteger(parsed)) {
      return null;
    }

    return parsed;
  }

  private parseSexValue(value: unknown): number | null {
    const parsed = Number(String(value ?? '').trim());
    if (parsed === 1 || parsed === 1.5 || parsed === 2) {
      return parsed;
    }

    return null;
  }
}
