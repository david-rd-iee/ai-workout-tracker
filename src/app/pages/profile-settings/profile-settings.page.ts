import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NavController } from '@ionic/angular';
import {
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonIcon,
  IonInput,
  IonItem,
  IonSelect,
  IonSelectOption,
  IonText,
  IonTitle,
  IonToolbar,
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { arrowBackOutline } from 'ionicons/icons';
import { Auth, onAuthStateChanged } from '@angular/fire/auth';
import { Firestore } from '@angular/fire/firestore';
import { Router } from '@angular/router';
import { EmailAuthProvider, reauthenticateWithCredential, updateEmail, User, verifyBeforeUpdateEmail } from 'firebase/auth';
import { FirebaseError } from 'firebase/app';
import { AlertController } from '@ionic/angular';
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { AccountService } from '../../services/account/account.service';
import { ProfileRepositoryService } from '../../services/account/profile-repository.service';
import { UserService } from '../../services/account/user.service';

@Component({
  selector: 'app-profile-settings',
  templateUrl: './profile-settings.page.html',
  styleUrls: ['./profile-settings.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    IonContent,
    IonHeader,
    IonTitle,
    IonToolbar,
    IonButtons,
    IonButton,
    IonIcon,
    IonItem,
    IonInput,
    IonSelect,
    IonSelectOption,
    IonText,
  ],
})
export class ProfileSettingsPage implements OnInit {
  private navCtrl = inject(NavController);
  private firestore = inject(Firestore);
  private auth = inject(Auth);
  private router = inject(Router);
  private alertCtrl = inject(AlertController);
  private accountService = inject(AccountService);
  private profileRepository = inject(ProfileRepositoryService);
  private userService = inject(UserService);

  firstName = '';
  lastName = '';
  email = '';
  initialEmail = '';
  age: string | number | null = '';
  heightMeters: string | number | null = '';
  weightKg: string | number | null = '';
  sex: string | number | null = null;
  isTrainer = false;

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

  constructor() {
    addIcons({ arrowBackOutline });
  }

  ngOnInit(): void {
    void this.loadSettings();
  }

  goBack(): void {
    this.navCtrl.navigateBack('/profile-user', {
      animated: true,
      animationDirection: 'back',
    });
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
    const parsedAge = shouldSaveStats ? this.parseNumber(this.age) : null;
    const parsedHeightMeters = shouldSaveStats ? this.parseNumber(this.heightMeters) : null;
    const parsedWeightKg = shouldSaveStats ? this.parseNumber(this.weightKg) : null;
    const parsedSex = shouldSaveStats ? this.parseSexValue(this.sex) : null;
    const bmi =
      shouldSaveStats && parsedHeightMeters !== null && parsedWeightKg !== null
        ? this.calculateBmi(parsedHeightMeters, parsedWeightKg)
        : null;

    if (shouldSaveStats && (parsedAge === null || !Number.isInteger(parsedAge) || parsedAge <= 0)) {
      this.errorMessage = 'Age must be a whole number greater than 0.';
      return;
    }

    if (shouldSaveStats && (parsedHeightMeters === null || parsedHeightMeters <= 0)) {
      this.errorMessage = 'Height (m) must be greater than 0.';
      return;
    }

    if (shouldSaveStats && (parsedWeightKg === null || parsedWeightKg <= 0)) {
      this.errorMessage = 'Weight (kg) must be greater than 0.';
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
          ? 'Name, age, sex, height, and weight were saved.'
          : 'Name and email were saved.';
        this.email = emailForUsersDoc;
      } else if (emailUpdateError) {
        this.errorMessage = emailUpdateError;
        this.successMessage = shouldSaveStats
          ? 'Name, age, sex, height, and weight were saved.'
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
        this.initialClientStats = {
          age: null,
          heightMeters: null,
          weightKg: null,
          sex: null,
        };
      }
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
