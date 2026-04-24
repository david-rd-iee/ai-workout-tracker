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
import { Auth, onAuthStateChanged } from '@angular/fire/auth';
import { Firestore } from '@angular/fire/firestore';
import { Router } from '@angular/router';
import { RouterModule } from '@angular/router';
import { EmailAuthProvider, reauthenticateWithCredential, updateEmail, User, verifyBeforeUpdateEmail } from 'firebase/auth';
import { FirebaseError } from 'firebase/app';
import { AlertController } from '@ionic/angular';
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { AccountService } from '../../services/account/account.service';
import { ProfileRepositoryService } from '../../services/account/profile-repository.service';
import { UserService } from '../../services/account/user.service';
import { NotificationService } from '../../services/notification.service';
import { HeaderComponent } from '../../components/header/header.component';
import { environment } from '../../../environments/environment';
import { ROUTE_PATHS } from '../../app.routes';
import {
  TrainerPaymentsService,
  TrainerStripeConnectSummary,
} from '../../services/trainer-payments.service';

type UnitSystem = 'metric' | 'imperial';

@Component({
  selector: 'app-profile-settings',
  templateUrl: './profile-settings.page.html',
  styleUrls: ['./profile-settings.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    IonContent,
    IonButton,
    IonItem,
    IonInput,
    IonSelect,
    IonSelectOption,
    IonText,
    IonTextarea,
    HeaderComponent,
  ],
})
export class ProfileSettingsPage implements OnInit {
  private firestore = inject(Firestore);
  private auth = inject(Auth);
  private router = inject(Router);
  private alertCtrl = inject(AlertController);
  private accountService = inject(AccountService);
  private profileRepository = inject(ProfileRepositoryService);
  private userService = inject(UserService);
  private trainerPaymentsService = inject(TrainerPaymentsService);
  readonly notificationService = inject(NotificationService);

  firstName = '';
  lastName = '';
  email = '';
  initialEmail = '';
  age: string | number | null = '';
  heightMeters: string | number | null = '';
  weightKg: string | number | null = '';
  heightFeet: string | number | null = '';
  heightInches: string | number | null = '';
  weightPounds: string | number | null = '';
  unitSystem: UnitSystem = 'metric';
  sex: string | number | null = null;
  goals = '';
  experience = '';
  description = '';
  isTrainer = false;
  canManageTrainerApprovals = false;
  readonly ROUTE_PATHS = ROUTE_PATHS;
  trainerPaymentSummary: TrainerStripeConnectSummary | null = null;
  isLoadingTrainerPaymentSummary = false;

  isLoading = false;
  isSaving = false;
  errorMessage = '';
  successMessage = '';
  private initialClientStats: {
    age: number | null;
    heightMeters: number | null;
    weightKg: number | null;
    sex: number | null;
  } = {
    age: null,
    heightMeters: null,
    weightKg: null,
    sex: null,
  };

  ngOnInit(): void {
    void this.loadSettings();
  }

  get trainerPaymentsReadyForPayout(): boolean {
    const summary = this.trainerPaymentSummary;
    if (!summary) {
      return false;
    }

    return summary.detailsSubmitted && summary.chargesEnabled && summary.payoutsEnabled;
  }

  formatStripeAccountId(accountId: string): string {
    const normalized = String(accountId || '').trim();
    if (normalized.length <= 10) {
      return normalized;
    }

    return `${normalized.slice(0, 6)}...${normalized.slice(-4)}`;
  }

  async logout(): Promise<void> {
    await this.accountService.logout();
  }

  async saveSettings(): Promise<void> {
    this.errorMessage = '';
    this.successMessage = '';

    const authUser = await this.resolveCurrentUser();
    if (!authUser) {
      this.errorMessage = 'You must be logged in to update settings.';
      await this.router.navigateByUrl('/login', { replaceUrl: true });
      return;
    }
    const uid = authUser.uid;

    const firstName = this.firstName.trim();
    const lastName = this.lastName.trim();
    const email = this.email.trim();

    if (!firstName || !lastName || !email) {
      this.errorMessage = 'First name, last name, and email are required.';
      return;
    }

    const shouldSaveStats = !this.isTrainer;
    const goals = shouldSaveStats ? this.goals.trim() : '';
    const experience = shouldSaveStats ? this.experience.trim() : '';
    const description = shouldSaveStats ? this.description.trim() : '';
    const parsedAge = shouldSaveStats ? this.parseNumber(this.age) : null;
    let parsedHeightMeters = shouldSaveStats ? this.parseNumber(this.heightMeters) : null;
    let parsedWeightKg = shouldSaveStats ? this.parseNumber(this.weightKg) : null;
    const parsedSex = shouldSaveStats ? this.parseSexValue(this.sex) : null;

    if (shouldSaveStats && this.unitSystem === 'imperial') {
      const metricValues = this.getMetricValuesFromImperial();
      parsedHeightMeters = metricValues.heightMeters;
      parsedWeightKg = metricValues.weightKg;

      if (parsedHeightMeters !== null) {
        this.heightMeters = this.formatDecimal(parsedHeightMeters, 4);
      }
      if (parsedWeightKg !== null) {
        this.weightKg = this.formatDecimal(parsedWeightKg, 3);
      }
    }

    const bmi =
      shouldSaveStats && parsedHeightMeters !== null && parsedWeightKg !== null
        ? this.calculateBmi(parsedHeightMeters, parsedWeightKg)
        : null;

    if (shouldSaveStats && (parsedAge === null || !Number.isInteger(parsedAge) || parsedAge <= 0)) {
      this.errorMessage = 'Age must be a whole number greater than 0.';
      return;
    }

    if (shouldSaveStats && (parsedHeightMeters === null || parsedHeightMeters <= 0)) {
      this.errorMessage = this.unitSystem === 'imperial'
        ? 'Enter a valid height in feet and inches (inches must be less than 12).'
        : 'Height (m) must be greater than 0.';
      return;
    }

    if (shouldSaveStats && (parsedWeightKg === null || parsedWeightKg <= 0)) {
      this.errorMessage = this.unitSystem === 'imperial'
        ? 'Weight (lb) must be greater than 0.'
        : 'Weight (kg) must be greater than 0.';
      return;
    }

    if (shouldSaveStats && parsedSex === null) {
      this.errorMessage = 'Please select sex.';
      return;
    }

    if (shouldSaveStats && bmi === null) {
      this.errorMessage = 'BMI could not be calculated from height and weight.';
      return;
    }

    const didClientStatsChange = shouldSaveStats && this.haveClientStatsChanged(
      parsedAge,
      parsedHeightMeters,
      parsedWeightKg,
      parsedSex
    );

    this.isSaving = true;

    let emailForUsersDoc = email;
    let emailUpdateError: string | null = null;
    let emailVerificationSent = false;

    try {
      const emailChanged = this.normalizeEmail(email) !== this.normalizeEmail(this.initialEmail);
      if (emailChanged) {
        try {
          const result = await this.updateAuthEmailWithReauthIfNeeded(authUser, email);
          if (result === 'updated') {
            this.initialEmail = email;
          } else if (result === 'verification-sent') {
            emailVerificationSent = true;
            emailForUsersDoc = this.initialEmail || (authUser.email ?? '').trim() || email;
          }
        } catch (emailError: unknown) {
          console.error('[ProfileSettingsPage] Email update failed:', emailError);
          emailUpdateError = this.getUserFriendlyAuthError(emailError);
          emailForUsersDoc = this.initialEmail || (authUser.email ?? '').trim() || email;
        }
      }

      const userRef = doc(this.firestore, 'users', uid);
      await setDoc(
        userRef,
        {
          userId: uid,
          firstName,
          lastName,
          email: emailForUsersDoc,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      const userSummaryPatch = {
        userId: uid,
        firstName,
        lastName,
        email: emailForUsersDoc,
      };
      this.profileRepository.applyUserSummaryPatch(uid, userSummaryPatch);
      this.userService.syncCurrentUserSummaryPatch(uid, userSummaryPatch);

      if (shouldSaveStats) {
        const clientProfilePatch = {
          goals,
          experience,
          description,
          updatedAt: serverTimestamp(),
        };
        await setDoc(doc(this.firestore, 'clients', uid), clientProfilePatch, { merge: true });
        this.profileRepository.applyProfilePatch(uid, 'client', { goals, experience, description });
        this.userService.syncCurrentUserProfilePatch(uid, 'client', { goals, experience, description });

        const userStatsPayload: Record<string, unknown> = {
          userId: uid,
          age: parsedAge,
          heightMeters: parsedHeightMeters,
          weightKg: parsedWeightKg,
          sex: parsedSex,
          bmi,
          ...(didClientStatsChange ? { trainerVerified: false } : {}),
          updatedAt: serverTimestamp(),
        };

        const userStatsRef = doc(this.firestore, 'userStats', uid);
        await setDoc(userStatsRef, userStatsPayload, { merge: true });

        this.initialClientStats = {
          age: parsedAge,
          heightMeters: parsedHeightMeters,
          weightKg: parsedWeightKg,
          sex: parsedSex,
        };
      }

      if (emailVerificationSent) {
        this.errorMessage =
          'Verification email sent. Confirm the new email, then save again to sync it here.';
        this.successMessage = shouldSaveStats
          ? 'Profile details and body metrics were saved.'
          : 'Name and email were saved.';
        this.email = emailForUsersDoc;
      } else if (emailUpdateError) {
        this.errorMessage = emailUpdateError;
        this.successMessage = shouldSaveStats
          ? 'Profile details and body metrics were saved.'
          : 'Name and email were saved.';
        this.email = emailForUsersDoc;
      } else {
        this.successMessage = 'Settings saved.';
      }
    } catch (error: unknown) {
      console.error('[ProfileSettingsPage] Failed to save settings:', error);
      this.errorMessage = this.getUserFriendlyAuthError(error);
    } finally {
      this.isSaving = false;
    }
  }

  private async loadSettings(): Promise<void> {
    this.isLoading = true;
    this.errorMessage = '';

    const authUser = await this.resolveCurrentUser();
    const uid = authUser?.uid ?? null;
    if (!uid) {
      this.errorMessage = 'You must be logged in to view settings.';
      await this.router.navigateByUrl('/login', { replaceUrl: true });
      this.isLoading = false;
      return;
    }

    try {
      const userStatsRef = doc(this.firestore, 'userStats', uid);
      const [userSnap, userStatsSnap] = await Promise.all([
        this.profileRepository.getUserSummary(uid),
        getDoc(userStatsRef),
      ]);

      if (userSnap) {
        this.isTrainer = userSnap.isPT === true;
        this.firstName = typeof userSnap.firstName === 'string' ? userSnap.firstName : '';
        this.lastName = typeof userSnap.lastName === 'string' ? userSnap.lastName : '';
        this.email = typeof userSnap.email === 'string' ? userSnap.email : '';
        const role = String((userSnap as any).role || '').trim().toLowerCase();
        const currentEmail = String(userSnap.email || '').trim().toLowerCase();
        const approvedReviewerEmails = (
          (environment as { adminReviewerEmails?: string[] }).adminReviewerEmails || []
        ).map((entry: string) => entry.trim().toLowerCase());
        this.canManageTrainerApprovals =
          role === 'admin' ||
          (currentEmail.length > 0 && approvedReviewerEmails.includes(currentEmail));
      }

      if (this.isTrainer) {
        await this.loadTrainerPaymentSummary(uid);
        this.goals = '';
        this.experience = '';
        this.description = '';
      } else {
        this.trainerPaymentSummary = null;
        const clientProfile = await this.profileRepository.getProfile(uid, 'client') as Record<string, unknown> | null;
        this.goals = typeof clientProfile?.['goals'] === 'string' ? clientProfile['goals'] : '';
        this.experience = typeof clientProfile?.['experience'] === 'string' ? clientProfile['experience'] : '';
        this.description = typeof clientProfile?.['description'] === 'string' ? clientProfile['description'] : '';
      }

      if (!this.email && this.auth.currentUser?.email) {
        this.email = this.auth.currentUser.email;
      }

      this.initialEmail = this.email.trim();

      if (userStatsSnap.exists()) {
        const userStatsData = userStatsSnap.data();
        const age = userStatsData?.['age'];
        const heightMeters = userStatsData?.['heightMeters'];
        const weightKg = userStatsData?.['weightKg'];
        const sex = userStatsData?.['sex'];

        this.age = typeof age === 'number' && age > 0 ? String(age) : '';
        this.heightMeters =
          typeof heightMeters === 'number' && heightMeters > 0 ? String(heightMeters) : '';
        this.weightKg = typeof weightKg === 'number' && weightKg > 0 ? String(weightKg) : '';
        const parsedSex = this.parseSexValue(sex);
        this.sex = parsedSex;
        this.initialClientStats = {
          age: typeof age === 'number' && age > 0 ? age : null,
          heightMeters: typeof heightMeters === 'number' && heightMeters > 0 ? heightMeters : null,
          weightKg: typeof weightKg === 'number' && weightKg > 0 ? weightKg : null,
          sex: parsedSex,
        };
      } else {
        this.age = '';
        this.heightMeters = '';
        this.weightKg = '';
        this.sex = null;
        this.initialClientStats = {
          age: null,
          heightMeters: null,
          weightKg: null,
          sex: null,
        };
      }

      this.syncImperialFromMetric();
    } catch (error) {
      console.error('[ProfileSettingsPage] Failed to load settings:', error);
      this.errorMessage = 'Failed to load settings.';
    } finally {
      this.isLoading = false;
    }
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

  private async loadTrainerPaymentSummary(uid: string): Promise<void> {
    this.isLoadingTrainerPaymentSummary = true;
    try {
      this.trainerPaymentSummary = await this.trainerPaymentsService.getStripeSummary(uid);
    } catch (error) {
      console.error('[ProfileSettingsPage] Failed to load trainer payment summary:', error);
      this.trainerPaymentSummary = null;
    } finally {
      this.isLoadingTrainerPaymentSummary = false;
    }
  }

  private convertPoundsToKilograms(poundsValue: unknown): number | null {
    const pounds = this.parseNumber(poundsValue);
    if (pounds === null || pounds <= 0) {
      return null;
    }

    return Number((pounds * 0.45359237).toFixed(3));
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

  private haveClientStatsChanged(
    age: number | null,
    heightMeters: number | null,
    weightKg: number | null,
    sex: number | null
  ): boolean {
    return (
      !this.areNumbersEqual(this.initialClientStats.age, age) ||
      !this.areNumbersEqual(this.initialClientStats.heightMeters, heightMeters) ||
      !this.areNumbersEqual(this.initialClientStats.weightKg, weightKg) ||
      !this.areNumbersEqual(this.initialClientStats.sex, sex)
    );
  }

  private areNumbersEqual(left: number | null, right: number | null): boolean {
    if (left === null || right === null) {
      return left === right;
    }

    return Math.abs(left - right) < 1e-9;
  }

  private async resolveCurrentUser(): Promise<User | null> {
    if (this.auth.currentUser) {
      return this.auth.currentUser;
    }

    return new Promise((resolve) => {
      const unsubscribe = onAuthStateChanged(this.auth, (user) => {
        unsubscribe();
        resolve(user ?? null);
      });
    });
  }

  private isRequiresRecentLoginError(error: unknown): boolean {
    return (
      error instanceof FirebaseError &&
      (error.code === 'auth/requires-recent-login' ||
        error.code === 'auth/user-token-expired')
    );
  }

  private async updateAuthEmailWithReauthIfNeeded(
    authUser: User,
    nextEmail: string
  ): Promise<'updated' | 'verification-sent'> {
    try {
      await updateEmail(authUser, nextEmail);
      return 'updated';
    } catch (error: unknown) {
      if (this.isEmailVerificationRequiredError(error)) {
        await verifyBeforeUpdateEmail(authUser, nextEmail);
        return 'verification-sent';
      }

      if (!this.isRequiresRecentLoginError(error)) {
        throw error;
      }
    }

    const hasPasswordProvider = authUser.providerData.some((provider) => provider.providerId === 'password');
    if (!hasPasswordProvider) {
      throw new FirebaseError(
        'auth/requires-recent-login',
        'Recent login required and no password provider is linked.'
      );
    }

    const password = await this.promptForCurrentPassword();
    if (!password) {
      throw new FirebaseError('auth/requires-recent-login', 'Re-authentication was canceled by the user.');
    }

    const currentEmail = authUser.email?.trim();
    if (!currentEmail) {
      throw new FirebaseError('auth/missing-email', 'Current auth email is missing.');
    }

    const credential = EmailAuthProvider.credential(currentEmail, password);
    await reauthenticateWithCredential(authUser, credential);
    try {
      await updateEmail(authUser, nextEmail);
      return 'updated';
    } catch (error: unknown) {
      if (this.isEmailVerificationRequiredError(error)) {
        await verifyBeforeUpdateEmail(authUser, nextEmail);
        return 'verification-sent';
      }
      throw error;
    }
  }

  private async promptForCurrentPassword(): Promise<string | null> {
    const alert = await this.alertCtrl.create({
      header: 'Confirm Password',
      message: 'Please enter your current password to change your email.',
      inputs: [
        {
          name: 'currentPassword',
          type: 'password',
          placeholder: 'Current password',
        },
      ],
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        { text: 'Continue', role: 'confirm' },
      ],
    });

    await alert.present();
    const result = await alert.onDidDismiss();
    if (result.role !== 'confirm') {
      return null;
    }

    const value = String(result.data?.values?.currentPassword ?? '').trim();
    return value || null;
  }

  private getUserFriendlyAuthError(error: unknown): string {
    if (!(error instanceof FirebaseError)) {
      return 'Failed to save settings. Please try again.';
    }

    switch (error.code) {
      case 'auth/requires-recent-login':
      case 'auth/user-token-expired':
        return 'For security, log out and back in, then try changing your email again.';
      case 'auth/invalid-email':
        return 'Please enter a valid email address.';
      case 'auth/email-already-in-use':
        return 'That email is already in use by another account.';
      case 'auth/wrong-password':
      case 'auth/invalid-credential':
        return 'Current password is incorrect.';
      case 'auth/network-request-failed':
        return 'Network error while updating email. Check your connection and try again.';
      case 'auth/too-many-requests':
        return 'Too many attempts. Please wait a bit and try again.';
      case 'auth/operation-not-allowed':
        return 'Email change is not allowed directly. Verify the new email first.';
      case 'auth/internal-error':
        return 'Auth service returned an internal error. Please try again.';
      default:
        return `Failed to update email (${error.code}).`;
    }
  }

  private isEmailVerificationRequiredError(error: unknown): boolean {
    return (
      error instanceof FirebaseError &&
      error.code === 'auth/operation-not-allowed' &&
      String(error.message).toLowerCase().includes('verify the new email')
    );
  }

  private normalizeEmail(value: string): string {
    return value.trim().toLowerCase();
  }
}
